import SwiftUI

/// N6 — Drug Ledger. A growable, case-scoped ledger of every drug given during the case.
/// For modelled agents (Propofol/Remifentanil/Dexmedetomidine) a live TCI-recommended
/// bolus + infusion is shown beside the given dose — a client-side decision aid (ADR-5),
/// computed on the fly and never persisted.
struct DrugLedgerScreen: View {
    @Environment(MockCaseStore.self) private var store
    @Environment(AppState.self) private var appState
    let caseID: UUID

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            let patient = store.cases[idx].patient.profile
            Form {
                Section {
                    if store.cases[idx].drugs.isEmpty {
                        Text("No drugs recorded yet.")
                            .foregroundStyle(.secondary)
                            .font(.callout)
                    }
                    ForEach(
                        Array(store.cases[idx].drugs.enumerated()),
                        id: \.element.id
                    ) { (offset, _) in
                        DrugLedgerRowEditor(
                            drug: $store.cases[idx].drugs[offset],
                            drugModels: appState.drugModels,
                            patient: patient,
                            engine: appState.engine
                        )
                    }
                    .onDelete { offsets in
                        store.cases[idx].drugs.remove(atOffsets: offsets)
                        Haptics.tap()
                    }
                } header: {
                    SectionHeader(title: "Fármacos administrados", systemImage: "cross.vial")
                }

                Section {
                    Button {
                        store.cases[idx].drugs.append(DrugAdministration())
                        Haptics.tap()
                    } label: {
                        Label("Add drug", systemImage: "plus.circle.fill")
                            .foregroundStyle(AppColors.selectionTint)
                    }
                    .frame(minHeight: Spacing.tapTarget)
                } footer: {
                    Text("TCI recommendations are a decision aid for modelled agents and are not saved.")
                        .font(.caption2)
                }
            }
            .navigationTitle("Drug Ledger")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }
}

// MARK: - Row editor (screen-private)

/// One editable ledger row: drug (menu-of-models + free text), dose value ±, unit, route,
/// and — for a modelled agent — a live TCI recommendation chip.
private struct DrugLedgerRowEditor: View {
    @Binding var drug: DrugAdministration
    let drugModels: [DrugModel]
    let patient: PatientProfile
    let engine: any PKEngineProtocol

    private static let units = ["mg", "mcg", "g", "ml", "mcg/kg", "mcg/kg/min", "UI"]
    private static let routes = ["IV", "IM", "SC", "VO", "Epidural", "Intratecal", "Inhalatoria", "Tópica"]
    private static let doseStep = 5.0
    /// Default plasma target (display units) used for the recommendation chip.
    private static let defaultTargetCp = 3.0

    private var isIncomplete: Bool {
        drug.farmaco.trimmingCharacters(in: .whitespaces).isEmpty || drug.doseValue == nil
    }

    private var tci: TCIResult? {
        guard let modelId = drug.rustModelId else { return nil }
        return engine.computeTCI(
            modelId: modelId,
            patient: patient,
            currentState: [0, 0, 0, 0],
            targetConcentration: Self.defaultTargetCp,
            targetType: .plasma
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.item) {
            Rectangle()
                .fill(isIncomplete ? AppColors.invalidTint : AppColors.selectionTint)
                .frame(width: 3)
                .clipShape(Capsule())

            VStack(alignment: .leading, spacing: Spacing.item) {
                drugRow
                doseRow
                routeRow
                if let tci {
                    tciChip(tci)
                }
            }
        }
        .padding(.vertical, Spacing.tight)
        .onChange(of: drug.farmaco) { _, new in
            drug.rustModelId = matchedModel(new)?.rustModelId
        }
    }

    // MARK: Rows

    private var drugRow: some View {
        HStack(spacing: Spacing.tight) {
            TextField("Fármaco", text: $drug.farmaco)
                .font(.body.weight(.medium))
            Menu {
                ForEach(drugModels) { model in
                    Button {
                        drug.farmaco = model.pickerLabel
                        drug.rustModelId = model.rustModelId
                        Haptics.tap()
                    } label: {
                        Label(model.pickerLabel, systemImage: "waveform.path.ecg")
                    }
                }
                if drug.rustModelId != nil {
                    Divider()
                    Button(role: .destructive) {
                        drug.rustModelId = nil
                    } label: {
                        Label("Clear model", systemImage: "xmark.circle")
                    }
                }
            } label: {
                Image(systemName: "pills.circle.fill")
                    .font(.title3)
                    .foregroundStyle(AppColors.selectionTint)
                    .frame(width: Spacing.tapTarget, height: Spacing.tapTarget)
            }
        }
    }

    private var doseRow: some View {
        HStack(spacing: Spacing.tight) {
            AcceleratingRepeatButton(systemName: "minus") { bumpDose(-Self.doseStep) }
            TextField("Dosis", text: doseBinding)
                .font(.numericValue)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .frame(minHeight: Spacing.tapTarget)
                .background(AppColors.fieldFill, in: RoundedRectangle(cornerRadius: 10))
            AcceleratingRepeatButton(systemName: "plus") { bumpDose(Self.doseStep) }
            unitMenu
        }
    }

    private var unitMenu: some View {
        Menu {
            ForEach(Self.units, id: \.self) { u in
                Button(u) { drug.doseUnit = u }
            }
        } label: {
            HStack(spacing: 2) {
                Text(drug.doseUnit.isEmpty ? "unit" : drug.doseUnit)
                    .font(.cellValue)
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, Spacing.item)
            .frame(minHeight: Spacing.tapTarget)
            .background(AppColors.fieldFill, in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var routeRow: some View {
        HStack(spacing: Spacing.tight) {
            Text("Vía").font(.caption).foregroundStyle(.secondary)
            Spacer()
            Menu {
                ForEach(Self.routes, id: \.self) { r in
                    Button(r) { drug.via = r }
                }
            } label: {
                HStack(spacing: 2) {
                    Text(drug.via.isEmpty ? "Seleccionar" : drug.via)
                    Image(systemName: "chevron.up.chevron.down").font(.caption2)
                }
                .font(.subheadline)
                .padding(.horizontal, Spacing.item)
                .frame(minHeight: Spacing.tapTarget)
                .background(AppColors.fieldFill, in: Capsule())
            }
        }
    }

    private func tciChip(_ tci: TCIResult) -> some View {
        HStack(spacing: Spacing.tight) {
            Image(systemName: "sparkles")
                .foregroundStyle(AppColors.infusion)
            Text(String(format: "TCI: %.1f ml bolus · %.1f ml/h",
                        tci.bolusMl, tci.infusionRateMlHr))
                .font(.cellValue)
                .foregroundStyle(.primary)
            Spacer()
            Text(String(format: "@ %.1f", Self.defaultTargetCp))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, Spacing.item)
        .padding(.vertical, Spacing.cell)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColors.surfaceDerived, in: RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(AppColors.infusion.opacity(0.4), lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Recommended TCI dose")
    }

    // MARK: Helpers

    private var doseBinding: Binding<String> {
        Binding(
            get: { drug.doseValue.map { String(format: "%g", $0) } ?? "" },
            set: { drug.doseValue = Double($0) }
        )
    }

    private func bumpDose(_ delta: Double) {
        let current = drug.doseValue ?? 0
        drug.doseValue = max(0, current + delta)
    }

    private func matchedModel(_ name: String) -> DrugModel? {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        return drugModels.first { $0.pickerLabel == trimmed || $0.drug == trimmed }
    }
}
