import Foundation

/// Mock PK engine that generates realistic pharmacokinetic curves
/// using analytical 3-compartment model solutions.
/// Use during development while the Rust engine is being built.
final class MockPKEngine: PKEngineProtocol, @unchecked Sendable {

    let availableModelIds = ["marsh", "schnider", "minto", "hannivoort"]

    // MARK: - Model Parameters

    /// Computed PK parameters for a given model + patient.
    struct PKParams {
        let v1: Double   // ml
        let v2: Double   // ml
        let v3: Double   // ml
        let cl1: Double  // ml/min
        let cl2: Double  // ml/min
        let cl3: Double  // ml/min
        let ke0: Double  // 1/min
        let displayFactor: Double  // multiply mg/ml → display units

        var k10: Double { cl1 / v1 }
        var k12: Double { cl2 / v1 }
        var k21: Double { cl2 / v2 }
        var k13: Double { cl3 / v1 }
        var k31: Double { cl3 / v3 }
    }

    // MARK: - Parameter Calculation

    private func params(modelId: String, patient: PatientProfile) -> PKParams? {
        switch modelId {
        case "marsh":
            return marshParams(patient: patient)
        case "schnider":
            return schniderParams(patient: patient)
        case "minto":
            return mintoParams(patient: patient)
        case "hannivoort":
            return hannivoortParams(patient: patient)
        default:
            return nil
        }
    }

    private func marshParams(patient: PatientProfile) -> PKParams {
        let w = patient.weight
        let v1 = 228.0 * w
        let v2 = 463.0 * w
        let v3 = 2893.0 * w
        let k10 = 0.119
        let k12 = 0.112
        let _ = 0.055   // k21 derived from cl2/v2
        let k13 = 0.042
        let _ = 0.0033  // k31 derived from cl3/v3
        return PKParams(
            v1: v1, v2: v2, v3: v3,
            cl1: k10 * v1, cl2: k12 * v1, cl3: k13 * v1,
            ke0: 0.26,
            displayFactor: 1_000.0  // mg/ml → mcg/ml
        )
    }

    private func schniderParams(patient: PatientProfile) -> PKParams {
        let lbm = patient.leanBodyMass
        let v1 = 4270.0
        let v2 = 18900.0
        let v3 = 23800.0
        let cl1 = (1.89 + (patient.weight - 77) * 0.0456
                   + (lbm - 59) * (-0.0681)
                   + (patient.height - 177) * 0.0264) * 1000.0
        let cl2 = (1.29 - 0.024 * (patient.age - 53)) * 1000.0
        let cl3 = 836.0
        return PKParams(
            v1: v1, v2: v2, v3: v3,
            cl1: cl1, cl2: cl2, cl3: cl3,
            ke0: 0.456,
            displayFactor: 1_000.0
        )
    }

    private func mintoParams(patient: PatientProfile) -> PKParams {
        let lbm = patient.leanBodyMass
        let ageDiff = patient.age - 40.0
        let lbmDiff = lbm - 55.0
        let v1 = (5.1 - 0.0201 * ageDiff + 0.072 * lbmDiff) * 1000.0
        let v2 = (9.82 - 0.0811 * ageDiff + 0.108 * lbmDiff) * 1000.0
        let v3 = 5420.0
        let cl1 = (2.6 - 0.0162 * ageDiff + 0.0191 * lbmDiff) * 1000.0
        let cl2 = (2.05 - 0.0301 * ageDiff) * 1000.0
        let cl3 = (0.076 - 0.00113 * ageDiff) * 1000.0
        let ke0 = 0.595 - 0.007 * ageDiff
        return PKParams(
            v1: v1, v2: v2, v3: v3,
            cl1: cl1, cl2: cl2, cl3: cl3,
            ke0: ke0,
            displayFactor: 1_000_000.0  // mg/ml → ng/ml
        )
    }

