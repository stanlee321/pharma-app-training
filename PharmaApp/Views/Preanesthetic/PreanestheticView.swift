import SwiftUI

/// N3 — Preanesthetic Assessment (the Phase A pilot: a real data screen wired to MockCaseStore).
struct PreanestheticView: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    @State private var asaSel: Set<String> = []
    @State private var raqSel: Set<String> = []

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            Form {
                Section("History") {
                    LabeledTextRow(label: "Alergias",
                                   text: $store.cases[idx].preAssessment.alergia, placeholder: "Ninguna")
                    LabeledTextRow(label: "Dentadura", text: $store.cases[idx].preAssessment.dentadura)
                    LabeledTextRow(label: "Cuello / vía aérea", text: $store.cases[idx].preAssessment.viaAerea)
                    LabeledTextRow(label: "Estado psíquico", text: $store.cases[idx].preAssessment.estadoPsiquico)
                    Toggle("Ayuno confirmado", isOn: $store.cases[idx].preAssessment.ayuno)
                    Toggle("Consentimiento", isOn: $store.cases[idx].preAssessment.consentimiento)
                }

                Section {
                    CheckboxGroupRow(title: "ASA", options: ["I", "II", "III", "IV", "V"], selection: $asaSel)
                    CheckboxGroupRow(title: "R.A.Q.", options: ["1", "2", "3", "4", "5"], selection: $raqSel)
                }

                Section("Labs") {
                    labRow("Urea", "urea", idx: idx)
                    labRow("Creatinina", "creatinina", idx: idx)
                    labRow("Glucosa", "glucosa", idx: idx)
                    labRow("Hb", "hb", idx: idx)
                    labRow("Hto", "hto", idx: idx)
                }

                Section("Premedicación") {
                    TextField("Notes", text: $store.cases[idx].preAssessment.premedicacion, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Preanesthetic")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                if let a = store.cases[idx].preAssessment.asa { asaSel = [roman(a)] }
                if let r = store.cases[idx].preAssessment.raq { raqSel = [String(r)] }
            }
            .onChange(of: asaSel) { _, new in
                store.cases[idx].preAssessment.asa = new.first.flatMap(fromRoman)
            }
            .onChange(of: raqSel) { _, new in
                store.cases[idx].preAssessment.raq = new.first.flatMap { Int($0) }
            }
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }

    private func labRow(_ label: String, _ key: String, idx: Int) -> some View {
        let binding = Binding<String>(
            get: { store.cases[idx].preAssessment.labs[key].map { String($0) } ?? "" },
            set: { store.cases[idx].preAssessment.labs[key] = Double($0) }
        )
        return LabeledTextRow(label: label, text: binding, placeholder: "—", keyboard: .decimalPad)
    }

    private func roman(_ n: Int) -> String { ["I", "II", "III", "IV", "V"][max(0, min(4, n - 1))] }
    private func fromRoman(_ s: String) -> Int? { ["I": 1, "II": 2, "III": 3, "IV": 4, "V": 5][s] }
}
