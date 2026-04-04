import Foundation

struct PatientProfile: Codable, Sendable {
    var weight: Double      // kg
    var height: Double      // cm
    var age: Double         // years
    var gender: Gender
    var dilution: Double    // mg/ml

    enum Gender: String, Codable, Sendable {
        case male
        case female
    }
}

extension PatientProfile {
    /// Lean Body Mass (James formula) — used by Schnider and Minto models.
    var leanBodyMass: Double {
        let ratio = weight / height
        switch gender {
        case .male:
            return 1.1 * weight - 128.0 * ratio * ratio
        case .female:
            return 1.07 * weight - 148.0 * ratio * ratio
        }
    }

    /// Default patient for previews and testing.
    static let defaultMale = PatientProfile(
        weight: 70, height: 170, age: 40, gender: .male, dilution: 10.0
    )

    static let defaultFemale = PatientProfile(
        weight: 60, height: 160, age: 50, gender: .female, dilution: 10.0
    )
}
