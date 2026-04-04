import SwiftUI

struct PatientInputView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState

    var body: some View {
        let drug = appState.selectedDrug
        let rules = drug.validationRules

        ScrollView {
            VStack(spacing: 14) {
                // Drug header card
                drugCard(drug: drug)

                // Dilution card
                dilutionCard(drug: drug)

                // Patient data card
                patientDataCard(rules: rules)

                // Model info footer
                modelInfoFooter(drug: drug, rules: rules)
            }
            .padding(.horizontal, Spacing.screen)
            .padding(.vertical, 8)
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    navigationPath.removeLast()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                        Text("Select Drug")
                    }
                    .font(.subheadline)
                }
            }
            ToolbarItem(placement: .principal) {
                Text("Patient Setup")
                    .font(.headline)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.confirm()
                    appState.simulationOutput = nil
                    appState.targets = []
                    appState.currentTime = 0
                    navigationPath.append(Route.simulation)
                } label: {
                    Text("Done")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 7)
                        .background(.blue, in: Capsule())
                }
            }
        }
    }

    // MARK: - Drug Header Card

    private func drugCard(drug: DrugModel) -> some View {
        let color = drugAccentColor(drug)

        return HStack(spacing: 12) {
            // Drug icon
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(color.opacity(0.15))
                    .frame(width: 48, height: 48)
                Image(systemName: "cross.vial")
                    .font(.title3)
                    .foregroundStyle(color)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(drug.drug)
                    .font(.title3.bold())
                Text(drug.model)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Concentration badge
            VStack(spacing: 2) {
                Text(drug.concentrationUnit.rawValue)
                    .font(.caption2.bold())
                    .foregroundStyle(color)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        }
        .padding(14)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Dilution Card

    private func dilutionCard(drug: DrugModel) -> some View {
        @Bindable var state = appState

        return VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: "drop.fill")
                    .font(.caption)
                    .foregroundStyle(.blue)
                    .frame(width: 24, height: 24)
                    .background(Color.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                Text("DILUTION")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .tracking(0.5)
            }

            // Recipe
            if let recipe = drug.preparationRecipe {
                Text(recipe)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 6))
            }

            // Stepper
            StepperRow(
                label: "",
                value: $state.patient.dilution,
                unit: "mg/ml",
                step: drug.concentrationUnit == .ngPerMl ? 0.001 : 0.5,
                range: 0.001...100,
                format: drug.concentrationUnit == .ngPerMl ? "%.4f" : "%.1f"
            )
        }
        .padding(14)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Patient Data Card

    private func patientDataCard(rules: ValidationRules) -> some View {
        @Bindable var state = appState

        return VStack(alignment: .leading, spacing: 4) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: "person.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
                    .frame(width: 24, height: 24)
                    .background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                Text("PATIENT DATA")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .tracking(0.5)
            }
            .padding(.bottom, 4)

            // Weight
            parameterRow(
                icon: "scalemass",
                iconColor: .orange,
                label: "Weight",
                value: $state.patient.weight,
                unit: "Kg",
                step: 1,
                range: rules.minWeight...rules.maxWeight,
                format: "%.0f"
            )

            thinDivider

            // Height
            parameterRow(
                icon: "ruler",
                iconColor: .purple,
                label: "Height",
                value: $state.patient.height,
                unit: "cm",
                step: 1,
                range: rules.minHeight...rules.maxHeight,
                format: "%.0f"
            )

            thinDivider

            // Age
            parameterRow(
                icon: "calendar",
                iconColor: .red,
                label: "Age",
                value: $state.patient.age,
                unit: "yr",
                step: 1,
                range: rules.minAge...rules.maxAge,
                format: "%.0f"
            )

            thinDivider

            // Gender
            genderRow
        }
        .padding(14)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var thinDivider: some View {
        Divider().padding(.leading, 40)
    }

    private func parameterRow(
        icon: String, iconColor: Color,
        label: String,
        value: Binding<Double>, unit: String,
        step: Double, range: ClosedRange<Double>, format: String
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(iconColor)
                .frame(width: 24)

            Text(label)
                .font(.subheadline)
                .frame(width: 55, alignment: .leading)

            Spacer()

            Text(String(format: format, value.wrappedValue))
                .font(.system(.title3, design: .monospaced).bold())
                .contentTransition(.numericText())

            Text(unit)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 28, alignment: .leading)

            // Stepper buttons
            HStack(spacing: 6) {
                compactStepperButton(systemName: "minus") {
                    withAnimation(.snappy(duration: 0.15)) {
                        value.wrappedValue = (value.wrappedValue - step).clamped(to: range)
                    }
                    Haptics.tap()
                }
                compactStepperButton(systemName: "plus") {
                    withAnimation(.snappy(duration: 0.15)) {
                        value.wrappedValue = (value.wrappedValue + step).clamped(to: range)
                    }
                    Haptics.tap()
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func compactStepperButton(systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.body.weight(.semibold))
                .frame(width: 40, height: 40)
                .background(Color(.systemGray5))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(.systemGray4), lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
    }

    private var genderRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.2")
                .font(.caption)
                .foregroundStyle(.blue)
                .frame(width: 24)

            Text("Gender")
                .font(.subheadline)

            Spacer()

            // Segmented gender picker
            HStack(spacing: 0) {
                genderButton("Male", isSelected: appState.patient.gender == .male) {
                    withAnimation(.easeInOut(duration: 0.2)) { appState.patient.gender = .male }
                    Haptics.tap()
                }
                genderButton("Female", isSelected: appState.patient.gender == .female) {
                    withAnimation(.easeInOut(duration: 0.2)) { appState.patient.gender = .female }
                    Haptics.tap()
                }
            }
            .background(Color(.systemGray5), in: RoundedRectangle(cornerRadius: 10))
        }
        .padding(.vertical, 8)
    }

    private func genderButton(_ label: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? .white : .primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    isSelected ? Color.blue : Color.clear,
                    in: RoundedRectangle(cornerRadius: 9)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Model Info Footer

    private func modelInfoFooter(drug: DrugModel, rules: ValidationRules) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Model requirements")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)
                    .tracking(0.5)
            }

            HStack(spacing: 12) {
                requirementBadge("Weight", "\(Int(rules.minWeight))-\(Int(rules.maxWeight)) kg")
                requirementBadge("Height", rules.requiresHeight ? "\(Int(rules.minHeight))-\(Int(rules.maxHeight)) cm" : "Not used")
                requirementBadge("Age", "\(Int(rules.minAge))-\(Int(rules.maxAge)) yr")
            }

            if !rules.requiresHeight {
                Text("This model does not use height in its calculations")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            if !rules.requiresGender {
                Text("This model does not use gender in its calculations")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func requirementBadge(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption2)
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 8))
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
