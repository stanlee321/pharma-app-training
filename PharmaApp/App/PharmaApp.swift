import SwiftUI

@main
struct PharmaApp: App {
    @State private var appState = AppState()
    @State private var caseStore = MockCaseStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(caseStore)
        }
    }
}
