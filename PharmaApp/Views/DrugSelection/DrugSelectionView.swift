import SwiftUI

struct DrugSelectionView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState

    var body: some View {
        VStack(spacing: 0) {
            // Drug hero header
            drugHeader
                .padding(.top, 8)

            // Metadata
            metadataSection
                .frame(maxHeight: .infinity)

            // Picker
            pickerSection

            // Bottom bar
            bottomBar
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Select Drug 1")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.confirm()
                    appState.onDrugSelected()
                    navigationPath.append(Route.patientInput)
                } label: {
                    Text("SELECT 1")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(.blue, in: Capsule())
                }
            }
        }
    }

    // MARK: - Drug Hero Header

    private var drugHeader: some View {
        let drug = appState.selectedDrug
        let color = drugAccentColor(drug)

        return VStack(spacing: 6) {
            // Color accent pill
            HStack(spacing: 8) {
                Circle()
                    .fill(color)
                    .frame(width: 10, height: 10)
                Text(drug.drug.uppercased())
                    .font(.caption.bold())
                    .foregroundStyle(color)
                    .tracking(1.2)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(color.opacity(0.12), in: Capsule())

            // Drug name
            Text(drug.drug)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .contentTransition(.numericText())

            // Model name
            Text(drug.model)
                .font(.title3)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText())

            // Concentration unit badge
            Text(drug.concentrationUnit.rawValue)
                .font(.caption2.bold())
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Color(.systemGray5), in: Capsule())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .animation(.easeInOut(duration: 0.25), value: appState.selectedDrugIndex)
    }

    // MARK: - Metadata

    private var metadataSection: some View {
        let drug = appState.selectedDrug

        return ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 10) {
                // Description
                metadataCard(
                    icon: "doc.text",
                    label: "Description",
                    value: drug.description,
                    color: .blue
                )

                // Publication
                if let url = drug.publication.url.flatMap({ URL(string: $0) }) {
                    metadataCard(icon: "book", label: "Publication", color: .purple) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(drug.publication.title)
                                .font(.subheadline)
                            Link(url.absoluteString, destination: url)
                                .font(.caption)
                                .lineLimit(1)
                        }
                    }
                } else {
                    metadataCard(
                        icon: "book",
                        label: "Publication",
                        value: drug.publication.title,
                        color: .purple
                    )
                }

                // Comment
                let comment = drug.comments ?? "None"
                metadataCard(
                    icon: "text.quote",
                    label: "Comment",
                    value: comment,
                    color: comment == "None" ? .gray : .orange
                )

                // Manual dosing (if present)
                if let dosing = drug.manualDosingRules {
                    metadataCard(
                        icon: "syringe",
                        label: "Manual dosing",
                        value: dosing,
                        color: .red
                    )
                }

                // Target effects
                if !drug.targetEffects.isEmpty {
                    metadataCard(icon: "scope", label: "Target effects", color: .green) {
                        HStack(spacing: 6) {
                            ForEach(drug.targetEffects, id: \.self) { effect in
                                Text(effect)
                                    .font(.caption.bold())
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 4)
                                    .background(Color.green.opacity(0.12), in: Capsule())
                                    .foregroundStyle(.green)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.screen)
            .padding(.vertical, 4)
        }
    }

    // MARK: - Metadata Card Builders

    private func metadataCard(icon: String, label: String, value: String, color: Color) -> some View {
        metadataCard(icon: icon, label: label, color: color) {
            Text(value)
                .font(.subheadline)
                .foregroundStyle(.primary)
        }
    }

    private func metadataCard<Content: View>(icon: String, label: String, color: Color, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(color)
                .frame(width: 28, height: 28)
                .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))

            VStack(alignment: .leading, spacing: 3) {
                Text(label.uppercased())
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .tracking(0.5)
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Picker

    private var pickerSection: some View {
        @Bindable var state = appState
        return VStack(spacing: 0) {
            Divider()
            Picker("Drug Model", selection: $state.selectedDrugIndex) {
                ForEach(Array(appState.drugModels.enumerated()), id: \.offset) { index, model in
                    Text(model.pickerLabel)
                        .tag(index)
                }
            }
            .pickerStyle(.wheel)
            .frame(height: 140)
            .onChange(of: appState.selectedDrugIndex) {
                Haptics.tap()
                appState.onDrugSelected()
            }
            Divider()
        }
    }

    // MARK: - Bottom Bar

    private var bottomBar: some View {
        HStack {
            Button { } label: {
                Label("Edit Drug List", systemImage: "list.bullet")
                    .font(.caption)
            }
            Spacer()
            Button { } label: {
                Label("Saved Simulations", systemImage: "bookmark")
                    .font(.caption)
            }
        }
        .padding(.horizontal, Spacing.screen)
        .padding(.vertical, 10)
    }

    // MARK: - Helpers

    private func drugAccentColor(_ drug: DrugModel) -> Color {
        switch drug.drug.lowercased() {
        case "propofol": return .blue
        case "remifentanil": return .orange
        case "dexmedetomidine": return .teal
        default: return .gray
        }
    }
}
