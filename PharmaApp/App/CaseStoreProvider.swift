import Foundation

/// Selects the persistence backend that sits behind `MockCaseStore`. Flip `useREST` to talk to
/// the live backend; the default keeps everything in-memory so the app runs with no server.
enum CaseStoreProvider {
    static let useREST = true

    /// Default backend API base. Use the Mac's LAN IP so a PHYSICAL device works out of the box
    /// (the Simulator can reach it too). Override at runtime via the Login "Server" field —
    /// persisted under `UserDefaults` key `backend_base_url`, no rebuild needed.
    /// (Simulator-only? `http://127.0.0.1:8000/api/v1` also works there.)
    static let defaultBaseURL = "http://192.168.0.29:8000/api/v1"

    static func makeBackend() -> CaseBackend {
        useREST ? RestBackend() : InMemoryBackend()
    }
}
