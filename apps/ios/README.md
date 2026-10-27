# Dex for iPhone and iPad

The native Dex client, in Swift and SwiftUI with Liquid Glass. It talks to the same agent as the web app, over its WebSocket and HTTP API, and needs no server of its own.

## Layout

```
apps/ios/
  project.yml        the Xcode project, generated with XcodeGen (sources are synced folders)
  Dex.xcodeproj      generated from project.yml and committed, so Xcode opens it as is
  DexKit/            Swift package DexCore: everything that isn't a view (builds and tests on macOS too)
    Sources/DexCore/
      JSON/          JSONValue: free-form JSON through the protocol
      Protocol/      DexState and its records, Pi's transcript entries and agent events, dex.* messages
      Transport/     AgentConnection (the Agents SDK protocol: identity, synced state, RPC, reconnects), WebSocketTransport
      Auth/          the PKCE sign-in client and the Keychain store
      State/         DexClient and ChatFeed, the transcript reducer, ReplyLayout, Inbox, models, the device cache
      OpenUI/        the generative UI engine (OpenUI's lang-core in JavaScriptCore)
      Mock/          MockAgent: an in-process agent speaking the real protocol, for tests and demos
    Tests/           Swift Testing: protocol, reducer, connection, cache, and opt-in live-server tests
  Dex/               the app: App, Navigation, SignIn, Chats, Machines, Files, Library, Settings, OpenUI, DesignSystem
  DexTests/          app-level unit tests
  DexUITests/        XCUITests for every screen, on the mock agent
  scripts/           test.sh, build-openui-engine.mjs
```

The wire protocol is `apps/web/src/shared/protocol.ts`; the Swift models decode older and newer agents alike (missing fields get the defaults `withStateDefaults` gives them, unknown events and messages are ignored).

## Run it

Xcode 27 (iOS 26 SDK or later). Open `Dex.xcodeproj` and run the Dex scheme, or regenerate the project after changing `project.yml`:

```sh
brew install xcodegen   # once
cd apps/ios && xcodegen
```

At launch, enter your Dex's address (e.g. `dex.example.com`, or `localhost:5173` for `npm run dev`). The **demo** runs on the built-in mock agent: launch with the argument `-DexMock`.

## Signing in

The app signs in through the server's own sign-in page in a system browser sheet (`ASWebAuthenticationSession`), with the PKCE handoff in `apps/web/src/server/native-auth.ts` (the Android app uses the same one):

1. The app makes a verifier and opens `/auth/native/start?challenge=<SHA-256 of it>`.
2. You sign in as usual (GitHub, the owner password, or dev login), then confirm on a "Sign in to the Dex app?" page.
3. The server redirects to `dex://auth/callback?code=…` with a sealed code that expires in 2 minutes; the app trades it, with the verifier, at `POST /auth/native/token` for the ordinary 30-day session token.
4. The token lives in the Keychain (this device only) and goes with every request as the `dex_session` cookie, so every server check (`activeViewer`, Sign out everywhere) applies unchanged. The app renews it with `POST /auth/native/refresh` when less than a week is left.

Signing in to ChatGPT (Settings → Model Subscriptions) goes the other way: OpenAI sends the browser back only to `http://127.0.0.1:1455/auth/callback`, so while its sign-in sheet is open the app listens on that address itself (`Dex/Settings/ChatGPTSignIn.swift`), takes the callback, and hands it to the agent's `finishChatGPTSignIn`. If the port is taken, the page opens in Safari instead and you paste the address it lands on, as on the web; the paste box stays as a fallback either way.

## Tests

```sh
apps/ios/scripts/test.sh                                   # DexCore, then the app's unit and UI tests on iPhone 18 Pro
DEVICE="iPad Pro 13-inch (M5)" apps/ios/scripts/test.sh    # another simulator
ONLY=DexUITests/ChatUITests apps/ios/scripts/test.sh       # one class
cd apps/ios/DexKit && swift test                           # DexCore only (seconds, no simulator)
```

UI tests run on the mock agent (`-DexMock -DexReset -DexFast`) and save screenshots to `apps/ios/artifacts/` (gitignored). Against a real Dex with dev login (`npm run dev`, `DEV_LOGIN=true`):

- `DEX_LIVE_SERVER=http://localhost:5173 DEX_LIVE_TOKEN=<session token> swift test --filter LiveServerTests` runs DexCore against it (state, RPC, chats, files, refresh, a forged token).
- `TEST_RUNNER_DEX_LIVE_SERVER=http://localhost:5173` on the xcodebuild command line runs `LiveSignInUITests`: the whole sign-in through the browser sheet.

## TestFlight

`scripts/testflight.sh` archives a Release build, signs it for the App Store, and uploads it to App Store Connect, where it shows up in TestFlight once processed. Each upload's build number is the UTC time; bump `MARKETING_VERSION` in `project.yml` for a new version.

Once per deployment:

1. Put your team ID in the gitignored `apps/ios/.deploy.vars`: `DEVELOPMENT_TEAM=ABCDE12345` (`project.yml` leaves it empty so anyone can build their own).
2. In [App Store Connect](https://appstoreconnect.apple.com/apps), add a new iOS app with the bundle ID `dev.trydex.Dex` (the first run of the script registers it if it isn't already). The name must be unique on the App Store.
3. Either sign in to Xcode (Settings → Accounts) with that team, or create an App Store Connect API key (Users and Access → Integrations, App Manager role) and add `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_PATH` to `.deploy.vars`.

Then:

```sh
apps/ios/scripts/testflight.sh            # archive and upload
UPLOAD=0 apps/ios/scripts/testflight.sh   # archive and export build/testflight/Dex.ipa only
```

The app declares that it uses only exempt encryption (`ITSAppUsesNonExemptEncryption`), so builds need no export-compliance answer, and `PrivacyInfo.xcprivacy` lists the required-reason APIs it uses. Internal testers (your team) can install a build as soon as it's processed. External testers need a Beta App Review the first time, and that needs a demo: a Dex address and a sign-in the reviewer can use.

## Devices

iPhone (SE to Pro Max), the foldable iPhone Duo, and iPad. Compact width gets the Liquid Glass tab bar (Chats, Machines, Files, Library, Settings); regular width (iPad, an unfolded foldable, a wide window) gets the sidebar with each Library page and Search, and split views with the list beside the detail. Each window keeps its own place (`Router`), so folding, unfolding, rotating, or resizing keeps the open chat or page. iPad windows each have their own connection, like browser tabs; keyboard shortcuts are in the menu bar (⌘N, ⌘1–7, ⌘E settle, ⌘. stop).

## Notifications

While the app runs (or for a short while in the background) it posts local notifications for replies and failures in chats you're not looking at. A closed app isn't notified: the server sends only Web Push, which can't reach a native app. That needs an APNs sender on the server (and Apple push credentials for the deployment).
