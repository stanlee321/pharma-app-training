import Foundation

/// The three disjoint modalities of `AnestheticTechnique` (N4a/b/c). Carried as a
/// `Route` associated value, so it must be Hashable.
enum TechniqueZone: String, Codable, Sendable, Hashable, CaseIterable {
    case general
    case neuraxial
    case peripheral

    var title: String {
        switch self {
        case .general:    return "General"
        case .neuraxial:  return "Regional Neuraxial"
        case .peripheral: return "Peripheral Block"
        }
    }
}
