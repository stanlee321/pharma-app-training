#!/usr/bin/env swift
// Standalone script to generate mock PK simulation data as JSON files.
// Run: swift generate_mock_data.swift
// Output: PharmaApp/Resources/MockData/*.json

import Foundation

// MARK: - Types (duplicated from app for standalone execution)

struct CurvePoint: Codable {
    let time: Double
    let plasmaConcentration: Double
    let effectConcentration: Double
    let amountV1: Double
    let amountV2: Double
    let amountV3: Double
    let infusionRate: Double
}

struct SimulationOutput: Codable {
    let points: [CurvePoint]
    let v1Volume: Double
    let v2Volume: Double
    let v3Volume: Double
    let k10: Double
    let k12: Double
    let k21: Double
    let k13: Double
    let k31: Double
    let ke0: Double
}

struct PKParams {
    let v1, v2, v3, cl1, cl2, cl3, ke0, displayFactor: Double
    var k10: Double { cl1 / v1 }
    var k12: Double { cl2 / v1 }
    var k21: Double { cl2 / v2 }
    var k13: Double { cl3 / v1 }
    var k31: Double { cl3 / v3 }
}

// MARK: - Model Parameter Functions

func marshParams(weight: Double) -> PKParams {
    let v1 = 228.0 * weight
    return PKParams(v1: v1, v2: 463.0 * weight, v3: 2893.0 * weight,
                    cl1: 0.119 * v1, cl2: 0.112 * v1, cl3: 0.042 * v1,
                    ke0: 0.26, displayFactor: 1_000.0)
}

func schniderParams(weight: Double, height: Double, age: Double, male: Bool) -> PKParams {
    let lbm = male
        ? 1.1 * weight - 128.0 * pow(weight / height, 2)
        : 1.07 * weight - 148.0 * pow(weight / height, 2)
    let cl1 = (1.89 + (weight - 77) * 0.0456 + (lbm - 59) * (-0.0681) + (height - 177) * 0.0264) * 1000.0
    let cl2 = (1.29 - 0.024 * (age - 53)) * 1000.0
    return PKParams(v1: 4270, v2: 18900, v3: 23800,
                    cl1: cl1, cl2: cl2, cl3: 836.0,
                    ke0: 0.456, displayFactor: 1_000.0)
}

func mintoParams(weight: Double, height: Double, age: Double, male: Bool) -> PKParams {
    let lbm = male
        ? 1.1 * weight - 128.0 * pow(weight / height, 2)
        : 1.07 * weight - 148.0 * pow(weight / height, 2)
    let ad = age - 40.0, ld = lbm - 55.0
    return PKParams(
        v1: (5.1 - 0.0201 * ad + 0.072 * ld) * 1000,
        v2: (9.82 - 0.0811 * ad + 0.108 * ld) * 1000,
        v3: 5420,
        cl1: (2.6 - 0.0162 * ad + 0.0191 * ld) * 1000,
        cl2: (2.05 - 0.0301 * ad) * 1000,
        cl3: (0.076 - 0.00113 * ad) * 1000,
        ke0: 0.595 - 0.007 * ad,
        displayFactor: 1_000_000.0)
}

func hannivoortParams(weight: Double) -> PKParams {
    let wr = weight / 70.0, wr75 = pow(wr, 0.75)
    return PKParams(v1: 1.78 * wr * 1000, v2: 30.3 * wr * 1000, v3: 52000,
                    cl1: 0.686 * wr75 * 1000, cl2: 2.98 * wr75 * 1000, cl3: 602,
                    ke0: 1.09, displayFactor: 1_000_000.0)
}

// MARK: - ODE Solver (RK4)

func deriv(_ s: [Double], _ p: PKParams, _ R: Double) -> [Double] {
    let cp = s[0] / p.v1
    return [
        -(p.k10 + p.k12 + p.k13) * s[0] + p.k21 * s[1] + p.k31 * s[2] + R,
        p.k12 * s[0] - p.k21 * s[1],
        p.k13 * s[0] - p.k31 * s[1],
        p.ke0 * (cp - s[3])
    ]
}

func rk4(_ s: [Double], _ p: PKParams, _ R: Double, _ dt: Double) -> [Double] {
    let k1 = deriv(s, p, R)
    var s2 = [Double](repeating: 0, count: 4)
    for i in 0..<4 { s2[i] = s[i] + 0.5 * dt * k1[i] }
    let k2 = deriv(s2, p, R)
    var s3 = [Double](repeating: 0, count: 4)
    for i in 0..<4 { s3[i] = s[i] + 0.5 * dt * k2[i] }
    let k3 = deriv(s3, p, R)
    var s4 = [Double](repeating: 0, count: 4)
    for i in 0..<4 { s4[i] = s[i] + dt * k3[i] }
    let k4 = deriv(s4, p, R)
    var result = [Double](repeating: 0, count: 4)
    for i in 0..<4 {
        let weighted = k1[i] + 2.0*k2[i] + 2.0*k3[i] + k4[i]
        result[i] = max(s[i] + (dt / 6.0) * weighted, 0.0)
    }
    return result
}

// MARK: - Simulation

