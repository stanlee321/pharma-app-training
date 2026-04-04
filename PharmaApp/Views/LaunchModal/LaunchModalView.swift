import SwiftUI

struct LaunchModalView: View {
    @Binding var isPresented: Bool
    var onDismiss: () -> Void

    var body: some View {
        ZStack {
            // Dimmed background
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture { /* block taps */ }

            // Modal card
            VStack(spacing: 0) {
                // Title
                Text("Important message")
                    .font(.title3.bold())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 12)

                // Body
                ScrollView {
                    Text("""
                    TivatrainerX is going to be replaced by a new version \
                    that will run on multiple platforms. Stay tuned for updates \
                    and new features coming soon.
                    """)
                    .font(.body)
                    .foregroundStyle(.secondary)
                }
                .frame(maxHeight: 200)
                .padding(.bottom, 20)

                // Buttons
                VStack(spacing: 10) {
                    Button {
                        openURL("https://example.com/info")
                    } label: {
                        Text("More info")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        openURL("https://example.com/discount")
                    } label: {
                        Text("Claim your discount")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button {
                        onDismiss()
                        withAnimation(.easeOut(duration: 0.25)) {
                            isPresented = false
                        }
                    } label: {
                        Text("Continue with TivatrainerX")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }

                // Footer
                Text("Links also present in info screen")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 12)
            }
            .padding(24)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal, 32)
        }
        .transition(.opacity)
    }

    private func openURL(_ string: String) {
        guard let url = URL(string: string) else { return }
        UIApplication.shared.open(url)
    }
}
