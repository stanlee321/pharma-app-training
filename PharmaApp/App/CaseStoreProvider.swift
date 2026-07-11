import Foundation

/// Selects the persistence backend that sits behind `MockCaseStore`. Flip `useREST` to talk to
/// the live backend; the default keeps everything in-memory so the app runs with no server.
enum CaseStoreProvider {
    static let useREST = false
    static let baseURL = URL(string: "http://127.0.0.1:8000/api/v1")!

    static func makeBackend() -> CaseBackend {
        useREST ? RestBackend(baseURL: baseURL) : InMemoryBackend()
    }
}
