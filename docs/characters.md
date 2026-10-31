# Characters

Named companions you talk to directly, like Dot, Muse, or Grok's companions. Each character is one long conversation that never ends: it stays pinned at the top of the sidebar, remembers you, and has its own personality, voice, and job. Ordinary chats are unchanged and keep their place below.

## What a character is

| Field | What it's for |
|---|---|
| Name | "Muse". Also the title of its conversation. |
| Tagline | One line under the name in the sidebar ("Your creative sparring partner"). |
| Avatar | An emoji on one of the agent colors, or a picture (a small data: URL, at most 48 KB) instead. Characters are round; agents and projects are rounded squares. |
| Character profile (`persona`) | Who they are: personality, voice, backstory, how they talk to you. |
| Prompt (`instructions`) | What they do for you, and their rules. |
| Greeting | Their first words, shown when the conversation is empty. |
| Model, thinking, MCP servers | Like an agent's. Changing them changes the live conversation. |
| Memory | `/workspace/characters/<id>/MEMORY.md`, the character's own notes about you and the relationship. They read it on every turn and keep it up to date themselves; you can edit it on the character's page. |

## How it behaves

- **One conversation, forever.** A character is a regular Dex chat (`SessionMeta.characterId`) that the character points at (`CharacterProfile.sessionId`). Pi Durable compacts it automatically as it grows, so it can run for months; the memory file keeps what a summary might drop.
- **Pinned.** The sidebar shows Characters above Chats, with a + to make one. Their conversations don't appear in the chat list, so it stays an inbox of work.
- **In character.** The system prompt says who they are instead of "You are Dex": the character profile, the prompt, their memory, and that this is a continuing relationship. They keep all of Dex's tools (VM, web, render_ui, schedule_prompt to follow up on their own, app operations).
- **Start over.** Starts a new conversation with the same character and memory; earlier ones are listed on the character's page and stay readable.
- **Delete.** Removes the character; its conversations become ordinary chats, and its memory file stays in the workspace.
- **Everything else is a chat.** Notifications, mute, queueing, attachments, VMs, and Files all work as in any chat.

## API

State: `DexState.characters: CharacterProfile[]` (missing in older agents; default `[]`), and `SessionMeta.characterId: string | null` (default `null`). Both are additive, so released apps keep working: they show a character's conversation as an ordinary chat titled with its name.

Callables:

- `saveCharacter(draft)`: creates (no `id`) or updates; returns the `CharacterProfile`. Creating also creates its conversation.
- `deleteCharacter(id)`
- `restartCharacter(id)`: a new conversation; returns the profile with the new `sessionId`.
- `characterMemory(id)` / `saveCharacterMemory(id, text)`

Operations: `app_list_characters` (read), `app_create_character` (write), `app_restart_character` (write), `app_update_character`, `app_delete_character`, and `app_set_character_memory` (admin). Message a character with `app_send_message` on its `session_id`.

## Apps

- **Web:** Characters in the sidebar and under Settings → Characters; the editor at `/characters/<id>` (with templates for a new one); a character's chat shows their avatar and name in the header, their greeting when empty, and "Message <name>…" in the composer.
- **iOS and Android:** a pinned Characters section at the top of the chat list (and the iPad / tablet sidebar), the same chat header, greeting, and placeholder, and an editor (Library → Characters) with templates, Start over, and Delete.
