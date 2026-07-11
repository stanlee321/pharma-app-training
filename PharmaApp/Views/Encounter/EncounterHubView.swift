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
                    hubRow("Patient Data", "person.text.rectangle", .patientData(caseID),
                           filled: store.cases[idx].patient.hasData)
                    hubRow("Preanesthetic Assessment", "list.clipboard", .preAssessment(caseID),
                           filled: store.cases[idx].preAssessment.hasData)
                    hubRow("Anesthetic Technique", "waveform.path.ecg", .technique(caseID, .general),
                           filled: store.cases[idx].technique.hasData)
                    hubRow("Transanesthetic Monitoring", "chart.xyaxis.line", .monitoring(caseID),
                           filled: store.cases[idx].transRecord.hasData)
                    hubRow("Drug Ledger", "pills", .drugLedger(caseID),
                           filled: !store.cases[idx].drugs.isEmpty)
                    hubRow("Fluid Balance", "drop", .fluidBalance(caseID),
                           filled: store.cases[idx].fluidBalance.hasData)
                    hubRow("Recovery (Aldrete)", "bed.double", .recoveryScore(caseID),
                           filled: store.cases[idx].recovery.hasData)
                    hubRow("Newborn Record", "figure.2.and.child.holdinghands", .newbornRecord(caseID),
                           filled: !store.cases[idx].newborns.isEmpty)
                } header: {
                    Text("Sections")
                }

                Section {
                    hubRow("Review & Export", "doc.richtext", .reviewExport(caseID), filled: false)
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

    private func hubRow(_ title: String, _ icon: String, _ route: Route,
                        filled: Bool) -> some View {
        Button {
            appState.navigationPath.append(route)
        } label: {
            HStack {
                Label(title, systemImage: icon)
                    .foregroundStyle(filled ? AppColors.effect : AppColors.selectionTint)
                Spacer()
                if filled {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(AppColors.effect)
                        .font(.footnote)
                }
            }
        }
    }
}
