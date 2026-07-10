import SwiftUI

/// Root container: mock-login gate → the clinical NavigationStack, plus the launch modal.
struct RootView: View {
    @Environment(AppState.self) private var appState
    @AppStorage("hasSeenAnnouncement_v1") private var hasSeenAnnouncement = false
    @State private var showLaunchModal = false

    var body: some View {
        @Bindable var appState = appState
        Group {
            if appState.isAuthenticated {
                NavigationStack(path: $appState.navigationPath) {
                    EncounterListView()
                        .navigationDestination(for: Route.self) { route in
                            destination(for: route, path: $appState.navigationPath)
                        }
                }
            } else {
                LoginView()
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
            if !hasSeenAnnouncement { showLaunchModal = true }
        }
    }

    @ViewBuilder
    private func destination(for route: Route, path: Binding<NavigationPath>) -> some View {
        switch route {
        // Legacy tools
        case .drugSelection:            DrugSelectionView(navigationPath: path)
        case .patientInput:             PatientInputView(navigationPath: path)
        case .simulation:               SimulationView(navigationPath: path)
        case .compartmental:            CompartmentalView(embedded: false)
        // Clinical spine
        case .encounterList:            EncounterListView()
        case .encounterHub(let id):     EncounterHubView(caseID: id)
        case .patientData(let id):      PatientDataScreen(caseID: id)
        case .preAssessment(let id):    PreanestheticView(caseID: id)
        case .technique(let id, let z): TechniqueScreen(caseID: id, zone: z)
        case .monitoring(let id):       MonitoringScreen(caseID: id)
        case .drugLedger(let id):       DrugLedgerScreen(caseID: id)
        case .fluidBalance(let id):     FluidBalanceScreen(caseID: id)
        case .recoveryScore(let id):    RecoveryScreen(caseID: id)
        case .newbornRecord(let id):    NewbornScreen(caseID: id)
        case .reviewExport(let id):     ReviewExportScreen(caseID: id)
        }
    }
}
