import SwiftUI

/// N4a/b/c — Anesthetic Technique. Switches on `TechniqueZone` and binds every field into the
/// `technique.values` blob (`values_blob` crosswalk) via manual `FieldValue` bindings, plus the
/// one `attribute`-mode single-select that drives `technique.modality`.
struct TechniqueScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID
    let zone: TechniqueZone

    init(caseID: UUID, zone: TechniqueZone) {
        self.caseID = caseID
        self.zone = zone
    }

    var body: some View {
        Group {
            if let idx = store.index(of: caseID) {
                switch zone {
                case .general:    TechGeneralZone(caseID: caseID, idx: idx)
                case .neuraxial:  TechNeuraxialZone(caseID: caseID, idx: idx)
                case .peripheral: TechPeripheralZone(caseID: caseID, idx: idx)
                }
            } else {
                ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationTitle("Technique · \(zone.title)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - GENERAL zone

private struct TechGeneralZone: View {
    @Environment(MockCaseStore.self) private var store
    @Environment(AppState.self) private var appState
    let caseID: UUID
    let idx: Int

    private let modalities = ["AGIB", "AGEV", "BEPD", "Bloqueo de Plexo"]
    private let volatiles  = ["Sevoflurano", "Desflurano", "Isoflurano", "N2O"]

    var body: some View {
        Form {
            Section {
                CheckboxGroupRow(title: "Modalidad",
                                 options: modalities,
                                 selection: modalityBinding())
            }

            Section {
                CheckboxGroupRow(title: "Agentes volátiles",
                                 options: volatiles,
                                 multiSelect: true,
                                 selection: multiBool(volatiles, prefix: "volatil_"))
            }

            Section("Inducción") {
                TechCheckboxValueRow(label: "Propofol",  unit: "mg",
                                     isOn: boolB("ind_propofol"),  valueText: numText("ind_propofol_val"))
                TechCheckboxValueRow(label: "Fentanilo", unit: "mcg",
                                     isOn: boolB("ind_fentanilo"), valueText: numText("ind_fentanilo_val"))
                TechCheckboxValueRow(label: "Midazolam", unit: "mg",
                                     isOn: boolB("ind_midazolam"), valueText: numText("ind_midazolam_val"))
                TechCheckboxValueRow(label: "Rocuronio", unit: "mg",
                                     isOn: boolB("ind_rocuronio"), valueText: numText("ind_rocuronio_val"))
            }

            Section("Vía aérea / Ventilación") {
                StepperRow(label: "TET calibre", value: numDouble("va_tet_calibre", default: 7.0),
                           unit: "mmDI", step: 0.5, range: 5...9, format: "%.1f")
                StepperRow(label: "Flujo", value: numDouble("va_flujo", default: 2.0),
                           unit: "L/min", step: 0.5, range: 0.5...10, format: "%.1f")
                Toggle("Intubación endotraqueal", isOn: boolB("va_intubacion"))
                Toggle("Ventilación controlada", isOn: boolB("vent_controlada"))
            }

            Section("TCI · ayuda (Propofol)") {
                TechTCIChip(engine: appState.engine,
                            modelId: "marsh",
                            patient: store.cases[idx].patient.profile,
                            targetCp: numDouble("tci_target_cp", default: 4.0))
            }
        }
    }

    // MARK: FieldValue bindings (values_blob) — mirrors PreanestheticView.labRow

    private func boolB(_ key: String) -> Binding<Bool> {
        Binding(
            get: { if case .bool(let b)? = store.cases[idx].technique.values[key] { return b } else { return false } },
            set: { store.cases[idx].technique.values[key] = .bool($0) })
    }

    private func numText(_ key: String) -> Binding<String> {
        Binding(
            get: {
                if case .number(let n)? = store.cases[idx].technique.values[key] {
                    return n.rounded() == n ? String(Int(n)) : String(n)
                }
                return ""
            },
            set: {
                let s = $0.trimmingCharacters(in: .whitespaces)
                if s.isEmpty { store.cases[idx].technique.values[key] = nil }
                else if let d = Double(s) { store.cases[idx].technique.values[key] = .number(d) }
            })
    }

    private func numDouble(_ key: String, default fallback: Double) -> Binding<Double> {
        Binding(
            get: { if case .number(let n)? = store.cases[idx].technique.values[key] { return n } else { return fallback } },
            set: { store.cases[idx].technique.values[key] = .number($0) })
    }

    private func modalityBinding() -> Binding<Set<String>> {
        Binding(
            get: { let m = store.cases[idx].technique.modality; return m.isEmpty ? [] : [m] },
            set: { store.cases[idx].technique.modality = $0.first ?? "" })
    }

    private func multiBool(_ options: [String], prefix: String) -> Binding<Set<String>> {
        Binding(
            get: {
                var s = Set<String>()
                for o in options {
                    if case .bool(true)? = store.cases[idx].technique.values[prefix + o] { s.insert(o) }
                }
                return s
            },
            set: { new in
                for o in options { store.cases[idx].technique.values[prefix + o] = .bool(new.contains(o)) }
            })
    }
}

// MARK: - NEURAXIAL zone

private struct TechNeuraxialZone: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID
    let idx: Int

    private let needles   = ["Tuohy", "Quincke", "Whitacre"]
    private let approach  = ["Epidural", "Subaracnoidea", "Mixta"]

    var body: some View {
        Form {
            Section {
                CheckboxGroupRow(title: "Abordaje",
                                 options: approach,
                                 selection: modalityBinding())
            }

            Section {
                CheckboxGroupRow(title: "Aguja",
                                 options: needles,
                                 selection: multiBool(needles, prefix: "aguja_"))
                LabeledTextRow(label: "Nivel", text: textB("nivel"), placeholder: "L3–L4")
                LabeledTextRow(label: "Nº aguja", text: textB("aguja_calibre"), placeholder: "27G", unit: "G")
            }

            Section("Dosis") {
                TechCheckboxValueRow(label: "Bupivacaína", unit: "mg",
                                     isOn: boolB("dx_bupivacaina"), valueText: numText("dx_bupivacaina_val"))
                TechCheckboxValueRow(label: "Fentanilo",   unit: "mcg",
                                     isOn: boolB("dx_fentanilo"),   valueText: numText("dx_fentanilo_val"))
                TechCheckboxValueRow(label: "Morfina",     unit: "mcg",
                                     isOn: boolB("dx_morfina"),     valueText: numText("dx_morfina_val"))
            }
        }
    }

    private func boolB(_ key: String) -> Binding<Bool> {
        Binding(
            get: { if case .bool(let b)? = store.cases[idx].technique.values[key] { return b } else { return false } },
            set: { store.cases[idx].technique.values[key] = .bool($0) })
    }

    private func textB(_ key: String) -> Binding<String> {
        Binding(
            get: { if case .text(let t)? = store.cases[idx].technique.values[key] { return t } else { return "" } },
            set: { store.cases[idx].technique.values[key] = .text($0) })
    }

    private func numText(_ key: String) -> Binding<String> {
        Binding(
            get: {
                if case .number(let n)? = store.cases[idx].technique.values[key] {
                    return n.rounded() == n ? String(Int(n)) : String(n)
                }
                return ""
            },
            set: {
                let s = $0.trimmingCharacters(in: .whitespaces)
                if s.isEmpty { store.cases[idx].technique.values[key] = nil }
                else if let d = Double(s) { store.cases[idx].technique.values[key] = .number(d) }
            })
    }

    private func modalityBinding() -> Binding<Set<String>> {
        Binding(
            get: { let m = store.cases[idx].technique.modality; return m.isEmpty ? [] : [m] },
            set: { store.cases[idx].technique.modality = $0.first ?? "" })
    }

    private func multiBool(_ options: [String], prefix: String) -> Binding<Set<String>> {
        Binding(
            get: {
                var s = Set<String>()
                for o in options {
                    if case .bool(true)? = store.cases[idx].technique.values[prefix + o] { s.insert(o) }
                }
                return s
            },
            set: { new in
                for o in options { store.cases[idx].technique.values[prefix + o] = .bool(new.contains(o)) }
            })
    }
}

// MARK: - PERIPHERAL zone

private struct TechPeripheralZone: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID
    let idx: Int

    private let agents = ["Bupivacaína", "Lidocaína", "Ropivacaína", "Mepivacaína"]

    var body: some View {
        Form {
            Section {
                LabeledTextRow(label: "Sitio del bloqueo", text: textB("sitio_bloqueo"),
                               placeholder: "Plexo braquial")
                LabeledTextRow(label: "Volumen", text: numText("volumen_ml"),
                               placeholder: "—", unit: "ml", keyboard: .decimalPad)
                Toggle("Ecoguiado", isOn: boolB("ecoguiado"))
                Toggle("Neuroestimulador", isOn: boolB("neuroestimulador"))
            }

            Section {
                CheckboxGroupRow(title: "Anestésico local",
                                 options: agents,
                                 multiSelect: true,
                                 selection: multiBool(agents, prefix: "al_"))
            }

            Section("Dosis") {
                TechCheckboxValueRow(label: "Concentración", unit: "%",
                                     isOn: boolB("dx_concentracion"), valueText: numText("dx_concentracion_val"))
                TechCheckboxValueRow(label: "Adrenalina",    unit: "mcg",
                                     isOn: boolB("dx_adrenalina"),    valueText: numText("dx_adrenalina_val"))
            }
        }
    }

    private func boolB(_ key: String) -> Binding<Bool> {
        Binding(
            get: { if case .bool(let b)? = store.cases[idx].technique.values[key] { return b } else { return false } },
            set: { store.cases[idx].technique.values[key] = .bool($0) })
    }

    private func textB(_ key: String) -> Binding<String> {
        Binding(
            get: { if case .text(let t)? = store.cases[idx].technique.values[key] { return t } else { return "" } },
            set: { store.cases[idx].technique.values[key] = .text($0) })
    }

    private func numText(_ key: String) -> Binding<String> {
        Binding(
            get: {
                if case .number(let n)? = store.cases[idx].technique.values[key] {
                    return n.rounded() == n ? String(Int(n)) : String(n)
                }
                return ""
            },
            set: {
                let s = $0.trimmingCharacters(in: .whitespaces)
                if s.isEmpty { store.cases[idx].technique.values[key] = nil }
                else if let d = Double(s) { store.cases[idx].technique.values[key] = .number(d) }
            })
    }

    private func multiBool(_ options: [String], prefix: String) -> Binding<Set<String>> {
        Binding(
            get: {
                var s = Set<String>()
                for o in options {
                    if case .bool(true)? = store.cases[idx].technique.values[prefix + o] { s.insert(o) }
                }
                return s
            },
            set: { new in
                for o in options { store.cases[idx].technique.values[prefix + o] = .bool(new.contains(o)) }
            })
    }
}

// MARK: - Screen-local widgets (name-prefixed to avoid collisions)

/// A `checkbox_value` row: leading toggle, label, trailing numeric field + unit.
/// The number field is disabled/dimmed until the checkbox is on.
private struct TechCheckboxValueRow: View {
    let label: String
    let unit: String
    @Binding var isOn: Bool
    @Binding var valueText: String

    var body: some View {
        HStack(spacing: Spacing.item) {
            Button {
                isOn.toggle()
                Haptics.tap()
            } label: {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(isOn ? AppColors.selectionTint : Color.secondary)
            }
            .buttonStyle(.plain)

            Text(label)

            Spacer()

            TextField("—", text: $valueText)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .font(.numericValue)
                .frame(width: 72)
                .disabled(!isOn)
                .opacity(isOn ? 1 : 0.35)

            Text(unit)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .frame(width: 34, alignment: .leading)
        }
        .frame(minHeight: Spacing.tapTarget)    }
}

/// Client-side TCI decision aid (ADR-5): a target-Cp stepper + the engine's recommended
/// bolus/infusion, recomputed synchronously each render. Never persisted authoritative data.
private struct TechTCIChip: View {
    let engine: any PKEngineProtocol
    let modelId: String
    let patient: PatientProfile
    @Binding var targetCp: Double

    var body: some View {
        let rec = engine.computeTCI(modelId: modelId,
                                    patient: patient,
                                    currentState: [0, 0, 0, 0],
                                    targetConcentration: targetCp,
                                    targetType: .plasma)
        VStack(alignment: .leading, spacing: Spacing.item) {
            StepperRow(label: "Target Cp", value: $targetCp,
                       unit: "mcg/ml", step: 0.5, range: 1...8, format: "%.1f")

            if let rec {
                HStack(spacing: Spacing.section) {
                    Label(String(format: "Bolo %.1f ml", rec.bolusMl), systemImage: "syringe")
                        .foregroundStyle(AppColors.plasma)
                    Label(String(format: "%.1f ml/h", rec.infusionRateMlHr), systemImage: "drop.fill")
                        .foregroundStyle(AppColors.infusion)
                }
                .font(.caption)
            } else {
                Text("Sin recomendación disponible")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
