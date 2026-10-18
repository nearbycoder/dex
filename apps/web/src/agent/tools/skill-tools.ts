import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"

const text = (value: string) => [{ type: "text" as const, text: value }]

/** Loads an installed skill's instructions (or one of its files) into the chat. */
export const skillTools = (use: (name: string, file?: string) => string) => [
  defineTool({
    name: "use_skill",
    description:
      "Load an installed skill: its instructions for a kind of task, or one of the files that come with it (references, scripts, " +
      "templates). Load a skill before starting a task it covers, then follow it. Scripts in a skill run on your VM: write them " +
      "there with vm_write_file first.",
    parameters: Type.Object({
      name: Type.String({ maxLength: 64, description: "The skill's name." }),
      file: Type.Optional(Type.String({ maxLength: 300, description: "A file in the skill, by the path its instructions list. Omit for the instructions." }))
    }),
    execute: async ({ name, file }) => {
      try {
        return { output: text(use(name.replace(/^\//, ""), file)), details: { skill: name, ...(file ? { file } : {}) } }
      } catch (error) {
        return { output: text(error instanceof Error ? error.message : String(error)), isError: true }
      }
    }
  })
]
