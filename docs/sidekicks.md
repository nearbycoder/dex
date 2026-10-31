# Sidekicks

Named companions you talk to directly, like Dot, Muse, or Grok's companions. Each sidekick is one long conversation that never ends: it stays pinned at the top of the sidebar, remembers you, and has its own personality, voice, and job. Ordinary chats are unchanged and keep their place below.

## What a sidekick is

In code and on the wire they're `characters` (`CharacterProfile`, `characterId`, `saveCharacter`); everywhere a person or a model reads it, they're sidekicks.

| Field | What it's for |
|---|---|
| Name | "Muse". Also the title of its conversation. |
| Tagline | One line under the name in the sidebar ("Your creative sparring partner"). |
| Look | A little character drawn from parts (`look`: body, body color, eyes, mouth, extra, cheeks) on one of the agent colors: one of 12 ready-made ones, a mix of your own, or Shuffle. A photo can replace it. Apps that don't draw looks show the PNG saved with it (`image`, at most 48 KB); the web app draws one for any look set without one (from a chat or MCP). Sidekicks are round; agents and projects are rounded squares. Ones from before looks had an emoji (`avatar`) and were given a look once. |
| Character profile (`persona`) | Who they are: personality, voice, backstory, how they talk to you. |
| Prompt (`instructions`) | What they do for you, and their rules. |
| Greeting | Their first words, shown when the conversation is empty. |
| Model, thinking, MCP servers | Like an agent's. Changing them changes the live conversation. |
| Memory | `/workspace/sidekicks/<id>/MEMORY.md`, the sidekick's own notes about you and the relationship. They read it on every turn and keep it up to date themselves; you can edit it on their page. |

## How it behaves

- **One conversation, forever.** A sidekick is a regular Dex chat (`SessionMeta.characterId`) that the sidekick points at (`CharacterProfile.sessionId`). Pi Durable compacts it automatically as it grows, so it can run for months; the memory file keeps what a summary might drop.
- **Pinned.** The sidebar shows Sidekicks above Chats, with a + to make one. Their conversations don't appear in the chat list, so it stays an inbox of work.
- **In character.** The system prompt says who they are instead of "You are Dex": the character profile, the prompt, their memory, and that this is a continuing relationship. They keep all of Dex's tools (VM, web, render_ui, schedule_prompt to follow up on their own, app operations).
- **Start over.** Starts a new conversation with the same sidekick and memory; earlier ones are listed on the sidekick's page and stay readable.
- **Delete.** Removes the sidekick; its conversations become ordinary chats, and its memory file stays in the workspace.
- **Everything else is a chat.** Notifications, mute, queueing, attachments, VMs, and Files all work as in any chat.

## API

State: `DexState.characters: CharacterProfile[]` (missing in older agents; default `[]`), and `SessionMeta.characterId: string | null` (default `null`). Both are additive, so released apps keep working: they show a sidekick's conversation as an ordinary chat titled with its name.

Callables:

- `saveCharacter(draft)`: creates (no `id`) or updates; returns the `CharacterProfile`. Creating also creates its conversation.
- `deleteCharacter(id)`
- `restartCharacter(id)`: a new conversation; returns the profile with the new `sessionId`.
- `characterMemory(id)` / `saveCharacterMemory(id, text)`

Operations: `app_list_sidekicks` and `app_read_sidekick_memory` (read), `app_create_sidekick` and `app_restart_sidekick` (write), and `app_update_sidekick`, `app_delete_sidekick`, and `app_set_sidekick_memory` (admin). Message a sidekick with `app_send_message` on its `session_id`.

## Apps

- **Web:** Sidekicks in the sidebar and under Settings → Sidekicks; the editor at `/sidekicks/<id>` (with templates for a new one); a sidekick's chat shows their avatar and name in the header, their greeting when empty, and "Message <name>…" in the composer.
- **iOS and Android:** they show `image`; their editors pick from the ready-made looks bundled from `assets/sidekicks` (saving its `look` and PNG). Also a pinned Sidekicks section at the top of the chat list (and the iPad / tablet sidebar), the same chat header, greeting, and placeholder, and an editor (Library → Sidekicks) with templates, Start over, and Delete.
