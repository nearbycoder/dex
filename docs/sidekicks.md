# Sidekicks

Named companions you talk to directly, like Dot, Muse, or Grok's companions. Each sidekick is one long conversation that never ends: it stays pinned at the top of the sidebar, remembers you, and has its own personality, voice, and job. Ordinary chats are unchanged and keep their place below.

## What a sidekick is

In code and on the wire they're `characters` (`CharacterProfile`, `characterId`, `saveCharacter`); everywhere a person or a model reads it, they're sidekicks.

| Field | What it's for |
|---|---|
| Name | "Muse". Also the title of its conversation. |
| Tagline | One line under the name in the sidebar ("Your creative sparring partner"). |
| Look | Their face: an [Open Bot Avatar](https://github.com/DominikScholz/open-bot-avatar), a little object with two dark eyes (`look`: `shape`, one of 17 such as a robot, cloud, mug, or cat, and `skin`, one of 10 colors), on one of the agent colors as its accent: one of 13 ready-made sidekicks, a shape and color of your own, Shuffle, or a shape a chat drew (`shape: "custom"` with `custom`: a silhouette and eye placement, checked by Open Bot Avatar's validator). On the web it's alive (see below). A photo can replace it. The agent draws the look's PNG (`image`, 256 px, for the apps, notifications, and widgets) whenever a look is saved, from anywhere. Sidekicks' photos and emoji are round; agents and projects are rounded squares. Ones from before looks had an emoji (`avatar`) and were given a look once; ones that were BoopFaces became the shape nearest theirs (the ready-made ones, their new selves). |
| Character profile (`persona`) | Who they are: personality, voice, backstory, how they talk to you. |
| Prompt (`instructions`) | What they do for you, and their rules. |
| Greeting | Their first words, shown when the conversation is empty. |
| Model, thinking, MCP servers | Like an agent's. Changing them changes the live conversation. |
| Voice (`voice`) | How they sound on calls: tiny-voca's `F2` or `M2`. Missing or null picks one from their id (`voiceOf` in `apps/web/src/shared/voice.ts`), so it stays the same between calls. |
| Memory | `/workspace/sidekicks/<id>/MEMORY.md`, the sidekick's own notes about you and the relationship. They read it on every turn and keep it up to date themselves; you can edit it on their page. |

## How it behaves

- **One conversation, forever.** A sidekick is a regular Dex chat (`SessionMeta.characterId`) that the sidekick points at (`CharacterProfile.sessionId`). Pi Durable compacts it automatically as it grows, so it can run for months; the memory file keeps what a summary might drop.
- **Pinned.** The sidebar shows Sidekicks above Chats, with a + to make one. Their conversations don't appear in the chat list, so it stays an inbox of work.
- **In character.** The system prompt says who they are instead of "You are Dex": the character profile, the prompt, their memory, and that this is a continuing relationship. They keep all of Dex's tools (VM, web, render_ui, schedule_prompt to follow up on their own, app operations).
- **Start over.** Starts a new conversation with the same sidekick and memory; earlier ones are listed on the sidekick's page and stay readable.
- **Delete.** Removes the sidekick; its conversations become ordinary chats, and its memory file stays in the workspace.
- **Calls.** The phone button in their chat starts a voice call (see below).
- **Everything else is a chat.** Notifications, mute, queueing, attachments, VMs, and Files all work as in any chat.
- **Alive.** On the web their face breathes, blinks, looks around, and follows the pointer; while their conversation is running it bends over the work (a call's thinking turns it into three hopping dots), then celebrates when the work is done, or shows an exclamation mark if it failed. Drag the big face on their page to turn it. Lists of messages and notifications show the still picture.

## Calls

A call is their ordinary conversation, spoken. Everything runs on the device except the step from text to phonemes:

1. **Hearing you:** the device's own speech recognition (the Web Speech API in Chrome, Edge, and Safari; `SFSpeechRecognizer` on iOS; `SpeechRecognizer` on Android). A pause of about 0.9 s ends your turn, and the words go to the conversation with `sendMessage(sessionId, text, null, { spoken: true })`.
2. **Answering for the ear:** while the latest message was spoken, the system prompt's `voice_call` section asks for short turns in plain sentences (no Markdown, lists, code, or UI) and says long results go into a file or a later message. A typed message ends that.
3. **Their voice:** the reply is read as it streams, a sentence at a time (`sentenceStream`; code, tables, and links are left out). Each batch of sentences goes to `POST /api/voice/phonemes` (`{ text }` → each sentence's utterances: phoneme `ids` and `stress`), which runs `apps/web/src/server/voice/dizione`, a TypeScript port of tiny-voca's phonemizer checked against the Python original (`npm run test:dizione -w @dex/web`). The app runs [tiny-voca](https://huggingface.co/n4ze3m/tiny-voca) (ONNX, 24 kHz) on each utterance and plays the pieces back to back. The model comes from `GET /api/voice/model/model.onnx?v=<revision>` (21 MB, signed in, kept on the device); the revision is pinned in `TINY_VOCA_REVISION`.
4. **Interrupting:** two or more words from you while they're speaking stop them, and the rest of that reply goes unsaid. Words that match what they just said are taken for the speaker heard through the microphone and ignored.

## API

State: `DexState.characters: CharacterProfile[]` (missing in older agents; default `[]`), and `SessionMeta.characterId: string | null` (default `null`). Both are additive, so released apps keep working: they show a sidekick's conversation as an ordinary chat titled with its name.

Callables:

- `saveCharacter(draft)`: creates (no `id`) or updates; returns the `CharacterProfile`. Creating also creates its conversation.
- `deleteCharacter(id)`
- `restartCharacter(id)`: a new conversation; returns the profile with the new `sessionId`.
- `characterMemory(id)` / `saveCharacterMemory(id, text)`
- `sendMessage(sessionId, text, attachments, { spoken: true })`: a message said on a call (older agents ignore the fourth argument).

Operations: `app_list_sidekicks` and `app_read_sidekick_memory` (read), `app_create_sidekick` and `app_restart_sidekick` (write), and `app_update_sidekick`, `app_delete_sidekick`, and `app_set_sidekick_memory` (admin). Message a sidekick with `app_send_message` on its `session_id`.

## Apps

- **Web:** Sidekicks in the sidebar and under Settings → Sidekicks; the editor at `/sidekicks/<id>` (with templates for a new one); a sidekick's chat shows their avatar and name in the header, their greeting when empty, and "Message <name>…" in the composer.
- **iOS and Android:** they show `image`; their editors pick a ready-made look, or a shape and color, from the pictures bundled from `assets/sidekicks` (each shape's body, tinted, under its eyes, which blink), and save the `look` only: the agent draws its picture. A look a chat drew shows as its picture. Also a pinned Sidekicks section at the top of the chat list (and the iPad / tablet sidebar), the same chat header, greeting, and placeholder, and an editor (Library → Sidekicks) with templates, Start over, and Delete.

## Looks and older apps

`look` keeps the fields of the looks before it (`body`, `eyes`, `mouth`, `extra`, `blush`, `finish`) so apps released before Open Bot Avatar still read it. Those apps draw a BoopFace for a look without a `finish` and show `image` for one with, so the agent always writes `finish: 101` (`LEGACY_FINISH`): they show the new face's picture. When such an app saves a look (no `shape`), its color is kept and its shape stays what it was; the picture it sends is ignored and the agent draws a fresh one. `faceStyle` (stored with the sidekick, not sent) says which way of drawing faces drew the saved picture; bump `FACE_STYLE` in `apps/web/src/agent/sidekick-face.ts` when that changes and every sidekick's picture is redrawn once.
