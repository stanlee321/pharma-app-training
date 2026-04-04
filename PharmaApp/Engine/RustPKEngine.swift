import Foundation

/// Production PK engine that calls the Rust `pk-engine` static library via C-FFI.
/// Requires `libpk_engine.a` linked and `pk_engine.h` bridging header configured.
///
/// TODO: Implement when Rust team delivers the compiled library.
/// For now, use `MockPKEngine` which provides the same interface.
final class RustPKEngine: PKEngineProtocol, @unchecked Sendable {

    let availableModelIds = ["marsh", "schnider", "minto", "hannivoort"]

    func simulate(
        modelId: String,
        patient: PatientProfile,
        targets: [TargetEvent],
        timeRangeSeconds: Double,
        resolutionSeconds: Double
    ) async -> SimulationOutput? {
        // TODO: Call pk_engine_simulate() via C-FFI
        fatalError("RustPKEngine not yet implemented. Use MockPKEngine.")
    }

    func computeTCI(
        modelId: String,
        patient: PatientProfile,
        currentState: [Double],
        targetConcentration: Double,
        targetType: TargetType
    ) -> TCIResult? {
        // TODO: Call pk_engine_compute_tci() via C-FFI
        fatalError("RustPKEngine not yet implemented. Use MockPKEngine.")
    }

    func validationRules(for modelId: String) -> ValidationRules? {
        // TODO: Call pk_engine_get_validation() via C-FFI
        fatalError("RustPKEngine not yet implemented. Use MockPKEngine.")
    }
}
