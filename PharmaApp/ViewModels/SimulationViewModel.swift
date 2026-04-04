import SwiftUI

/// Drives the simulation graph screen — manages chart state, target interaction, playback.
@MainActor @Observable
final class SimulationViewModel {
    // MARK: - Dependencies
    let appState: AppState

    // MARK: - Chart Configuration
    var timeRangeMinutes: Double = 30  // visible X-axis range
    var maxConcentration: Double = 10  // Y-axis left max (auto-scaled)
    var maxInfusionRate: Double = 50   // Y-axis right max (auto-scaled)

    // MARK: - Cursor & Scrubbing
    var cursorTimeFraction: Double = 0  // 0...1 across X-axis
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

    var concentrationUnit: String { drug.concentrationUnit.rawValue }

    /// Values at the current cursor position (interpolated from nearest point).
    var valuesAtCursor: CurvePoint? {
        guard let pts = output?.points, !pts.isEmpty else { return nil }
        let t = cursorTimeSeconds
        // Binary search for nearest point
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
        let maxC = max(maxCp, maxCe, dragTargetConcentration)
        maxConcentration = ceilToNice(maxC * 1.3)

        let maxR = pts.map(\.infusionRate).max() ?? 1
        maxInfusionRate = ceilToNice(maxR * 1.3)

        let maxTime = pts.last?.time ?? 1800
        timeRangeMinutes = max(ceil(maxTime / 60.0), 10)
    }

    // MARK: - Target Drag

    func onTargetDragChanged(concentration: Double) {
        isDraggingTarget = true
        dragTargetConcentration = max(concentration, 0)

        // Fast TCI query
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
        var targets = appState.targets
        targets.append(newTarget)

        Task {
            await appState.runSimulation(with: targets)
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

    // MARK: - Playback

    func togglePlayback() {
        isPlaying.toggle()
        if isPlaying {
            startPlayback()
        } else {
            stopPlayback()
        }
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
                try? await Task.sleep(for: .milliseconds(16)) // ~60fps
                let advance = (playbackSpeed / (timeRangeMinutes * 60)) * 0.016
                cursorTimeFraction = min(cursorTimeFraction + advance, 1.0)
                if cursorTimeFraction >= 1.0 {
                    isPlaying = false
                }
            }
        }
    }

    private func stopPlayback() {
        playbackTask?.cancel()
        playbackTask = nil
    }

    // MARK: - Helpers

    /// Format seconds as HH:MM:SS.
    func formatTime(_ seconds: Double) -> String {
        let s = Int(seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        return String(format: "%02d:%02d:%02d", h, m, sec)
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
