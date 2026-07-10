import SwiftUI

/// 3′ — Patient Data (case-scoped). Captures somatometry (weight/height/age/sex → PK
/// `PatientProfile`), identity/admin write-ins, and Hb/Hto/Rh/grupo, with a live read-only
/// derived-biometrics card (IMC · peso ideal · VSC). Wired to the in-memory `MockCaseStore`.
struct PatientDataScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    init(caseID: UUID) {
        self.caseID = caseID
    }

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            Form {
                Section("Somatometry") {
                    StepperRow(label: "Weight",
                               value: $store.cases[idx].patient.profile.weight,
                               unit: "kg", step: 1, range: 1...300, format: "%.0f")
                    StepperRow(label: "Height",
                               value: $store.cases[idx].patient.profile.height,
                               unit: "cm", step: 1, range: 20...250, format: "%.0f")
                    StepperRow(label: "Age",
                               value: $store.cases[idx].patient.profile.age,
                               unit: "yr", step: 1, range: 0...120, format: "%.0f")
                    CheckboxGroupRow(title: "Sex",
                                     options: ["Male", "Female"],
                                     selection: genderBinding(idx))
                }

                Section {
                    PatientDerivedBiometricsCard(imc: store.cases[idx].patient.imc,
                                                 pesoIdeal: store.cases[idx].patient.pesoIdeal,
                                                 vsc: store.cases[idx].patient.vsc)
                }

                Section("Identity") {
                    LabeledTextRow(label: "Registro",
                                   text: $store.cases[idx].patient.registro, placeholder: "—")
                    LabeledTextRow(label: "Nombre",
                                   text: $store.cases[idx].patient.nombre, placeholder: "—")
                    LabeledTextRow(label: "Cama",
                                   text: $store.cases[idx].patient.cama, placeholder: "—")
                }

                Section("Blood") {
                    LabeledTextRow(label: "Grupo sanguíneo",
                                   text: $store.cases[idx].patient.grupoSanguineo, placeholder: "A / B / AB / O")
                    LabeledTextRow(label: "Rh",
                                   text: $store.cases[idx].patient.rh, placeholder: "+ / −")
                    optionalDoubleRow("Hb", unit: "g/dL", idx: idx,
                                      get: { store.cases[idx].patient.hb },
                                      set: { store.cases[idx].patient.hb = $0 })
                    optionalDoubleRow("Hto", unit: "%", idx: idx,
                                      get: { store.cases[idx].patient.hto },
                                      set: { store.cases[idx].patient.hto = $0 })
                }
            }
            .navigationTitle("Patient")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }

    // MARK: - Bindings

    /// Bridges the single-select "Male"/"Female" chip group to `PatientProfile.gender`.
    private func genderBinding(_ idx: Int) -> Binding<Set<String>> {
        Binding(
            get: { [store.cases[idx].patient.profile.gender == .male ? "Male" : "Female"] },
            set: { new in
                guard let sel = new.first else { return }   // single-select: ignore deselect
                store.cases[idx].patient.profile.gender = (sel == "Female") ? .female : .male
            }
        )
    }

    /// A numeric text row bound to an optional `Double` (empty string ⇒ `nil`).
    private func optionalDoubleRow(_ label: String,
                                   unit: String,
                                   idx: Int,
                                   get: @escaping () -> Double?,
                                   set: @escaping (Double?) -> Void) -> some View {
        let binding = Binding<String>(
            get: { get().map { String($0) } ?? "" },
            set: { set(Double($0)) }
        )
        return LabeledTextRow(label: label, text: binding,
                              placeholder: "—", unit: unit, keyboard: .decimalPad)
    }
}

// MARK: - Read-only derived biometrics

/// Live-recomputed, non-editable IMC · peso ideal · VSC. Shown on the `surfaceDerived`
/// token with a lock glyph to signal these are computed, never captured.
private struct PatientDerivedBiometricsCard: View {
    let imc: Double
    let pesoIdeal: Double
    let vsc: Double

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.item) {
            SectionHeader(title: "Derived", systemImage: "lock.fill")
            HStack(spacing: Spacing.item) {
                metric("IMC", String(format: "%.1f", imc), "kg/m²")
                metric("Peso ideal", String(format: "%.1f", pesoIdeal), "kg")
                metric("VSC", String(format: "%.0f", vsc), "ml")
            }
        }
        .cardStyle()
    }

    private func metric(_ label: String, _ value: String, _ unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.cellValue)
                .foregroundStyle(.primary)
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.cell)
        .background(AppColors.surfaceDerived, in: RoundedRectangle(cornerRadius: 10))
    }
}