struct Target {
    let time: Double        // seconds
    let concentration: Double  // display units
}

func simulate(p: PKParams, targets: [Target], duration: Double, resolution: Double, dilution: Double, weight: Double) -> SimulationOutput {
    let dt = 0.1 / 60.0  // 0.1s in minutes
    let steps = Int(duration / 0.1)
    let outputEvery = max(1, Int(resolution / 0.1))

    var state: [Double] = [0, 0, 0, 0]
    var infRate = 0.0  // mg/min
    var targetCp = 0.0  // mg/ml
    var ti = 0
    var points: [CurvePoint] = []

    for step in 0...steps {
        let t = Double(step) * 0.1  // seconds

        // Apply target events
        while ti < targets.count && targets[ti].time <= t {
            targetCp = targets[ti].concentration / p.displayFactor  // → mg/ml
            let targetAmt = targetCp * p.v1
            let bolus = max(targetAmt - state[0], 0)
            state[0] += bolus
            infRate = max(
                p.k10 * targetAmt + p.k12 * targetAmt - p.k21 * state[1]
                + p.k13 * targetAmt - p.k31 * state[2], 0)
            ti += 1
        }

        state = rk4(state, p, infRate, dt)

        // BET recalc
        if targetCp > 0 {
            let tA = targetCp * p.v1
            infRate = max(p.k10 * tA + p.k12 * tA - p.k21 * state[1] + p.k13 * tA - p.k31 * state[2], 0)
        }

        if step % outputEvery == 0 {
            points.append(CurvePoint(
                time: t,
                plasmaConcentration: (state[0] / p.v1) * p.displayFactor,
                effectConcentration: state[3] * p.displayFactor,
                amountV1: state[0], amountV2: state[1], amountV3: state[2],
                infusionRate: infRate))
        }
    }

    return SimulationOutput(points: points,
        v1Volume: p.v1, v2Volume: p.v2, v3Volume: p.v3,
        k10: p.k10, k12: p.k12, k21: p.k21,
        k13: p.k13, k31: p.k31, ke0: p.ke0)
}

// MARK: - Generate and Write

func write(_ output: SimulationOutput, _ path: String) {
    let enc = JSONEncoder()
    enc.keyEncodingStrategy = .convertToSnakeCase
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? enc.encode(output) else { print("  ✗ encode failed"); return }
    let url = URL(fileURLWithPath: path)
    try! data.write(to: url)
    let kb = data.count / 1024
    let pts = output.points.count
    print("  ✓ \(url.lastPathComponent) — \(pts) points, \(kb) KB")
}

// --- Main ---

let outDir = "./PharmaApp/Resources/MockData"
print("Generating mock PK data → \(outDir)/\n")

// 1. Propofol Marsh, 70kg male, Cp target 4 mcg/ml, 30 min
print("[1/5] Propofol Marsh — single target (4 mcg/ml plasma)")
let m1 = marshParams(weight: 70)
let r1 = simulate(p: m1, targets: [Target(time: 0, concentration: 4.0)],
                   duration: 1800, resolution: 1.0, dilution: 10.0, weight: 70)
write(r1, "\(outDir)/marsh_70kg_target4_plasma.json")

// 2. Propofol Marsh, step-up/step-down
print("[2/5] Propofol Marsh — multi-target (4→6→2 mcg/ml)")
let r2 = simulate(p: m1, targets: [
    Target(time: 0, concentration: 4.0),
    Target(time: 600, concentration: 6.0),
    Target(time: 1200, concentration: 2.0)
], duration: 1800, resolution: 1.0, dilution: 10.0, weight: 70)
write(r2, "\(outDir)/marsh_70kg_multitarget.json")

// 3. Dexmedetomidine Hannivoort, 80kg, 0.8 ng/ml
print("[3/5] Dexmedetomidine Hannivoort — target 0.8 ng/ml")
let m3 = hannivoortParams(weight: 80)
let r3 = simulate(p: m3, targets: [Target(time: 0, concentration: 0.8)],
                   duration: 1800, resolution: 1.0, dilution: 0.004, weight: 80)
write(r3, "\(outDir)/hannivoort_80kg_target08ng.json")

// 4. Schnider, 60kg female, Ce target 3 mcg/ml
print("[4/5] Propofol Schnider — effect-site target 3 mcg/ml")
let m4 = schniderParams(weight: 60, height: 160, age: 50, male: false)
let r4 = simulate(p: m4, targets: [Target(time: 0, concentration: 3.0)],
                   duration: 1800, resolution: 1.0, dilution: 10.0, weight: 60)
write(r4, "\(outDir)/schnider_60kg_target3_effect.json")

// 5. Remifentanil Minto, 70kg, 4 ng/ml
print("[5/5] Remifentanil Minto — effect-site target 4 ng/ml")
let m5 = mintoParams(weight: 70, height: 170, age: 40, male: true)
let r5 = simulate(p: m5, targets: [Target(time: 0, concentration: 4.0)],
                   duration: 1800, resolution: 1.0, dilution: 0.02, weight: 70)
write(r5, "\(outDir)/minto_70kg_target4ng_effect.json")

print("\nDone. \(5) scenario files generated.")
