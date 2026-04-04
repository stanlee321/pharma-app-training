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
                        CompartmentalView(embedded: false)
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
