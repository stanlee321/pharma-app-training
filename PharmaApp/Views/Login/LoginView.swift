import SwiftUI

/// Mock sign-in gate (ADR-3): captures a session author, then re-roots into the encounter list.
struct LoginView: View {
    @Environment(AppState.self) private var appState
    @State private var name = ""
    @State private var role = "Anestesiólogo"

    private let roles = ["Anestesiólogo", "Residente", "Cirujano"]

    /// Backend base URL — editable here so a physical device can point at the Mac without a rebuild.
    @AppStorage("backend_base_url") private var serverURL = CaseStoreProvider.defaultBaseURL

    var body: some View {
        VStack(spacing: Spacing.section) {
            Spacer()

            VStack(spacing: Spacing.tight) {
                Image(systemName: "cross.case.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(AppColors.selectionTint)
                Text("TivaTrainer").font(.drugTitle)
                Text("Sign in to continue")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: Spacing.item) {
                LabeledTextRow(label: "Name / Clave", text: $name, placeholder: "e.g. Dr. Pérez")
                Picker("Role", selection: $role) {
                    ForEach(roles, id: \.self) { Text($0) }
                }
                .pickerStyle(.segmented)

                HStack {
                    Text("Server").foregroundStyle(.secondary)
                    Spacer()
                    TextField("http://192.168.0.29:8000/api/v1", text: $serverURL)
                        .multilineTextAlignment(.trailing)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .font(.caption)
                }
                .frame(minHeight: Spacing.tapTarget)
            }
            .padding(Spacing.section)
            .cardStyle()

            Button {
                Haptics.confirm()
                appState.signIn(name: name.isEmpty ? "Clinician" : name, role: role)
            } label: {
                Text("Sign In")
                    .frame(maxWidth: .infinity)
                    .frame(height: Spacing.tapTarget)
            }
            .buttonStyle(.borderedProminent)

            Spacer()
        }
        .padding(Spacing.screen)
    }
}
