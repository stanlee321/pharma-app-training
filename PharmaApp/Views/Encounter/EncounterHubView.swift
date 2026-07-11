import SwiftUI

/// N2 — Encounter Hub: the case root envelope + section rows that push into each sub-screen.
struct EncounterHubView: View {
    @Environment(AppState.self) private var appState
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            List {
                Section {
                    LabeledTextRow(label: "Diagnóstico preop",
                                   text: $store.cases[idx].diagnosticoPreop, placeholder: "—")
                    LabeledTextRow(label: "Sala", text: $store.cases[idx].sala)
                    LabeledTextRow(label: "Servicio", text: $store.cases[idx].servicio)
                } header: {
                    Text("Encounter")
                }

                Section {
                    hubRow("Patient Data", "person.text.rectangle", .patientData(caseID))
                    hubRow("Preanesthetic Assessment", "list.clipboard", .preAssessment(caseID))
                    hubRow("Anesthetic Technique", "waveform.path.ecg", .technique(caseID, .general))
                    hubRow("Transanesthetic Monitoring", "chart.xyaxis.line", .monitoring(caseID))
                    hubRow("Drug Ledger", "pills", .drugLedger(caseID))
                    hubRow("Fluid Balance", "drop", .fluidBalance(caseID))
                    hubRow("Recovery (Aldrete)", "bed.double", .recoveryScore(caseID))
                    hubRow("Newborn Record", "figure.2.and.child.holdinghands", .newbornRecord(caseID))
                } header: {
                    Text("Sections")
                }

                Section {
                    hubRow("Review & Export", "doc.richtext", .reviewExport(caseID))
                }
            }
            .navigationTitle(store.cases[idx].title)
            .navigationBarTitleDisplayMode(.inline)
            .onDisappear { Task { await store.save(caseID: caseID) } }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Save") { Task { await store.save(caseID: caseID) } }
                }
            }
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }

    private func hubRow(_ title: String, _ icon: String, _ route: Route) -> some View {
        Button {
            appState.navigationPath.append(route)
        } label: {
            Label(title, systemImage: icon)
        }
    }
}
