import SwiftUI

struct DrugSelectionView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState

        VStack(spacing: 0) {
            // Metadata area
            metadataSection
                .frame(maxHeight: .infinity)

            Divider()

            // Wheel picker
            Picker("Drug Model", selection: $state.selectedDrugIndex) {
                ForEach(Array(appState.drugModels.enumerated()), id: \.offset) { index, model in
                    Text(model.pickerLabel)
                        .tag(index)
                }
            }
            .pickerStyle(.wheel)
            .frame(height: 150)
            .onChange(of: appState.selectedDrugIndex) {
                appState.onDrugSelected()
            }

            Divider()

            // Bottom toolbar
            HStack {
                Button("Edit Drug List") { }
                    .font(.subheadline)
                Spacer()
                Button("Saved Simulations") { }
                    .font(.subheadline)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .navigationTitle("Select Drug 1")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("SELECT 1") {
                    appState.onDrugSelected()
                    navigationPath.append(Route.patientInput)
                }
                .fontWeight(.semibold)
            }
        }
    }

    // MARK: - Metadata Section

    private var metadataSection: some View {
        let drug = appState.selectedDrug

        return ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(drug.drug)
                    .font(.title2.bold())
                Text(drug.model)
                    .font(.title3)
                    .foregroundStyle(.secondary)

                Divider()

                metadataRow("Description:", drug.description)

                if let pubURL = drug.publication.url, let url = URL(string: pubURL) {
                    HStack(alignment: .top) {
                        Text("Publication:")
                            .fontWeight(.medium)
                        VStack(alignment: .leading) {
                            Text(drug.publication.title)
                            Link(pubURL, destination: url)
                                .font(.subheadline)
                        }
                    }
                } else {
                    metadataRow("Publication:", drug.publication.title)
                }

                metadataRow("Comment:", drug.comments ?? "None")

                if let dosing = drug.manualDosingRules {
                    metadataRow("Manual dosing:", dosing)
                }
            }
            .padding(16)
        }
    }

    private func metadataRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .fontWeight(.medium)
            Text(value)
                .foregroundStyle(.secondary)
        }
    }
}
