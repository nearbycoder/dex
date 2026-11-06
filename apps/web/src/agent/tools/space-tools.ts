import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import type { ThinkingLevel } from "~/shared/models"
import { START_THREAD_TOOL, type SpaceProfile, THREAD_STATUS_LABELS, type ThreadStatus } from "~/shared/spaces"

/** What the coordinator's tools need from the agent. Every call is checked against the space of the chat making it. */
export interface SpaceHost {
  /** The space whose coordinator this chat is, if it is one. */
  coordinatedSpace(sessionId: string): SpaceProfile | undefined
  startThread(space: SpaceProfile, input: { title: string; prompt: string; model?: string; thinking?: ThinkingLevel; agentId?: string }): Promise<{ id: string; title: string }>
  threads(space: SpaceProfile): ReadonlyArray<{ id: string; title: string; status: ThreadStatus; lastReply: string | null; updatedAt: number }>
  messageThread(threadId: string, message: string, steer: boolean): Promise<void>
  readThread(threadId: string, limit: number): Promise<unknown>
  stopThread(threadId: string): Promise<void>
}

const text = (value: string) => [{ type: "text" as const, text: value }]
const fail = (message: string) => ({ output: text(message), isError: true })

/**
 * The coordinator's tools, in the space extension only coordinator chats get: start threads, message them, read them,
 * list them, stop them. Threads report back on their own when they finish (as a [Space update] message).
 */
export const spaceTools = (host: SpaceHost) => {
  const ownThread = (sessionId: string, threadId: string) => {
    const space = host.coordinatedSpace(sessionId)
    if (!space) return { error: "Only a space's coordinator can use this." }
    if (!host.threads(space).some((thread) => thread.id === threadId)) return { error: `No thread ${threadId} in this space; space_list_threads lists them.` }
    return { space }
  }
  return [
    defineTool({
      name: START_THREAD_TOOL,
      description:
        "Start a thread: a new chat that does one piece of work in parallel, in this space's project (with its own VM). " +
        "Write `prompt` as a complete brief: the thread sees nothing of this conversation. It starts at once and reports " +
        "back here with its final reply when it finishes. Start one per independent piece of work.",
      parameters: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 80, description: "A short name for the work, shown on its card." }),
        prompt: Type.String({ minLength: 1, maxLength: 50_000, description: "The thread's instructions: the goal, context, constraints, and what to report." }),
        model: Type.Optional(Type.String({ description: "A model id for this thread; default: the user's default model." })),
        thinking: Type.Optional(Type.Union(["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => Type.Literal(level)))),
        agent_id: Type.Optional(Type.String({ description: "Start with one of the user's custom agents (app_list_agents)." }))
      }),
      execute: async ({ title, prompt, model, thinking, agent_id }, api) => {
        const space = host.coordinatedSpace(String(api.conversationId))
        if (!space) return fail("Only a space's coordinator can start threads.")
        const thread = await host.startThread(space, { title, prompt, model, thinking: thinking as ThinkingLevel | undefined, agentId: agent_id })
        return {
          output: text(JSON.stringify({ thread_id: thread.id, title: thread.title, status: "working", note: "It reports back here when it finishes." })),
          details: { thread }
        }
      }
    }),
    defineTool({
      name: "space_message_thread",
      description:
        "Send a thread more instructions or answers. If it's working, the message waits until its current run ends, unless " +
        "`steer` is true: then it reaches the thread after its current step.",
      parameters: Type.Object({
        thread_id: Type.String(),
        message: Type.String({ minLength: 1, maxLength: 50_000 }),
        steer: Type.Optional(Type.Boolean())
      }),
      execute: async ({ thread_id, message, steer }, api) => {
        const checked = ownThread(String(api.conversationId), thread_id)
        if ("error" in checked) return fail(checked.error!)
        await host.messageThread(thread_id, message, steer === true)
        return { output: text(`Sent to ${thread_id}.`) }
      }
    }),
    defineTool({
      name: "space_list_threads",
      description: "This space's threads with their status (working, needs you, failed, done) and the start of each one's latest reply.",
      parameters: Type.Object({}),
      replay: "safe",
      execute: async (_args, api) => {
        const space = host.coordinatedSpace(String(api.conversationId))
        if (!space) return fail("Only a space's coordinator can list threads.")
        const threads = host.threads(space)
        if (!threads.length) return { output: text("No threads yet.") }
        return {
          output: text(
            JSON.stringify(
              threads.map((thread) => ({ id: thread.id, title: thread.title, status: THREAD_STATUS_LABELS[thread.status], last_reply: thread.lastReply, updated: new Date(thread.updatedAt).toISOString() })),
              null,
              2
            )
          )
        }
      }
    }),
    defineTool({
      name: "space_read_thread",
      description: "A thread's latest messages (text; tool calls by name): its full report, or how far it got.",
      parameters: Type.Object({
        thread_id: Type.String(),
        last_messages: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, description: "How many recent messages (default 6)." }))
      }),
      replay: "safe",
      execute: async ({ thread_id, last_messages }, api) => {
        const checked = ownThread(String(api.conversationId), thread_id)
        if ("error" in checked) return fail(checked.error!)
        return { output: text(JSON.stringify(await host.readThread(thread_id, last_messages ?? 6), null, 2)) }
      }
    }),
    defineTool({
      name: "space_stop_thread",
      description: "Stop a thread's current run (it keeps what it did; message it to go on).",
      parameters: Type.Object({ thread_id: Type.String() }),
      execute: async ({ thread_id }, api) => {
        const checked = ownThread(String(api.conversationId), thread_id)
        if ("error" in checked) return fail(checked.error!)
        await host.stopThread(thread_id)
        return { output: text(`Stopped ${thread_id}.`) }
      }
    })
  ]
}
