import Foundation

/// Central switch to select Mock vs Rust engine.
/// Flip `useMock` to `false` once the Rust library is integrated.
enum EngineProvider {
    static let useMock = true

    static var shared: any PKEngineProtocol {
        if useMock {
            return MockPKEngine()
        } else {
            return RustPKEngine()
        }
    }
}
