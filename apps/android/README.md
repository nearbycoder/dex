# Dex for Android

The native Android client for Dex: Kotlin, Jetpack Compose, and Material 3 Expressive. It talks to the same agent as the web app, over its WebSocket and RPC (`apps/web/src/shared/protocol.ts`), and signs in with the native PKCE handoff (`apps/web/src/server/native-auth.ts`).

## Build and run

You need the Android SDK (platform 37, build-tools 37) and a JDK 17+ (Android Studio's JBR works).

```sh
cd apps/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # once
./gradlew :app:installDebug                                    # build and install on a device or emulator
```

**On your phone:** `scripts/install-phone.sh` builds a minified release and installs it over adb, keeping the app's data. It signs with the key named in the gitignored `keystore.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); use the key the phone's copy was installed with, or Android refuses the update. For Wireless debugging, pair once with `PAIR=<ip:port> CODE=<code> scripts/install-phone.sh`, then pass the address the Wireless debugging screen shows.

**Google Play internal testing** (Android's TestFlight): `scripts/play-internal.sh` builds a signed App Bundle and releases it to the internal testing track through the Play Developer API (`scripts/play-upload.mjs`, with R8's mapping for readable crash reports); testers install it from the Play Store and get each upload as an update. The version code is minutes since 2024, so every upload is newer. Setting it up once:

1. `keystore.properties` names your **upload key** (create one with `keytool -genkeypair -keystore upload.jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000`, kept outside the repo). Play App Signing signs what phones get with Google's key, so a lost upload key can be reset in Play Console; a copy installed by `install-phone.sh` has another signature, so uninstall it once before installing from Play.
2. In Play Console, create the app (package `dev.trydex.android`), then under Testing → Internal testing make a testers list and upload the first bundle by hand: `UPLOAD=0 scripts/play-internal.sh` builds `app/build/outputs/bundle/release/app-release.aab`. Accept Play App Signing when asked.
3. For uploads from here: in Google Cloud (any project), enable the Google Play Android Developer API, create a service account and a JSON key for it; in Play Console → Users and permissions, invite its email with access to this app and "Release apps to testing tracks". Put `PLAY_SERVICE_ACCOUNT=<path to the key>` in the gitignored `.deploy.vars` (with `RELEASE_NOTES` or `PLAY_TRACK` if you like).

Until the app's store listing and its content questionnaires are done, Play accepts only draft releases: the script then uploads a draft and says to roll it out in Play Console.

Sign in with your Dex's address (trydex.dev, or your own deployment). The browser opens your Dex's sign-in page, asks you to confirm it's for this app, and returns to the app with `dex://auth/callback`.

**Sign in with ChatGPT** (Settings → ChatGPT): OpenAI sends the browser back only to `http://127.0.0.1:1455/auth/callback`, which Dex's server can't receive. While the sign-in page is open in a Custom Tab, the app listens on that port (`data/LoopbackCallback.kt`), catches the address, hands the browser on to `dex://chatgpt/signed-in` to come back, and finishes the sign-in with the agent. If the port is taken, the page opens in the full browser and you paste the address it lands on, as on the web.

**Appearance** (Settings → Appearance, or `dex://app/appearance`): light, dark, or the system's mode, and ten color themes, the same as the iOS app's (`ui/theme/Themes.kt`). A theme sets only the accent; surfaces are neutral grays, and composer chips stay gray in every theme. On Android 12+ the wallpaper's Material You colors are a further choice. Saved per device and applied at once.

**Push notifications (Firebase, optional):** the agent pushes to the app over Firebase Cloud Messaging when your deployment has `FCM_SERVICE_ACCOUNT` set (apps/web/src/agent/native-push.ts). The app needs your Firebase project's config: put its `google-services.json` (an Android app with package `dev.trydex.android`) at `app/google-services.json`. It's per deployment and gitignored, and the build applies the google-services plugin only when the file is there, so anyone can build without Firebase: the app then notifies from its own connection and a check about every 15 minutes. With it, the app registers its token (`registerNativePush`) on every start and when the token changes, builds each notification from the data-only message itself (a sidekick's comes from them, with their face, on the high-importance **Sidekicks** channel; the rest on **Chats & updates**), sets the badge count, replaces an older notification for the same chat, and opens that chat on tap. It asks for notification permission the first time you open a sidekick or Settings → Notifications, and unregisters and deletes its token when you sign out. Settings → Notifications shows this device's push status, which kinds it gets, a test, and each sidekick's setting (Every message, When they reach out, Off), which their page and the bell in their chat set too. In debug builds, `adb shell am broadcast -n dev.trydex.android/.DebugPush --es kind sidekick --es title Atlas --es body Hi --es sessionId chat-atlas --es url /chat/chat-atlas --es tag chat-chat-atlas --es badge 1` stands in for a push.

**Unread:** chats and sidekicks with a reply you haven't seen are bold with a dot (a sidekick's row shows their latest words), on phones and in the tablet list pane. A chat is read once it's on screen on any device (presence, plus `markSessionRead` as a backup); its menu has Mark as unread. Scheduled prompts show in a chat as a small "⏰ Scheduled: …" note, not as your message.

**Files** (a chat's bar, its menu on phones, or a Machine page): a running VM's files through `vmFiles`, as on the web: every file as a tree, the uncommitted Git changes (added, modified, deleted, renamed, untracked), and a file's source or its unified diff against HEAD, with line numbers, colored lines, folded unchanged stretches, and sideways scrolling for long lines. The diff is a port of the jsdiff the web runs (`core/model` VmFiles, checked by goldens). Wide panes show the list and the file side by side. Looking never starts or wakes the VM; agents from before the panel say to update Dex.

**Spaces** (above the chats, after the sidekicks): a space is a chat with a coordinator that starts other chats, its threads, to do the work in parallel (in the space's project, each on its own VM), hears back when each one ends, and follows up, as on the web (`apps/web/src/shared/spaces.ts`, ported in `core/model` Spaces). Its row says how its threads are doing ("2 working · 1 needs you") with a live dot while any of it works; + makes one (name, goal, project) and opens its chat. In the chat, each thread it starts is a live card (status and latest words; tap to open it), what threads report back shows as small event rows that fold out to their final reply, and the bar's Threads button opens a panel, beside the chat on wide screens and unfolded foldables, with the threads by status (what needs you first) and the coordinator's notes. A thread's chat links back to its space. Space chats aren't in the chat list; the coordinator counts toward the badge and notifies as the space, and threads stay quiet. Its menu edits or deletes the space (with its chat and threads).

**Sidekick looks:** a look is a BoopFace (github.com/CX-ArtLab/BoopFace), as on the web: a robot head with two big eyes and an antenna dot, in a color or one of BoopFace's finishes (`look.finish`). It's shown whole, never cropped to a circle: avatars, the editor, notifications, and widgets. The app draws a plain-color face itself from BoopFace's geometry (`SidekickLooks`, `SidekickArt`; it blinks now and then in a chat's header and the editor, unless animations are off; `SidekickArtTest` checks it against the web's PNG); a finish only the web can draw, so the app shows the PNG it saved (`image`, on a clear background). The editor has the ready-made looks (their bundled PNGs), a Color row, an Accent row, Shuffle, and a photo; more finishes are picked on the web. Saving sends a picture only when the look changed on the phone: a ready-made look's bundled PNG (drawn smaller if it passes the agent's 48 KB) or a color's PNG drawn here, with the finish always stated (`null` for a plain color).

**Calls with sidekicks** (the phone button in a sidekick's current conversation): a live voice call, as on the web (`apps/web/src/shared/voice.ts`, `client/voice/call.ts`). The phone's own speech recognition hears you (on-device when it has it, American English, started again after each utterance); about 0.9 s after your last words what you said goes into their conversation marked as spoken (`sendMessage`'s fourth argument), so they answer briefly in plain sentences. Their reply is read aloud a sentence at a time as it streams in, by tiny-voca (4.5M parameters, ONNX Runtime on the CPU): Dex turns the text into phonemes (`/api/voice/phonemes`), the model makes 24 kHz audio, and an AudioTrack plays it gaplessly as a call (communication mode, the speaker unless headphones are in). Talking over them (two words or more that aren't their own voice leaking into the microphone) stops them, and the rest of that reply goes unsaid. The model (21 MB, `/api/voice/model/model.onnx`) downloads once, with its progress on the call screen, into the app's files, kept by revision. The call ends when you end it, leave the chat, or leave the app. Each sidekick's page has a **Voice** setting (two voices; tapping one plays their greeting in it); without one chosen, the voice comes from their id. The call itself is `core/voice` (turn-taking, the echo check, cutting off, ordering), with the text rules in `core/model` Voice, checked by goldens. The demo's fake knows the phonemes of a few sentences and can't serve the model; to try a demo call, put a copy of the model at the app's `files/voice/tiny-voca-e5f9b11651a4.onnx`.

**Home-screen widgets** (Jetpack Glance, `widget/`): **Sidekick** shows one sidekick (picked when you place it) with their face, name, an unread dot, their latest words, and Message (their chat with the keyboard up); **Sidekicks** shows up to four with unread dots. They read `GET /api/sidekicks` with the stored session every 15 minutes (WorkManager) and on each push, and redraw from the synced state while the app is open; pictures are cached on disk. Signed out, they say "Sign in to Dex".

**Demo:** debug builds have **Try the demo** on the sign-in screen. It starts an in-process fake Dex (`core/fake`) with sample chats, generated UIs, machines, and a desktop, so you can try every screen without an account. Release builds don't include it.

**Against a local Dex:** run `npm run dev` at the repo root (with `DEV_LOGIN=true` in `apps/web/.dev.vars`) and sign in to `http://10.0.2.2:5173` from the emulator. Debug builds allow plain HTTP to `10.0.2.2`, `localhost`, and `127.0.0.1` only.

## Layout

| Module | What it is |
|---|---|
| `core/model` | The wire protocol and synced state, Pi transcripts and their reducer, inbox, snoozes, tools, media, models, and formatting: ports of `apps/web/src/shared` and the client libs, checked against the web's own code by golden tests. |
| `core/client` | The agent socket (reconnects, ordered delivery, RPC with timeouts), native sign-in, and typed wrappers for every callable. |
| `core/openui` | OpenUI's lang-core in Kotlin: the streaming parser, evaluator, store, queries and mutations, actions, and form validation, checked against lang-core by goldens. |
| `core/voice` | Voice calls: the call controller (over injected recognition, voice, and speaker) and tiny-voca on ONNX Runtime (compiled against its JVM build, whose tests run the model; the app brings `onnxruntime-android`). |
| `core/fake` | FakeDex: an in-process stand-in for a deployment, for tests and the demo. |
| `app` | The app: repository, notifications, and the Compose UI (`ui/chat`, `ui/openui`, `ui/machine`, `ui/library`, `ui/settings`, `ui/files`, `ui/usage`). |

Goldens come from the web's TypeScript run by Node: `TZ=America/Chicago node apps/android/tools/goldens/generate.mts`, `node apps/android/tools/goldens/openui.mts`, and `node apps/android/tools/goldens/spaces.mts`, `node apps/android/tools/goldens/ui-action.mts`, and `node apps/android/tools/goldens/voice.mts` (which need nothing installed) from the repo root. Regenerate them when the web's shared code or OpenUI changes, and the Kotlin tests say what drifted.

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
./gradlew :app:recordRoborazziDebug    # every screen at five sizes, light and dark, and a small phone with a large font
./gradlew :app:connectedDebugAndroidTest   # on a running emulator or device
```

`core/voice`'s TinyVocaModelTest runs tiny-voca on fixed phonemes and compares with what onnxruntime-web made of them; it needs the model, so point `DEX_VOICE_MODEL` at a copy (else it's skipped).

## Limits

- **Calls** need the app in front: leaving it ends the call (Android doesn't let an app use the microphone from the background without a foreground service). ONNX Runtime's native code adds about 34 MB per ABI (arm64-v8a), about 140 MB across the four the app ships.

- **Notifications** are instant only with Firebase (above). Without `app/google-services.json`, or on a deployment without `FCM_SERVICE_ACCOUNT`, they're local: from the app's own connection and a check about every 15 minutes, and a sidekick set to "When they reach out" can only tell those apart from replies to messages sent from this device.
- **Widgets** refresh at most every 15 minutes while the app is closed (WorkManager's shortest period), sooner when a push arrives.
- GitHub and MCP sign-ins open in a Custom Tab, which needs the browser to still hold the Dex session from signing in to the app. If it doesn't, sign in there once, or use a token.
