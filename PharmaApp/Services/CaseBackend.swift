import Foundation

/// Persistence transport port (ADR-2). The app persists **through** this seam, never through
/// `URLSession` directly. Two conformers ship: `InMemoryBackend` (offline / previews / tests) and
/// `RestBackend` (the live FastAPI service at `…/api/v1`). The `CaseStore` the screens bind to is a
/// thin adapter over one of these — swapping backends needs no screen changes.
///
/// Contract (mapped onto `/api/v1`, JSON snake_case):
/// - `list()`   → `GET  /cases`      → summaries decoded into `AnesthesiaCase` *shells*.
/// - `load(_:)` → `GET  /cases/{id}` → the full aggregate.
/// - `create(owner:)` → build a local `AnesthesiaCase(owner:)`, then `PUT` it (client owns the id).
/// - `save(_:)` → `PUT  /cases/{id}` → full-aggregate create-or-replace, returns the server copy.
/// - `delete(_:)` → `DELETE /cases/{id}` → 204.
protocol CaseBackend: Sendable {
    /// Case summaries as lightweight shells (id, patient.nombre, diagnosticoPreop, owner, createdAt).
    func list() async throws -> [AnesthesiaCase]
    /// The full aggregate for one case.
    func load(_ id: UUID) async throws -> AnesthesiaCase
    /// Build a fresh case owned by `owner` and persist it; returns the stored (server-derived) copy.
    func create(owner: String) async throws -> AnesthesiaCase
    /// Full-aggregate create-or-replace; returns the stored (server-derived) copy.
    func save(_ c: AnesthesiaCase) async throws -> AnesthesiaCase
    /// Remove a case.
    func delete(_ id: UUID) async throws
    /// Render a filled form PDF (application/pdf bytes) for a case, server-side.
    func exportForm(caseID: UUID, formID: String) async throws -> Data
}

/// Errors surfaced by a `CaseBackend`.
enum BackendError: Error, LocalizedError {
    case notFound(UUID)
    case http(status: Int, body: String)
    case invalidResponse
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .notFound(let id):
            return "Case \(id) not found."
        case .http(let status, let body):
            return "Backend returned HTTP \(status): \(body)"
        case .invalidResponse:
            return "Malformed response from backend."
        case .unsupported(let msg):
            return msg
        }
    }
}

// MARK: - In-memory backend

/// Offline `CaseBackend` — lets the whole app build, run, and preview with no server.
/// State is a serial actor so it is safe to share across tasks under strict concurrency.
actor InMemoryBackend: CaseBackend {
    private var cases: [UUID: AnesthesiaCase]

    init() {
        var demo = AnesthesiaCase(owner: "demo")
        demo.patient.nombre = "N. Pérez"
        demo.patient.registro = "TU-2026-0481"
        demo.patient.profile = PatientProfile(weight: 72, height: 161, age: 54, gender: .female, dilution: 10)
        demo.diagnosticoPreop = "Colecistitis aguda"
        demo.sala = "Q3"
        demo.servicio = "Cirugía General"
        self.cases = [demo.id: demo]
    }

    func list() async throws -> [AnesthesiaCase] {
        cases.values.sorted { $0.createdAt < $1.createdAt }
    }

    func load(_ id: UUID) async throws -> AnesthesiaCase {
        guard let c = cases[id] else { throw BackendError.notFound(id) }
        return c
    }

    func create(owner: String) async throws -> AnesthesiaCase {
        let c = AnesthesiaCase(owner: owner)
        cases[c.id] = c
        return c
    }

    func save(_ c: AnesthesiaCase) async throws -> AnesthesiaCase {
        cases[c.id] = c
        return c
    }

    func delete(_ id: UUID) async throws {
        cases[id] = nil
    }

    func exportForm(caseID: UUID, formID: String) async throws -> Data {
        throw BackendError.unsupported(
            "Filled-form export needs the REST backend — enable CaseStoreProvider.useREST.")
    }
}

// MARK: - REST backend

/// Live `CaseBackend` over the FastAPI service (`baseURL` = `http://127.0.0.1:8000/api/v1`).
///
/// The coder/decoder use ISO-8601 dates and **no** key strategy — snake_case ↔ camelCase mapping
/// rides on the models' explicit `CodingKeys` (and this file's `Summary` keys), not on
/// `.convertFromSnakeCase`. Value type, so it is `Sendable` for free.
struct RestBackend: CaseBackend {
    /// Explicit base (used by the standalone test); when nil, read the on-device "backend_base_url".
    private let baseURLOverride: URL?
    private let coder: JSONEncoder
    private let decoder: JSONDecoder

