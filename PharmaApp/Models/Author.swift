import Foundation

/// The signed-in clinician (mock auth — ADR-3). Stamps `AnesthesiaCase.owner`.
struct Author: Codable, Sendable, Identifiable, Hashable {
    var id: UUID = UUID()
    var name: String
    var role: String = ""
}
