import SwiftUI

/// Drives the compartmental animation from simulation output data.
@MainActor @Observable
final class CompartmentalViewModel {
    let appState: AppState

    // MARK: - Toolbar Modes
    var showData: Bool = false
    var showSizes: Bool = false
    var showLabels: Bool = true

    // MARK: - Timeline (synced with simulation)
    var cursorFraction: Double = 0
    var cursorTimeSeconds: Double { cursorFraction * timeRangeMinutes * 60 }
    var timeRangeMinutes: Double = 30

    // MARK: - Computed from output

    var output: SimulationOutput? { appState.simulationOutput }

    var drug: DrugModel { appState.selectedDrug }
    var concentrationUnit: String { drug.concentrationUnit.rawValue }

    /// Volumes in ml for sizing.
    var v1: Double { output?.v1Volume ?? 1 }
    var v2: Double { output?.v2Volume ?? 1 }
    var v3: Double { output?.v3Volume ?? 1 }

    /// Rate constants for particle speed.
    var k10: Double { output?.k10 ?? 0 }
    var k12: Double { output?.k12 ?? 0 }
    var k21: Double { output?.k21 ?? 0 }
    var k13: Double { output?.k13 ?? 0 }
    var k31: Double { output?.k31 ?? 0 }
    var ke0: Double { output?.ke0 ?? 0 }

    /// Current data point at cursor time.
    var currentPoint: CurvePoint? {
        guard let pts = output?.points, !pts.isEmpty else { return nil }
        let t = cursorTimeSeconds
        let idx = pts.indices.min(by: { abs(pts[$0].time - t) < abs(pts[$1].time - t) }) ?? 0
        return pts[idx]
    }

    // MARK: - Fill fractions (0...1) for each compartment at current time

    /// Maximum amount seen in any compartment across the whole simulation, for normalization.
    private var maxAmount: Double {
        guard let pts = output?.points else { return 1 }
        let m = pts.map { max($0.amountV1, $0.amountV2, $0.amountV3) }.max() ?? 1
        return max(m, 0.001)
    }

    var fillV1: Double {
        guard let p = currentPoint else { return 0 }
        return min(p.amountV1 / maxAmount, 1.0)
    }

    var fillV2: Double {
        guard let p = currentPoint else { return 0 }
        return min(p.amountV2 / maxAmount, 1.0)
    }

    var fillV3: Double {
        guard let p = currentPoint else { return 0 }
        return min(p.amountV3 / maxAmount, 1.0)
    }

    var fillEffect: Double {
        guard let p = currentPoint else { return 0 }
        // Effect site concentration normalized against max Cp
        let maxCp = output?.points.map(\.plasmaConcentration).max() ?? 1
        return maxCp > 0 ? min(p.effectConcentration / maxCp, 1.0) : 0
    }

    /// Cylinder scale factors for "Sizes" mode (proportional to volume).
    var sizeScaleV1: Double {
        let maxV = max(v1, v2, v3)
        return showSizes ? max(v1 / maxV, 0.3) : 1.0
    }

    var sizeScaleV2: Double {
        let maxV = max(v1, v2, v3)
        return showSizes ? max(v2 / maxV, 0.3) : 1.0
    }

    var sizeScaleV3: Double {
        let maxV = max(v1, v2, v3)
        return showSizes ? max(v3 / maxV, 0.3) : 1.0
    }

    // MARK: - Particle positions

    /// Particles along each pipe. Returns array of (fraction along pipe: 0...1).
    func particles(rate: Double, count: Int = 5, speed: Double = 1.0) -> [Double] {
        guard rate > 0 else { return [] }
        let time = cursorTimeSeconds
        let baseSpeed = rate * speed * 0.5
        return (0..<count).map { i in
            let offset = Double(i) / Double(count)
            let pos = (baseSpeed * time * 0.01 + offset).truncatingRemainder(dividingBy: 1.0)
            return pos
        }
    }

    // MARK: - Init

    init(appState: AppState) {
        self.appState = appState
        if let pts = appState.simulationOutput?.points, let last = pts.last {
            timeRangeMinutes = max(ceil(last.time / 60.0), 10)
        }
    }

    func formatTime(_ seconds: Double) -> String {
        let s = Int(seconds)
        return String(format: "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
    }
}
