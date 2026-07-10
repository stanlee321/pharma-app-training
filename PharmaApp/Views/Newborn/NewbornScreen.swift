import SwiftUI

/// N9 — Newborn Record. A conditional, add-per-birth collection screen that captures
/// 0..n `NewbornRecord`s (sexo, peso, talla, Apgar 1'/5'/10') for obstetric cases only.
/// Wired to the in-memory `MockCaseStore` via the frozen Phase A pattern.
struct NewbornScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    var body: some View {
        @Bindable var store = store
        Group {
            if let idx = store.index(of: caseID) {
                Form {
                    Section {
                        if store.cases[idx].newborns.isEmpty {
                            NewbornEmptyNote()
                        } else {
                            ForEach(
                                Array(store.cases[idx].newborns.enumerated()),
                                id: \.element.id
                            ) { (offset, _) in
                                NewbornEditor(
                                    newborn: $store.cases[idx].newborns[offset],
                                    number: offset + 1
                                )
                            }
                            .onDelete { offsets in
                                store.cases[idx].newborns.remove(atOffsets: offsets)
                                Haptics.confirm()
                            }
                        }
                    } footer: {
                        Text("Add one record per birth — a multiple gestation adds more.")
                    }

                    Section {
                        addButton(idx: idx)
                    }
                }
            } else {
                ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationTitle("Newborns")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func addButton(idx: Int) -> some View {
        Button {
            store.cases[idx].newborns.append(NewbornRecord())
            Haptics.tap()
        } label: {
            Label("Add newborn", systemImage: "plus.circle.fill")
                .font(.headline)
                .foregroundStyle(AppColors.selectionTint)
                .frame(maxWidth: .infinity, minHeight: Spacing.tapTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add newborn record")
    }
}

// MARK: - Empty-state note (obstetric-only advisory)

private struct NewbornEmptyNote: View {
    var body: some View {
        VStack(spacing: Spacing.item) {
            Image(systemName: "figure.child.circle")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No newborn records")
                .font(.headline)
            Text("Obstetric cases only. Add a record per birth to capture sex, weight, height, and Apgar.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.section)
    }
}

// MARK: - Single-newborn editor (one deletable list row)

private struct NewbornEditor: View {
    @Binding var newborn: NewbornRecord
    let number: Int

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.item) {
            SectionHeader(title: "Newborn \(number)", systemImage: "figure.child")

            CheckboxGroupRow(title: "Sexo", options: ["M", "F"], selection: sexoBinding)

            LabeledTextRow(
                label: "Peso",
                text: doubleText(\.pesoGramos),
                placeholder: "—",
                unit: "g",
                keyboard: .decimalPad
            )
            LabeledTextRow(
                label: "Talla",
                text: doubleText(\.tallaCm),
                placeholder: "—",
                unit: "cm",
                keyboard: .decimalPad
            )

            apgarRow(label: "Apgar 1'", value: $newborn.apgar1)
            apgarRow(label: "Apgar 5'", value: $newborn.apgar5)
            apgarRow(label: "Apgar 10'", value: $newborn.apgar10)
        }
        .padding(.vertical, Spacing.tight)
    }

    // Sexo single-select bridged to the CheckboxGroupRow's Set<String> API.
    private var sexoBinding: Binding<Set<String>> {
        Binding(
            get: { newborn.sexo.isEmpty ? [] : [newborn.sexo] },
            set: { newborn.sexo = $0.first ?? "" }
        )
    }

    // Manual Double? <-> String bridge for the free-text numeric rows.
    private func doubleText(_ keyPath: WritableKeyPath<NewbornRecord, Double?>) -> Binding<String> {
        Binding(
            get: { newborn[keyPath: keyPath].map { String($0) } ?? "" },
            set: { newborn[keyPath: keyPath] = Double($0) }
        )
    }

    // Compact 0...10 Apgar picker (nil = "—", not yet scored).
    private func apgarRow(label: String, value: Binding<Int?>) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Picker(label, selection: value) {
                Text("—").tag(Int?.none)
                ForEach(0...10, id: \.self) { n in
                    Text("\(n)").tag(Int?.some(n))
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
        .frame(minHeight: Spacing.tapTarget)
        .accessibilityElement(children: .combine)
    }
}
