# Dex for Android

The native Android client for Dex: Kotlin, Jetpack Compose, and Material 3 Expressive. It talks to the same agent as the web app, over its WebSocket and RPC (`apps/web/src/shared/protocol.ts`), and signs in with the native PKCE handoff (`apps/web/src/server/native-auth.ts`).

## Build and run

You need the Android SDK (platform 37, build-tools 37) and a JDK 17+ (Android Studio's JBR works).

```sh
cd apps/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # once
./gradlew :app:installDebug                                    # build and install on a device or emulator
```

Sign in with your Dex's address (trydex.dev, or your own deployment). The browser opens your Dex's sign-in page, asks you to confirm it's for this app, and returns to the app with `dex://auth/callback`.

**Sign in with ChatGPT** (Settings → ChatGPT): OpenAI sends the browser back only to `http://127.0.0.1:1455/auth/callback`, which Dex's server can't receive. While the sign-in page is open in a Custom Tab, the app listens on that port (`data/LoopbackCallback.kt`), catches the address, hands the browser on to `dex://chatgpt/signed-in` to come back, and finishes the sign-in with the agent. If the port is taken, the page opens in the full browser and you paste the address it lands on, as on the web.

**Demo:** debug builds have **Try the demo** on the sign-in screen. It starts an in-process fake Dex (`core/fake`) with sample chats, generated UIs, machines, and a desktop, so you can try every screen without an account. Release builds don't include it.

**Against a local Dex:** run `npm run dev` at the repo root (with `DEV_LOGIN=true` in `apps/web/.dev.vars`) and sign in to `http://10.0.2.2:5173` from the emulator. Debug builds allow plain HTTP to `10.0.2.2`, `localhost`, and `127.0.0.1` only.

## Layout

| Module | What it is |
|---|---|
| `core/model` | The wire protocol and synced state, Pi transcripts and their reducer, inbox, snoozes, tools, media, models, and formatting: ports of `apps/web/src/shared` and the client libs, checked against the web's own code by golden tests. |
| `core/client` | The agent socket (reconnects, ordered delivery, RPC with timeouts), native sign-in, and typed wrappers for every callable. |
| `core/openui` | OpenUI's lang-core in Kotlin: the streaming parser, evaluator, store, queries and mutations, actions, and form validation, checked against lang-core by goldens. |
| `core/fake` | FakeDex: an in-process stand-in for a deployment, for tests and the demo. |
| `app` | The app: repository, notifications, and the Compose UI (`ui/chat`, `ui/openui`, `ui/machine`, `ui/library`, `ui/settings`, `ui/files`, `ui/usage`). |

Goldens come from the web's TypeScript run by Node: `TZ=America/Chicago node apps/android/tools/goldens/generate.mts` and `node apps/android/tools/goldens/openui.mts` from the repo root. Regenerate them when the web's shared code or OpenUI changes, and the Kotlin tests say what drifted.

## Form factors

- Navigation: a bottom bar on phones, a rail from medium widths, an expanded rail on large windows (`NavigationSuiteScaffold`).
- Panes: list and detail side by side from medium widths (tablets, unfolded foldables, desktop windows), with a draggable divider, split at the hinge on book foldables. Editors and a chat's machine open as a third pane on wide windows.
- Foldables: a half-folded device in tabletop posture puts the VM desktop above the fold and its log and command line below.
- The app keeps its state across folding, rotation, resizing, and process death (back stacks, drafts, and open chats are saved).
- Picture-in-picture: leaving the app while a chat's VM desktop is up keeps it playing in Android's PiP window. In the app, the same desktop floats as a draggable, resizable preview.
- ChromeOS and desktop windowing: free resizing (no minimum size), keyboard shortcuts (Enter sends from a hardware keyboard, Shift+Enter for a new line).

## Tests

```sh
./gradlew test                         # unit and Robolectric UI tests (all modules)
./gradlew :app:recordRoborazziDebug    # every screen at five sizes, light and dark, into app/src/test/screenshots
./gradlew :app:connectedDebugAndroidTest   # on a running emulator or device
```

## Limits

- **Notifications** are local: the app notifies from its own connection to your agent, and checks in about every 15 minutes in the background (WorkManager). The agent only sends Web Push (VAPID) today, so there's no instant push to the native app; that needs a server addition (an FCM device type), to be designed together with the iOS app.
- GitHub and MCP sign-ins open in a Custom Tab, which needs the browser to still hold the Dex session from signing in to the app. If it doesn't, sign in there once, or use a token.