    private func hannivoortParams(patient: PatientProfile) -> PKParams {
        let wRatio = patient.weight / 70.0
        let wRatio075 = pow(wRatio, 0.75)
        let v1 = 1.78 * wRatio * 1000.0
        let v2 = 30.3 * wRatio * 1000.0
        let v3 = 52.0 * 1000.0
        let cl1 = 0.686 * wRatio075 * 1000.0
        let cl2 = 2.98 * wRatio075 * 1000.0
        let cl3 = 602.0
        return PKParams(
            v1: v1, v2: v2, v3: v3,
            cl1: cl1, cl2: cl2, cl3: cl3,
            ke0: 1.09,
            displayFactor: 1_000_000.0  // mg/ml → ng/ml
        )
    }

    // MARK: - ODE Solver (RK4, simplified)

    /// State: [x1(mg), x2(mg), x3(mg), Ce(mg/ml)]
    private func deriv(state: [Double], p: PKParams, infusionRate: Double) -> [Double] {
        let x1 = state[0], x2 = state[1], x3 = state[2], ce = state[3]
        let cp = x1 / p.v1

        let dx1 = -(p.k10 + p.k12 + p.k13) * x1 + p.k21 * x2 + p.k31 * x3 + infusionRate
        let dx2 = p.k12 * x1 - p.k21 * x2
        let dx3 = p.k13 * x1 - p.k31 * x3
        let dce = p.ke0 * (cp - ce)

        return [dx1, dx2, dx3, dce]
    }

