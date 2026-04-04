import SwiftUI

/// Root container: manages the launch modal and main navigation stack.
struct RootView: View {
    @Environment(AppState.self) private var appState
    @AppStorage("hasSeenAnnouncement_v1") private var hasSeenAnnouncement = false
    @State private var showLaunchModal = false
    @State private var navigationPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navigationPath) {
            DrugSelectionView(navigationPath: $navigationPath)
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .drugSelection:
                        DrugSelectionView(navigationPath: $navigationPath)
                    case .patientInput:
                        PatientInputView(navigationPath: $navigationPath)
                    case .simulation:
                        SimulationView(navigationPath: $navigationPath)
                    case .compartmental:
                        CompartmentalView()
                    }
                }
        }
        .overlay {
            if showLaunchModal {
                LaunchModalView(isPresented: $showLaunchModal) {
                    hasSeenAnnouncement = true
                }
            }
        }
        .onAppear {
            if !hasSeenAnnouncement {
                showLaunchModal = true
            }
        }
    }
}

// MARK: - Placeholder Views (will be replaced in later phases)

struct SimulationPlaceholderView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Text("Simulation View")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                Text(appState.selectedDrug.pickerLabel)
                    .foregroundStyle(.white.opacity(0.7))
                Text("Patient: \(Int(appState.patient.weight))kg, \(Int(appState.patient.age))yr, \(appState.patient.gender.rawValue)")
                    .foregroundStyle(.white.opacity(0.7))

                if appState.isSimulating {
                    ProgressView()
                        .tint(.white)
                } else if let output = appState.simulationOutput {
                    Text("\(output.points.count) curve points loaded")
                        .foregroundStyle(.green)
                    Text("V1=\(Int(output.v1Volume))ml  V2=\(Int(output.v2Volume))ml  V3=\(Int(output.v3Volume))ml")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.5))
                }

                Button("Compartmental View") {
                    navigationPath.append(Route.compartmental)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("< Patient") {
                    navigationPath.removeLast()
                }
                .foregroundStyle(.white)
            }
        }
        .task {
            if appState.simulationOutput == nil {
                await appState.runInitialSimulation()
            }
        }
    }
}

struct CompartmentalPlaceholderView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 16) {
                Text("Compartmental Animation")
                    .font(.title2.bold())
                    .foregroundStyle(.white)
                if let output = appState.simulationOutput {
                    Text("V1=\(Int(output.v1Volume))ml  V2=\(Int(output.v2Volume))ml  V3=\(Int(output.v3Volume))ml")
                        .foregroundStyle(.white.opacity(0.7))
                    Text("ke0=\(output.ke0, specifier: "%.3f")  k12=\(output.k12, specifier: "%.4f")")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .foregroundStyle(.white)
                }
            }
        }
    }
}
