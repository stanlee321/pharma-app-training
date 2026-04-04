import SwiftUI

/// Drives the simulation graph screen — manages chart state, target interaction, playback.
@MainActor @Observable
final class SimulationViewModel {
    // MARK: - Dependencies
    let appState: AppState

    // MARK: - Chart Configuration
    var timeRangeMinutes: Double = 30
    var maxConcentration: Double = 10
    var maxInfusionRate: Double = 50

    // MARK: - Cursor & Scrubbing
    var cursorTimeFraction: Double = 0
    var cursorTimeSeconds: Double { cursorTimeFraction * timeRangeMinutes * 60 }

    // MARK: - Target Node Interaction
    var isDraggingTarget: Bool = false
    var dragTargetConcentration: Double = 0
    var pendingTCIResult: TCIResult?

    // MARK: - Playback
    var isPlaying: Bool = false
    var playbackSpeed: Double = 1.0
    private var playbackTask: Task<Void, Never>?

    // MARK: - Computed

    var drug: DrugModel { appState.selectedDrug }
    var patient: PatientProfile { appState.patient }
    var output: SimulationOutput? { appState.simulationOutput }
    var targets: [TargetEvent] { appState.targets }

    var concentrationUnit: String { drug.concentrationUnit.rawValue }

    /// The target that is active at the current cursor time.
    var activeTargetAtCursor: TargetEvent? {
        let sorted = targets.sorted { $0.time < $1.time }
        return sorted.last(where: { $0.time <= cursorTimeSeconds })
    }

    /// Values at the current cursor position.
    var valuesAtCursor: CurvePoint? {
        guard let pts = output?.points, !pts.isEmpty else { return nil }
        let t = cursorTimeSeconds
        let idx = pts.indices.min(by: { abs(pts[$0].time - t) < abs(pts[$1].time - t) }) ?? 0
        return pts[idx]
    }

    /// Current compartment state at cursor for TCI calculation.
    var currentState: [Double] {
        guard let v = valuesAtCursor else { return [0, 0, 0, 0] }
        return [v.amountV1, v.amountV2, v.amountV3, v.effectConcentration]
    }

    init(appState: AppState) {
        self.appState = appState
    }

    // MARK: - Auto-scale axes

    func autoScaleAxes() {
        guard let pts = output?.points, !pts.isEmpty else { return }
        let maxCp = pts.map(\.plasmaConcentration).max() ?? 1
        let maxCe = pts.map(\.effectConcentration).max() ?? 1
        let maxTargetC = targets.map(\.concentration).max() ?? 0
        let maxC = max(maxCp, maxCe, dragTargetConcentration, maxTargetC)
        maxConcentration = ceilToNice(maxC * 1.3)

        let maxR = pts.map(\.infusionRate).max() ?? 1
        maxInfusionRate = ceilToNice(maxR * 1.3)

        let maxTime = pts.last?.time ?? 1800
        timeRangeMinutes = max(ceil(maxTime / 60.0), 10)
    }

    // MARK: - Add Target (via "+ Target" button)

    /// Start adding a new target at the current cursor position.
    func beginAddTarget() {
        // Default: use the active target concentration, or a sensible default
        let defaultConc: Double
        if let active = activeTargetAtCursor {
            defaultConc = active.concentration
        } else if let last = targets.last {
            defaultConc = last.concentration
        } else {
            defaultConc = drug.concentrationUnit == .ngPerMl ? 0.5 : 3.0
        }
        dragTargetConcentration = defaultConc
        isDraggingTarget = true

        pendingTCIResult = appState.engine.computeTCI(
            modelId: drug.rustModelId,
            patient: patient,
            currentState: currentState,
            targetConcentration: dragTargetConcentration,
            targetType: .plasma
        )
    }

    // MARK: - Target Drag

    func onTargetDragChanged(concentration: Double) {
        isDraggingTarget = true
        dragTargetConcentration = max(concentration, 0)

        pendingTCIResult = appState.engine.computeTCI(
            modelId: drug.rustModelId,
            patient: patient,
            currentState: currentState,
            targetConcentration: dragTargetConcentration,
            targetType: .plasma
        )
    }

    func onTargetDragConfirmed() {
        isDraggingTarget = false
        let newTarget = TargetEvent(
            time: cursorTimeSeconds,
            concentration: dragTargetConcentration,
            targetType: .plasma
        )

        // Replace any existing target at the same time (within 5s tolerance)
        var updated = appState.targets.filter { abs($0.time - newTarget.time) > 5 }
        updated.append(newTarget)
        updated.sort { $0.time < $1.time }

        Task {
            await appState.runSimulation(with: updated)
            autoScaleAxes()
        }
    }

    func onTargetDragCancelled() {
        isDraggingTarget = false
        dragTargetConcentration = 0
        pendingTCIResult = nil
    }

    func nudgeTarget(by delta: Double) {
        dragTargetConcentration = max(dragTargetConcentration + delta, 0)
        onTargetDragChanged(concentration: dragTargetConcentration)
    }

    // MARK: - Remove Target

    func removeTarget(at index: Int) {
        var updated = appState.targets
        guard updated.indices.contains(index) else { return }
        updated.remove(at: index)

        if updated.isEmpty {
            appState.targets = []
            appState.simulationOutput = nil
        } else {
            Task {
                await appState.runSimulation(with: updated)
                autoScaleAxes()
            }
        }
    }

    /// Remove the target closest to the cursor time.
    func removeTargetAtCursor() {
        let sorted = appState.targets.sorted { $0.time < $1.time }
        guard let closest = sorted.enumerated().min(by: { abs($0.element.time - cursorTimeSeconds) < abs($1.element.time - cursorTimeSeconds) }) else { return }

        // Find its index in the original array
        if let origIdx = appState.targets.firstIndex(where: { $0.time == closest.element.time && $0.concentration == closest.element.concentration }) {
            removeTarget(at: origIdx)
        }
    }

    // MARK: - Playback

    func togglePlayback() {
        isPlaying.toggle()
        if isPlaying { startPlayback() } else { stopPlayback() }
    }

    func cycleSpeed() {
        let speeds: [Double] = [1, 2, 4, 8]
        if let idx = speeds.firstIndex(of: playbackSpeed) {
            playbackSpeed = speeds[(idx + 1) % speeds.count]
        } else {
            playbackSpeed = 1
        }
    }

    private func startPlayback() {
        playbackTask?.cancel()
        playbackTask = Task {
            while !Task.isCancelled && isPlaying {
                try? await Task.sleep(for: .milliseconds(16))
                let advance = (playbackSpeed / (timeRangeMinutes * 60)) * 0.016
                cursorTimeFraction = min(cursorTimeFraction + advance, 1.0)
                if cursorTimeFraction >= 1.0 { isPlaying = false }
            }
        }
    }

    private func stopPlayback() {
        playbackTask?.cancel()
        playbackTask = nil
    }

    // MARK: - Helpers

    func formatTime(_ seconds: Double) -> String {
        let s = Int(seconds)
        return String(format: "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }

    func formatTimeShort(_ seconds: Double) -> String {
        let m = Int(seconds) / 60
        let s = Int(seconds) % 60
        return String(format: "%d:%02d", m, s)
    }

    private func ceilToNice(_ value: Double) -> Double {
        if value <= 0 { return 1 }
        let magnitude = pow(10, floor(log10(value)))
        let normalized = value / magnitude
        let nice: Double
        if normalized <= 1 { nice = 1 }
        else if normalized <= 2 { nice = 2 }
        else if normalized <= 5 { nice = 5 }
        else { nice = 10 }
        return nice * magnitude
    }
}
