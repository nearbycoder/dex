import AuthenticationServices
import DexCore
import SwiftUI

/// Sign in to a Dex: enter its address, then sign in on its own page in a system browser sheet (GitHub, the owner
/// password, or dev login). The page hands back a one-time code that only this app can redeem (PKCE).
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var server = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            background
            ScrollView {
                VStack(spacing: 28) {
                    Spacer(minLength: 40)
                    Image("DexLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 88, height: 88)
                        .shadow(color: .green.opacity(0.35), radius: 24, y: 8)
                        .accessibilityHidden(true)
                    VStack(spacing: 8) {
                        Text("Sign in to Dex")
                            .font(.largeTitle.bold())
                        Text("Your durable agent, with its own cloud computer.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    form
                    Spacer(minLength: 20)
                }
                .padding(24)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .onAppear {
            if server.isEmpty { server = model.lastServer }
        }
    }

    private var background: some View {
        LinearGradient(colors: [Color.green.opacity(0.22), Color(.systemBackground), Color(.systemBackground)], startPoint: .top, endPoint: .bottom)
            .ignoresSafeArea()
    }

    private var form: some View {
        VStack(spacing: 14) {
            if let message = model.signInMessage ?? error {
                Label(message, systemImage: "exclamationmark.circle")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.red.opacity(0.1), in: .rect(cornerRadius: 14))
                    .accessibilityIdentifier("signin.error")
            }
            HStack(spacing: 10) {
                Image(systemName: "server.rack").foregroundStyle(.secondary)
                TextField("Your Dex address", text: $server, prompt: Text("dex.example.com"))
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit { Task { await signIn() } }
                    .accessibilityIdentifier("signin.server")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .glassEffect(.regular.interactive(), in: .capsule)

            Button {
                Task { await signIn() }
            } label: {
                HStack {
                    if working { ProgressView().tint(.white) }
                    Text(working ? "Signing in…" : "Continue")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(working || AuthClient.normalize(server) == nil)
            .accessibilityIdentifier("signin.continue")

            Text("You'll sign in on your Dex's own page, with GitHub or your password. The app keeps its session in the Keychain on this device.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 4)

            if model.mockAgent != nil {
                Button("Use the demo Dex") { model.signInToMock() }
                    .buttonStyle(.glass)
                    .accessibilityIdentifier("signin.demo")
            }
        }
    }

    private func signIn() async {
        guard let url = AuthClient.normalize(server), !working else {
            error = AuthError.invalidServer.localizedDescription
            return
        }
        working = true
        focused = false
        error = nil
        model.signInMessage = nil
        defer { working = false }
        let pkce = PKCE()
        let auth = AuthClient(server: url)
        do {
            let callback = try await webAuthenticationSession.authenticate(
                using: auth.startURL(challenge: pkce.challenge),
                callback: .customScheme(AuthClient.callbackScheme),
                preferredBrowserSession: .shared,
                additionalHeaderFields: [:]
            )
            try await model.completeSignIn(server: url, callback: callback, pkce: pkce)
        } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
            // Closed the sheet: nothing to say.
        } catch {
            self.error = error.localizedDescription
        }
    }
}
