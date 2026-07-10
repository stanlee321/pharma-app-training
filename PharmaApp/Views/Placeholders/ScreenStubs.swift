import SwiftUI

/// Placeholder screens for the not-yet-built clinical screens. Declared so `Route`/`RootView`
/// compile fully; each is replaced by its real screen in Phase B (one file per screen).
private struct StubScreen: View {
    let title: String
    let caseID: UUID
    var note: String = "Coming in Phase B"

    var body: some View {
        VStack(spacing: Spacing.item) {
            Image(systemName: "hammer").font(.largeTitle).foregroundStyle(.secondary)
            Text(title).font(.title3.bold())
            Text(note).foregroundStyle(.secondary)
            Text(caseID.uuidString.prefix(8)).font(.caption.monospaced()).foregroundStyle(.tertiary)
        }
        .padding()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct PatientDataScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Patient Data", caseID: caseID) }
}

struct TechniqueScreen: View {
    let caseID: UUID
    let zone: TechniqueZone
    var body: some View { StubScreen(title: "Technique · \(zone.title)", caseID: caseID) }
}

struct MonitoringScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Monitoring", caseID: caseID) }
}

struct DrugLedgerScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Drug Ledger", caseID: caseID) }
}

struct FluidBalanceScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Fluid Balance", caseID: caseID) }
}

struct RecoveryScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Recovery (Aldrete)", caseID: caseID) }
}

struct NewbornScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Newborn Record", caseID: caseID) }
}

struct ReviewExportScreen: View {
    let caseID: UUID
    var body: some View { StubScreen(title: "Review & Export", caseID: caseID) }
}
