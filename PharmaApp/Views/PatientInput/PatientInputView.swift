import SwiftUI

struct PatientInputView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState
        let drug = appState.selectedDrug
        let rules = drug.validationRules

        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 20) {
                    // Drug info header
                    VStack(spacing: 4) {
                        Text(drug.drug)
                            .font(.headline)
                        if let recipe = drug.preparationRecipe {
                            Text(recipe)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)

                    // Dilution
                    StepperRow(
                        label: "Dilution",
                        value: $state.patient.dilution,
                        unit: "mg/ml",
                        step: drug.concentrationUnit == .ngPerMl ? 0.001 : 0.5,
                        range: 0.001...100,
                        format: drug.concentrationUnit == .ngPerMl ? "%.4f" : "%.1f"
                    )

                    Divider()

                    Text("Patient data")
                        .font(.headline)
                        .frame(maxWidth: .infinity)

                    // Weight
                    StepperRow(
                        label: "Weight",
                        value: $state.patient.weight,
                        unit: "Kg",
                        step: 1,
                        range: rules.minWeight...rules.maxWeight,
                        format: "%.0f"
                    )

                    // Height
                    StepperRow(
                        label: "Length",
                        value: $state.patient.height,
                        unit: "cm",
                        step: 1,
                        range: rules.minHeight...rules.maxHeight,
                        format: "%.0f"
                    )

                    // Age
                    StepperRow(
                        label: "Age",
                        value: $state.patient.age,
                        unit: "yr",
                        step: 1,
                        range: rules.minAge...rules.maxAge,
                        format: "%.0f"
                    )

                    // Gender
                    HStack {
                        Text("Gender")
                            .frame(width: 80, alignment: .leading)
                        Spacer()
                        Button(appState.patient.gender.rawValue.capitalized) {
                            state.patient.gender = state.patient.gender == .male ? .female : .male
                        }
                        .foregroundStyle(.tint)
                        .fontWeight(.medium)
                    }
                    .padding(.horizontal, 16)
                }
                .padding(.bottom, 20)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("1")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("< Select Drug") {
                    navigationPath.removeLast()
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") {
                    appState.simulationOutput = nil
                    appState.targets = []
                    appState.currentTime = 0
                    navigationPath.append(Route.simulation)
                }
                .fontWeight(.semibold)
            }
        }
    }
}
