import Foundation

/// Protocol abstracting the PK/PD math engine.
/// Implemented by `MockPKEngine` (development) and `RustPKEngine` (production).
protocol PKEngineProtocol: Sendable {

    /// Run a full simulation with one or more target events.
    /// Returns time-series curves for graphing and animation.
    func simulate(
        modelId: String,
        patient: PatientProfile,
        targets: [TargetEvent],
        timeRangeSeconds: Double,
        resolutionSeconds: Double
    ) async -> SimulationOutput?

    /// Fast TCI query: given current compartment state, compute the bolus
    /// and infusion rate needed to reach a target concentration.
    /// Must return in < 16ms for 60fps drag interaction.
    func computeTCI(
        modelId: String,
        patient: PatientProfile,
        currentState: [Double],  // [x1, x2, x3, Ce] amounts in mg
        targetConcentration: Double,
        targetType: TargetType
    ) -> TCIResult?

    /// Get validation rules for a model.
    func validationRules(for modelId: String) -> ValidationRules?

    /// List available model IDs.
    var availableModelIds: [String] { get }
}
