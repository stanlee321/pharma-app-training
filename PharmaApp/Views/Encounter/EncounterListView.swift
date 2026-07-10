import SwiftUI

/// N1 — the app spine root: lists AnesthesiaCases and creates new ones.
struct EncounterListView: View {
    @Environment(AppState.self) private var appState
    @Environment(MockCaseStore.self) private var store

    var body: some View {
        List {
            Section {
                if store.cases.isEmpty {
                    ContentUnavailableView("No encounters yet",
                                           systemImage: "tray",
                                           description: Text("Tap + to start a new anaesthesia record."))
                }
                ForEach(store.cases) { c in
                    Button {
                        appState.navigationPath.append(Route.encounterHub(c.id))
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.title).font(.headline).foregroundStyle(.primary)
                            Text(c.subtitle).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                }
                .onDelete { offsets in
                    offsets.map { store.cases[$0].id }.forEach(store.delete)
                }
            } header: {
                Text("Encounters")
            }
        }
        .navigationTitle("Encounters")
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Sign Out") { appState.signOut() }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    let c = store.createCase(owner: appState.author?.name ?? "")
                    Haptics.confirm()
                    appState.navigationPath.append(Route.encounterHub(c.id))
                } label: {
                    Label("New", systemImage: "plus")
                }
            }
        }
    }
}
