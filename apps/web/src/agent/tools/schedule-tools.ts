import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import type { ScheduledPrompt } from "~/shared/protocol"

export interface Scheduler {
  schedulePrompt(input: {
    prompt: string
    when: Date | number | string
    sessionId: string | null
  }): Promise<ScheduledPrompt>
  listScheduledPrompts(): Promise<ScheduledPrompt[]>
  cancelScheduledPrompt(id: string): Promise<boolean>
}

const text = (value: string) => [{ type: "text" as const, text: value }]

export const scheduleTools = (scheduler: Scheduler) => [
  defineTool({
    name: "schedule_prompt",
    description:
      "Schedule a prompt for yourself to run once later: at a time or after a delay. Use for reminders and follow-ups. " +
      "The prompt runs in this chat unless new_chat is true. For a recurring (cron) schedule, use app_call with app_schedule_prompt; " +
      "it asks the user to confirm.",
    parameters: Type.Object({
      prompt: Type.String({ description: "What to do when it fires, written as an instruction to yourself." }),
      at: Type.Optional(Type.String({ description: "ISO 8601 date-time to run once." })),
      delay_seconds: Type.Optional(Type.Integer({ minimum: 1, description: "Run once after this many seconds." })),
      new_chat: Type.Optional(Type.Boolean({ description: "Start a fresh chat each time instead of using this one." }))
    }),
    execute: async ({ prompt, at, delay_seconds, new_chat }, api) => {
      const choices = [at, delay_seconds].filter((value) => value !== undefined)
      if (choices.length !== 1) return { output: text("Give exactly one of at or delay_seconds."), isError: true }
      let when: Date | number | string
      if (at !== undefined) {
        const date = new Date(at)
        if (Number.isNaN(date.getTime())) return { output: text(`Not a valid date: ${at}`), isError: true }
        when = date
      } else {
        when = delay_seconds!
      }
      const scheduled = await scheduler.schedulePrompt({ prompt, when, sessionId: new_chat ? null : String(api.conversationId) })
      return { output: text(`Scheduled ${scheduled.id} (${scheduled.cron ? `cron ${scheduled.cron}` : scheduled.when}).`) }
    }
  }),
  defineTool({
    name: "list_scheduled_prompts",
    description: "List prompts you have scheduled.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const all = await scheduler.listScheduledPrompts()
      return { output: text(all.length ? JSON.stringify(all, null, 2) : "Nothing is scheduled.") }
    }
  }),
  defineTool({
    name: "cancel_scheduled_prompt",
    description: "Cancel a scheduled prompt by id.",
    parameters: Type.Object({ id: Type.String() }),
    replay: "safe",
    execute: async ({ id }) =>
      (await scheduler.cancelScheduledPrompt(id))
        ? { output: text(`Cancelled ${id}.`) }
        : { output: text(`No scheduled prompt ${id}.`), isError: true }
  })
]
