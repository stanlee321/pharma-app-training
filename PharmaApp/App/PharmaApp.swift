import SwiftUI

@main
struct PharmaApp: App {
    @State private var appState = AppState()
    @State private var caseStore = MockCaseStore(backend: CaseStoreProvider.makeBackend())

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(caseStore)
        }
    }
}
