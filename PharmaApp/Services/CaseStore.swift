import SwiftUI

/// Screen-facing case store (ADR-2). Keeps the synchronous surface the screens bind to
/// (`cases`, `index(of:)`, `createCase`, `delete`) while delegating persistence to a
/// `CaseBackend` — in-memory or REST, chosen by `CaseStoreProvider`. Local mutations are
/// applied optimistically; `refresh()` / `save(caseID:)` reconcile with the backend.
///
/// The `MockCaseStore` name is retained deliberately so the existing
/// `@Environment(MockCaseStore.self)` screens keep compiling unchanged.
@MainActor @Observable
final class MockCaseStore {
    /// Synchronously-readable snapshot the screens bind to. Starts empty; the backend seeds it
    /// on init via `refresh()`.
    var cases: [AnesthesiaCase] = []

    let backend: CaseBackend

    init(backend: CaseBackend = InMemoryBackend()) {
        self.backend = backend
        Task { await refresh() }
    }

    /// Optimistic create: append a local shell immediately so the UI updates now, persist it in
    /// the background, then swap in the server-derived copy (matched by id).
    func createCase(owner: String) -> AnesthesiaCase {
        let c = AnesthesiaCase(owner: owner)
        cases.append(c)
        Task {
            if let saved = try? await backend.save(c), let i = index(of: c.id) {
                cases[i] = saved
            }
        }
        return c
    }

    func index(of id: UUID) -> Int? {
        cases.firstIndex { $0.id == id }
    }

    /// Optimistic delete: drop locally, then tell the backend.
    func delete(id: UUID) {
        cases.removeAll { $0.id == id }
        Task { try? await backend.delete(id) }
    }

    /// Pull the case-summary shells from the backend into `cases`.
    func refresh() async {
        if let list = try? await backend.list() {
            cases = list
        }
    }

    /// Persist a single case (full-aggregate PUT) and swap in the server-derived copy. The index
    /// is re-resolved after the await, since `cases` may have mutated while the request was in
    /// flight.
    func save(caseID: UUID) async {
        guard let i = index(of: caseID) else { return }
        guard let saved = try? await backend.save(cases[i]) else { return }
        if let j = index(of: caseID) { cases[j] = saved }
    }

    /// Persist the case, then render the filled form PDF server-side (throws if offline).
    func exportForm(caseID: UUID, formID: String) async throws -> Data {
        await save(caseID: caseID)
        return try await backend.exportForm(caseID: caseID, formID: formID)
    }
}