    /// Single RK4 step.
    private func rk4Step(
        state: [Double], p: PKParams, infusionRate: Double, dt: Double
    ) -> [Double] {
        let k1 = deriv(state: state, p: p, infusionRate: infusionRate)

        var s2 = state
        for i in 0..<4 { s2[i] = state[i] + 0.5 * dt * k1[i] }
        let k2 = deriv(state: s2, p: p, infusionRate: infusionRate)

        var s3 = state
        for i in 0..<4 { s3[i] = state[i] + 0.5 * dt * k2[i] }
        let k3 = deriv(state: s3, p: p, infusionRate: infusionRate)

        var s4 = state
        for i in 0..<4 { s4[i] = state[i] + dt * k3[i] }
        let k4 = deriv(state: s4, p: p, infusionRate: infusionRate)

        var result = state
        for i in 0..<4 {
            result[i] = state[i] + (dt / 6.0) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i])
        }
        return result
    }

    // MARK: - TCI Calculation

    private func computeBET(
        p: PKParams, state: [Double], targetCp: Double, patient: PatientProfile
    ) -> TCIResult {
        let targetAmount = targetCp * p.v1  // mg in V1 for target Cp (mg/ml)
        let bolusMg = max(targetAmount - state[0], 0.0)

        // Maintenance: replace elimination + redistribution
        let maintenanceRate = max(
            p.k10 * targetAmount
            + p.k12 * targetAmount - p.k21 * state[1]
            + p.k13 * targetAmount - p.k31 * state[2],
            0.0
        )  // mg/min

        let dilution = patient.dilution
        let weight = patient.weight

        return TCIResult(
            bolusMg: bolusMg,
            bolusMl: dilution > 0 ? bolusMg / dilution : 0,
            bolusMcgPerKg: bolusMg * 1000.0 / weight,
            infusionRateMgHr: maintenanceRate * 60.0,
            infusionRateMlHr: dilution > 0 ? maintenanceRate * 60.0 / dilution : 0,
            infusionRateMcgKgHr: maintenanceRate * 60.0 * 1000.0 / weight
        )
    }

    // MARK: - Protocol Implementation

    func simulate(
        modelId: String,
        patient: PatientProfile,
        targets: [TargetEvent],
        timeRangeSeconds: Double,
        resolutionSeconds: Double
    ) async -> SimulationOutput? {
        guard let p = params(modelId: modelId, patient: patient) else { return nil }

        let sortedTargets = targets.sorted { $0.time < $1.time }
        let dtInternal = 0.1  // 100ms integration step for accuracy
        let totalSteps = Int(timeRangeSeconds / dtInternal)
        let outputInterval = max(1, Int(resolutionSeconds / dtInternal))

        var state: [Double] = [0, 0, 0, 0]  // [x1, x2, x3, Ce]
        var infusionRate = 0.0  // mg/min
        var currentTargetCp = 0.0  // mg/ml (internal units)
        var targetIndex = 0
        var points: [CurvePoint] = []

        for step in 0...totalSteps {
            let t = Double(step) * dtInternal  // current time in seconds
            // time in minutes for rate constants: t / 60.0

            // Check for new target events
            while targetIndex < sortedTargets.count && sortedTargets[targetIndex].time <= t {
                let target = sortedTargets[targetIndex]
                // Convert display units → internal mg/ml
                currentTargetCp = target.concentration / p.displayFactor

                // Compute and apply bolus
                let tci = computeBET(p: p, state: state, targetCp: currentTargetCp, patient: patient)
                state[0] += tci.bolusMg  // apply bolus to central compartment

                // Set maintenance infusion rate (mg/min)
                infusionRate = tci.infusionRateMgHr / 60.0

                targetIndex += 1
            }

            // Integrate one step (rate constants are per minute, dt is in seconds)
            state = rk4Step(state: state, p: p, infusionRate: infusionRate, dt: dtInternal / 60.0)

            // Ensure non-negative amounts
            for i in 0..<4 { state[i] = max(state[i], 0) }

            // Update maintenance infusion rate (BET recalculation)
            if currentTargetCp > 0 {
                let maintMgMin = max(
                    p.k10 * currentTargetCp * p.v1
                    + p.k12 * currentTargetCp * p.v1 - p.k21 * state[1]
                    + p.k13 * currentTargetCp * p.v1 - p.k31 * state[2],
                    0.0
                )
                infusionRate = maintMgMin
            }

            // Record output at specified resolution
            if step % outputInterval == 0 {
                let cp = (state[0] / p.v1) * p.displayFactor
                let ce = state[3] * p.displayFactor

                points.append(CurvePoint(
                    time: t,
                    plasmaConcentration: cp,
                    effectConcentration: ce,
                    amountV1: state[0],
                    amountV2: state[1],
                    amountV3: state[2],
                    infusionRate: infusionRate
                ))
            }
        }

        return SimulationOutput(
            points: points,
            v1Volume: p.v1,
            v2Volume: p.v2,
            v3Volume: p.v3,
            k10: p.k10,
            k12: p.k12,
            k21: p.k21,
            k13: p.k13,
            k31: p.k31,
            ke0: p.ke0
        )
    }

    func computeTCI(
        modelId: String,
        patient: PatientProfile,
        currentState: [Double],
        targetConcentration: Double,
        targetType: TargetType
    ) -> TCIResult? {
        guard let p = params(modelId: modelId, patient: patient) else { return nil }

        // Convert display units → internal mg/ml
        let targetCp = targetConcentration / p.displayFactor

        // For plasma targeting, use direct BET
        // For effect-site targeting, overshoot plasma (simplified for mock)
        let effectiveTargetCp: Double
        if targetType == .effectSite {
            // Simplified overshoot: multiply by ratio to account for equilibration delay
            let currentCe = currentState[3]
            let currentCp = p.v1 > 0 ? currentState[0] / p.v1 : 0
            if currentCe < targetCp && currentCp < targetCp {
                effectiveTargetCp = targetCp * 1.3  // 30% overshoot for faster Ce rise
            } else {
                effectiveTargetCp = targetCp
            }
        } else {
            effectiveTargetCp = targetCp
        }

        return computeBET(p: p, state: currentState, targetCp: effectiveTargetCp, patient: patient)
    }

    func validationRules(for modelId: String) -> ValidationRules? {
        let models = DrugDatabase.hardcoded
        return models.first { $0.rustModelId == modelId }?.validationRules
    }
}
