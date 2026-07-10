import SwiftUI

/// N7 — Fluid Balance. Spreadsheet-style hourly intake/loss capture with a live running
/// balance row, plus blood-component toggles. One `FluidBalance` per case, wired to the
/// in-memory `MockCaseStore` (data-access pattern copied from `PreanestheticView`).
struct FluidBalanceScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    private let rows = ["NCL", "Cristaloide", "Coloide", "Sangrado", "Diuresis"]
    private let hours = ["1hr", "2hr", "3hr", "4hr", "5hr"]
    private let bloodOptions = ["Concentrado globular", "Plasma", "Plaquetas", "Aféresis"]

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            Form {
                Section {
                    HourlyFluidGrid(caseID: caseID, rows: rows, hours: hours)
                        .listRowInsets(EdgeInsets(top: Spacing.item,
                                                  leading: Spacing.item,
                                                  bottom: Spacing.item,
                                                  trailing: 0))
                } header: {
                    SectionHeader(title: "Balance hídrico horario", systemImage: "drop.fill")
                } footer: {
                    Text("Balance = (NCL + Cristaloide + Coloide) − (Sangrado + Diuresis)")
                        .font(.caption2)
                }

                Section {
                    CheckboxGroupRow(title: "Hemocomponentes",
                                     options: bloodOptions,
                                     multiSelect: true,
                                     selection: bloodBinding(idx))
                }
            }
            .navigationTitle("Balance hídrico")
            .navigationBarTitleDisplayMode(.inline)
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }

    // MARK: - Blood components (dict <-> Set<String>) binding

    private func bloodBinding(_ idx: Int) -> Binding<Set<String>> {
        Binding(
            get: {
                Set(store.cases[idx].fluidBalance.bloodComponents
                    .filter { $0.value }
                    .map { $0.key })
            },
            set: { newSet in
                for opt in bloodOptions {
                    store.cases[idx].fluidBalance.bloodComponents[opt] = newSet.contains(opt)
                }
            }
        )
    }
}

// MARK: - HourlyFluidGrid (frozen row-labels + horizontally scrolling hour columns)

/// The rows × hours spreadsheet grid. The label column is frozen; all cell rows live in a
/// single horizontal `ScrollView` so they scroll together in sync. A derived read-only
/// `Balance` row (per hour) is styled with `AppColors.surfaceDerived`.
private struct HourlyFluidGrid: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID
    let rows: [String]
    let hours: [String]

    private let labelWidth: CGFloat = 108
    private let cellWidth: CGFloat = 72
    private let headerHeight: CGFloat = 22
    private let rowHeight: CGFloat = Spacing.tapTarget

    var body: some View {
        if let idx = store.index(of: caseID) {
            HStack(alignment: .top, spacing: Spacing.cell) {
                frozenLabelColumn
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: Spacing.tight) {
                        hourHeaderRow
                        ForEach(rows, id: \.self) { row in
                            HStack(spacing: Spacing.cell) {
                                ForEach(hours, id: \.self) { hour in
                                    inputCell(row, hour, idx)
                                }
                            }
                        }
                        HStack(spacing: Spacing.cell) {
                            ForEach(hours, id: \.self) { hour in
                                balanceCell(hour, idx)
                            }
                        }
                    }
                }
            }
        } else {
            EmptyView()
        }
    }

    // Frozen (non-scrolling) left column of row labels.
    private var frozenLabelColumn: some View {
        VStack(alignment: .leading, spacing: Spacing.tight) {
            Color.clear.frame(width: labelWidth, height: headerHeight)
            ForEach(rows, id: \.self) { row in
                Text(row)
                    .font(.subheadline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(width: labelWidth, height: rowHeight, alignment: .leading)
            }
            Text("Balance")
                .font(.subheadline.weight(.semibold))
                .frame(width: labelWidth, height: rowHeight, alignment: .leading)
                .padding(.leading, Spacing.cell)
                .background(AppColors.surfaceDerived, in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private var hourHeaderRow: some View {
        HStack(spacing: Spacing.cell) {
            ForEach(hours, id: \.self) { hour in
                Text(hour)
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .frame(width: cellWidth, height: headerHeight)
            }
        }
    }

    private func inputCell(_ row: String, _ hour: String, _ idx: Int) -> some View {
        TextField("—", text: cellBinding(row, hour, idx))
            .font(.cellValue)
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.center)
            .frame(width: cellWidth, height: rowHeight)
            .background(AppColors.fieldFill, in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(AppColors.controlStroke, lineWidth: 0.5)
            )
    }

    private func balanceCell(_ hour: String, _ idx: Int) -> some View {
        let value = balance(hour, idx)
        return Text(Self.format(value))
            .font(.cellValue)
            .foregroundStyle(value < 0 ? AppColors.invalidTint : Color.primary)
            .contentTransition(.numericText())
            .frame(width: cellWidth, height: rowHeight)
            .background(AppColors.surfaceDerived, in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Bindings & derivations

    /// Two-way String binding onto `matrix[row][hour]` (nil when cleared).
    private func cellBinding(_ row: String, _ hour: String, _ idx: Int) -> Binding<String> {
        Binding(
            get: {
                if let v = store.cases[idx].fluidBalance.matrix[row]?[hour] {
                    return Self.format(v)
                }
                return ""
            },
            set: { newValue in
                store.cases[idx].fluidBalance.matrix[row, default: [:]][hour] =
                    Double(newValue.replacingOccurrences(of: ",", with: "."))
            }
        )
    }

    /// Live per-hour balance = (NCL + Cristaloide + Coloide) − (Sangrado + Diuresis).
    private func balance(_ hour: String, _ idx: Int) -> Double {
        let m = store.cases[idx].fluidBalance.matrix
        func v(_ row: String) -> Double { m[row]?[hour] ?? 0 }
        return (v("NCL") + v("Cristaloide") + v("Coloide")) - (v("Sangrado") + v("Diuresis"))
    }

    /// Trim trailing `.0` for whole numbers; keep one decimal otherwise.
    private static func format(_ v: Double) -> String {
        if v == v.rounded() { return String(Int(v)) }
        return String(format: "%.1f", v)
    }
}