    init(baseURL: URL? = nil) {
        self.baseURLOverride = baseURL

        let coder = JSONEncoder()
        coder.dateEncodingStrategy = .iso8601
        self.coder = coder

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    /// Effective API base: the override, else the persisted setting, else the LAN default.
    /// Read at request time so the Login "Server" field takes effect without a relaunch.
    private var baseURL: URL {
        if let baseURLOverride { return baseURLOverride }
        let stored = UserDefaults.standard.string(forKey: "backend_base_url")
        let s = (stored?.isEmpty == false) ? stored! : CaseStoreProvider.defaultBaseURL
        return URL(string: s) ?? URL(string: CaseStoreProvider.defaultBaseURL)!
    }

    // MARK: CaseBackend

    func list() async throws -> [AnesthesiaCase] {
        var request = URLRequest(url: casesURL())
        request.httpMethod = "GET"
        let data = try await perform(request)
        let summaries = try decoder.decode([Summary].self, from: data)
        return summaries.map { $0.asShell() }
    }

    func load(_ id: UUID) async throws -> AnesthesiaCase {
        var request = URLRequest(url: casesURL(id))
        request.httpMethod = "GET"
        let data = try await perform(request)
        return try decoder.decode(AnesthesiaCase.self, from: data)
    }

    func create(owner: String) async throws -> AnesthesiaCase {
        // Client owns the id: build locally, then PUT create-or-replace.
        let newCase = AnesthesiaCase(owner: owner)
        return try await save(newCase)
    }

    func save(_ c: AnesthesiaCase) async throws -> AnesthesiaCase {
        var request = URLRequest(url: casesURL(c.id))
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try coder.encode(c)
        let data = try await perform(request)
        return try decoder.decode(AnesthesiaCase.self, from: data)
    }

    func delete(_ id: UUID) async throws {
        var request = URLRequest(url: casesURL(id))
        request.httpMethod = "DELETE"
        _ = try await perform(request)
    }

    func exportForm(caseID: UUID, formID: String) async throws -> Data {
        let url = casesURL(caseID)
            .appendingPathComponent("export")
            .appendingPathComponent(formID)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        return try await perform(request)   // raw application/pdf bytes
    }

    // MARK: Transport helpers

    /// `…/cases` or `…/cases/{id}`.
    private func casesURL(_ id: UUID? = nil) -> URL {
        let base = baseURL.appendingPathComponent("cases")
        guard let id else { return base }
        return base.appendingPathComponent(id.uuidString)
    }

    /// Run a request, enforce a 2xx status, and return the body bytes.
    private func perform(_ request: URLRequest) async throws -> Data {
        // Mocked API-gateway tenant header: attach the persisted login UUID as X-User-Id.
        // Absent ⇒ the backend falls back to its mock-default tenant. `request` is a `let`
        // parameter on this `struct`, so copy it to set the header.
        var request = request
        if let uid = UserDefaults.standard.string(forKey: "mock_user_id_v1") {
            request.setValue(uid, forHTTPHeaderField: "X-User-Id")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw BackendError.http(status: http.statusCode,
                                    body: String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }

    // MARK: Wire shapes

    /// A `GET /cases` list row. Explicit `CodingKeys` map the snake_case wire fields so the
    /// no-key-strategy decoder resolves them regardless of the models' own keys.
    private struct Summary: Decodable {
        let id: UUID
        let owner: String?
        let nombre: String?
        let diagnosticoPreop: String?
        let createdAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, owner, nombre
            case diagnosticoPreop = "diagnostico_preop"
            case createdAt = "created_at"
        }

        /// Inflate the summary into a minimally-populated `AnesthesiaCase` (a "shell" for lists).
        func asShell() -> AnesthesiaCase {
            var c = AnesthesiaCase(owner: owner ?? "")
            c.id = id
            c.patient.nombre = nombre ?? ""
            c.diagnosticoPreop = diagnosticoPreop ?? ""
            if let createdAt { c.createdAt = createdAt }
            return c
        }
    }
}
