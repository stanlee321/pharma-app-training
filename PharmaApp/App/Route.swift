import Foundation

/// Navigation destinations for the main NavigationStack.
///
/// The clinical-record spine is case-scoped: sub-screens carry the `AnesthesiaCase` id
/// (and, for technique, the modality zone). The full enum is declared up front so
/// per-screen work only fills its view — `Route.swift`/`RootView` are not touched again.
enum Route: Hashable {
    // Legacy pharmacology tools (recyclable; reachable from the record later)
    case drugSelection
    case patientInput
    case simulation
    case compartmental

    // Clinical-record spine (case-scoped)
    case encounterList
    case encounterHub(UUID)
    case patientData(UUID)
    case preAssessment(UUID)
    case technique(UUID, TechniqueZone)
    case monitoring(UUID)
    case drugLedger(UUID)
    case fluidBalance(UUID)
    case recoveryScore(UUID)
    case newbornRecord(UUID)
    case reviewExport(UUID)
}
