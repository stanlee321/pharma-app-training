import Foundation

// MARK: - Core Types (mirrors Rust FFI contract)

/// A single point in the simulation time series.
struct CurvePoint: Codable, Sendable {
    let time: Double              // seconds
    let plasmaConcentration: Double  // display units (mcg/ml or ng/ml)
    let effectConcentration: Double  // display units
    let amountV1: Double          // mg in central
    let amountV2: Double          // mg in rapid peripheral
    let amountV3: Double          // mg in slow peripheral
    let infusionRate: Double      // mg/min
}

/// Full output of a simulation run.
struct SimulationOutput: Codable, Sendable {
    let points: [CurvePoint]

    // Compartment volumes (ml) — for animation sizing
    let v1Volume: Double
    let v2Volume: Double
    let v3Volume: Double

    // Rate constants (1/min) — for particle animation speed
    let k10: Double
    let k12: Double
    let k21: Double
    let k13: Double
    let k31: Double
    let ke0: Double
}

/// Result of a single TCI query (what bolus/infusion hits the target?).
struct TCIResult: Codable, Sendable {
    let bolusMg: Double
    let bolusMl: Double
    let bolusMcgPerKg: Double
    let infusionRateMgHr: Double
    let infusionRateMlHr: Double
    let infusionRateMcgKgHr: Double
}

/// A user-set target at a specific time.
struct TargetEvent: Codable, Sendable {
    let time: Double              // seconds from simulation start
    let concentration: Double     // target in display units
    let targetType: TargetType
}

enum TargetType: String, Codable, Sendable {
    case plasma
    case effectSite
}

/// Validation bounds for a model's patient parameters.
struct ValidationRules: Codable, Sendable {
    let minWeight: Double
    let maxWeight: Double
    let minHeight: Double
    let maxHeight: Double
    let minAge: Double
    let maxAge: Double
    let requiresHeight: Bool
    let requiresGender: Bool
}

/// Concentration unit for display.
enum ConcentrationUnit: String, Codable, Sendable {
    case mcgPerMl = "mcg/ml"
    case ngPerMl = "ng/ml"
}
