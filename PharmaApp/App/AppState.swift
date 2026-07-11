import SwiftUI

/// Global observable state shared across all screens.
@MainActor @Observable
final class AppState {

    // MARK: - Drug Database

    var drugModels: [DrugModel] = DrugDatabase.load()

    // MARK: - Drug Selection (Screen 2)

    var selectedDrugIndex: Int = 0

    var selectedDrug: DrugModel {
        guard drugModels.indices.contains(selectedDrugIndex) else {
            return drugModels[0]
        }
        return drugModels[selectedDrugIndex]
    }

    // MARK: - Patient Profile (Screen 3)

    var patient = PatientProfile.defaultMale

    // MARK: - Simulation State (Screens 4 & 5)

    var simulationOutput: SimulationOutput?
    var targets: [TargetEvent] = []
    var isSimulating: Bool = false

    /// Current time cursor position in seconds.
    var currentTime: Double = 0

    /// Playback state.
    var isPlaying: Bool = false
    var playbackSpeed: Double = 1.0

    // MARK: - Navigation & Auth (clinical spine)

    /// Main navigation path — moved here from RootView so login → list → hub can reset it.
    var navigationPath = NavigationPath()

    /// Signed-in author (mock; ADR-3). `nil` ⇒ show login.
    var author: Author?
    var isAuthenticated: Bool { author != nil }

    func signIn(name: String, role: String) {
        // Resolve a STABLE per-device tenant UUID (mocked API-gateway tenant, sent as X-User-Id).
        // Reuse the persisted id if present+valid, else mint one and persist it under "mock_user_id_v1".
        let key = "mock_user_id_v1"
        let uuid: UUID
        if let stored = UserDefaults.standard.string(forKey: key),
           let parsed = UUID(uuidString: stored) {
            uuid = parsed
        } else {
            uuid = UUID()
            UserDefaults.standard.set(uuid.uuidString, forKey: key)
        }
        author = Author(id: uuid, name: name, role: role)
    }

    func signOut() {
        author = nil
        navigationPath = NavigationPath()
    }

    // MARK: - Engine

    let engine: any PKEngineProtocol = EngineProvider.shared

    // MARK: - Actions

    /// Reset patient profile defaults when drug changes.
    func onDrugSelected() {
        let drug = selectedDrug
        patient.dilution = drug.defaultDilutionMgMl

        // Clamp patient values to new model's validation range
        let rules = drug.validationRules
        patient.weight = patient.weight.clamped(to: rules.minWeight...rules.maxWeight)
        patient.height = patient.height.clamped(to: rules.minHeight...rules.maxHeight)
        patient.age = patient.age.clamped(to: rules.minAge...rules.maxAge)
    }

    /// Run initial simulation after patient input is confirmed.
    func runInitialSimulation() async {
        isSimulating = true
        simulationOutput = await engine.simulate(
            modelId: selectedDrug.rustModelId,
            patient: patient,
            targets: targets,
            timeRangeSeconds: 3600,  // 60 minutes default
            resolutionSeconds: 1.0
        )
        currentTime = 0
        isSimulating = false
    }

    /// Re-run simulation with updated targets.
    func runSimulation(with newTargets: [TargetEvent]) async {
        targets = newTargets
        isSimulating = true
        simulationOutput = await engine.simulate(
            modelId: selectedDrug.rustModelId,
            patient: patient,
            targets: targets,
            timeRangeSeconds: 3600,
            resolutionSeconds: 1.0
        )
        isSimulating = false
    }
}

// MARK: - Helpers

extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
