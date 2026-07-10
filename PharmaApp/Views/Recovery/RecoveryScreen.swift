import SwiftUI

/// N8 — Recovery (Aldrete). Captures one case's post-anesthetic recovery score into the
/// `RecoveryScore` singleton: the 5-criteria × 6-time-point 0/1/2 matrix with a live
/// auto-summed TOTAL row, plus the término scales and discharge attribution.
struct RecoveryScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            Form {
                Section {
                    AldreteGrid(store: store, idx: idx)
                } header: {
                    SectionHeader(title: "Aldrete", systemImage: "waveform.path.ecg")
                } footer: {
                    Text("0–2 por criterio. TOTAL 0–10; se muestra “—” hasta completar los 5 y verde al alcanzar 10.")
                }

                Section {
                    StepperRow(label: "Ramsay", value: otrasBinding("ramsay", idx: idx, fallback: 2),
                               unit: "", step: 1, range: 1...6, format: "%.0f")
                    StepperRow(label: "Bromage", value: otrasBinding("bromage", idx: idx, fallback: 0),
                               unit: "", step: 1, range: 0...3, format: "%.0f")
                    StepperRow(label: "ENA", value: otrasBinding("ena", idx: idx, fallback: 0),
                               unit: "/10", step: 1, range: 0...10, format: "%.0f")
                } header: {
                    SectionHeader(title: "Escalas al término")
                }

                Section {
                    LabeledTextRow(label: "Alta a su piso",
                                   text: $store.cases[idx].recovery.altaAPiso, placeholder: "URPA")
                    LabeledTextRow(label: "Médico responsable",
                                   text: $store.cases[idx].recovery.medicoResponsable, placeholder: "Dr. …")
                } header: {
                    SectionHeader(title: "Alta")
                }
            }
            .navigationTitle("Recovery")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }

    /// A `Double` bridge over the `otras: [String: Int]` scale map for `StepperRow`.
    private func otrasBinding(_ key: String, idx: Int, fallback: Int) -> Binding<Double> {
        Binding(
            get: { Double(store.cases[idx].recovery.otras[key] ?? fallback) },
            set: { store.cases[idx].recovery.otras[key] = Int($0.rounded()) }
        )
    }
}

// MARK: - AldreteGrid

/// The 5×6 Aldrete matrix with a live auto-summed TOTAL row.
/// Criterion labels are pinned to the left; the 6 time-point columns scroll horizontally.
/// Each cell is a compact 0/1/2 segmented control bound directly into
/// `recovery.aldrete[criterion][timePoint]` (default `nil` = not yet scored).
private struct AldreteGrid: View {
    let store: MockCaseStore
    let idx: Int

    private let criteria = ["Actividad", "Respiración", "Circulación", "Conciencia", "Coloración"]
    private let timePoints = ["Al salir", "0", "20", "60", "90", "120"]

    private let labelWidth: CGFloat = 104
    private let cellWidth: CGFloat = 120
    private let headerHeight: CGFloat = 26
    private let rowHeight: CGFloat = 44

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            pinnedLabelColumn
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(spacing: 0) {
                    ForEach(timePoints, id: \.self) { tp in
                        column(for: tp)
                    }
                }
            }
        }
    }

    // Left, non-scrolling column: corner + criterion names + TOTAL label.
    private var pinnedLabelColumn: some View {
        VStack(spacing: 0) {
            Text("min")
                .font(.caption2.bold())
                .foregroundStyle(.secondary)
                .frame(width: labelWidth, height: headerHeight, alignment: .leading)
            ForEach(criteria, id: \.self) { c in
                Text(c)
                    .font(.footnote)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(.secondary)
                    .frame(width: labelWidth, height: rowHeight, alignment: .leading)
            }
            Text("TOTAL")
                .font(.caption2.bold())
                .tracking(0.5)
                .foregroundStyle(.secondary)
                .frame(width: labelWidth, height: rowHeight, alignment: .leading)
                .background(AppColors.surfaceDerived)
        }
        .padding(.trailing, Spacing.cell)
    }

    // One scrolling time-point column: header + 5 scored cells + TOTAL cell.
    private func column(for tp: String) -> some View {
        VStack(spacing: 0) {
            Text(tp)
                .font(.caption2.bold())
                .foregroundStyle(.secondary)
                .frame(width: cellWidth, height: headerHeight)
            ForEach(criteria, id: \.self) { c in
                scoreCell(criterion: c, tp: tp)
                    .frame(width: cellWidth, height: rowHeight)
            }
            totalCell(tp: tp)
                .frame(width: cellWidth, height: rowHeight)
                .background(AppColors.surfaceDerived)
        }
    }

    private func scoreCell(criterion: String, tp: String) -> some View {
        Picker("", selection: cellBinding(criterion, tp)) {
            Text("0").tag(Int?(0))
            Text("1").tag(Int?(1))
            Text("2").tag(Int?(2))
        }
        .labelsHidden()
        .pickerStyle(.segmented)
        .padding(.horizontal, Spacing.tight)
    }

    // Read-only auto-sum: "—" for a partial column (never a misleading sum), green at 10.
    private func totalCell(tp: String) -> some View {
        let total = columnTotal(tp)
        return Text(total.map { String($0) } ?? "—")
            .font(.cellValue)
            .foregroundStyle(total == 10 ? AppColors.effect : Color.primary)
    }

    private func columnTotal(_ tp: String) -> Int? {
        let aldrete = store.cases[idx].recovery.aldrete
        var sum = 0
        for c in criteria {
            guard let v = aldrete[c]?[tp] else { return nil }
            sum += v
        }
        return sum
    }

    // Manual optional binding: nil = unscored (no segment highlighted).
    private func cellBinding(_ criterion: String, _ tp: String) -> Binding<Int?> {
        Binding(
            get: { store.cases[idx].recovery.aldrete[criterion]?[tp] },
            set: { newValue in
                if let v = newValue {
                    store.cases[idx].recovery.aldrete[criterion, default: [:]][tp] = v
                    Haptics.tap()
                } else {
                    store.cases[idx].recovery.aldrete[criterion]?[tp] = nil
                }
            }
        )
    }
}
