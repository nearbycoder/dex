import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import type { VmManager } from "../vm"

const text = (value: string) => [{ type: "text" as const, text: value }]
const MAX_MODEL_OUTPUT = 30_000
const clip = (value: string) =>
  value.length > MAX_MODEL_OUTPUT ? `… [${value.length - MAX_MODEL_OUTPUT} earlier chars cut]\n${value.slice(-MAX_MODEL_OUTPUT)}` : value

export const VM_GUIDE = `Your VM is a full Ubuntu machine (user \`user\`, passwordless sudo) with Docker, Node 24, Bun, Python 3.12, git, the GitHub CLI and Google Chrome. Home is /home/user. It starts on demand (first call can take ~30s), stops itself when idle, and keeps its disk across stops. A desktop runs on DISPLAY=:0: GUI apps you launch there (e.g. \`DISPLAY=:0 google-chrome --no-first-run URL &\`) appear on it. The user can watch the desktop and every command you run live on the Machine page, and may take control of the desktop at any time; if something you did changed unexpectedly, take a fresh screenshot.`

export const vmTools = (vm: VmManager) => [
  defineTool({
    name: "vm_exec",
    description:
      `Run a shell command on your cloud VM and get its output. ${VM_GUIDE} ` +
      "Output streams live to the user. Commands time out after timeout_seconds (max 600). For servers, GUI apps, watchers, " +
      "or anything long-running, set background=true and read its log file later; never put `&` in the command, because the call " +
      "waits for every process it starts. Use xdotool (with DISPLAY=:0) to click and type on the desktop.",
    parameters: Type.Object({
      command: Type.String({ description: "Bash command or script." }),
      cwd: Type.Optional(Type.String({ description: "Working directory, relative to /home/user or absolute." })),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, description: "Default 120." })),
      background: Type.Optional(Type.Boolean({ description: "Start it and return immediately with its process id and log paths." }))
    }),
    execute: async ({ command, cwd, timeout_seconds, background }, api, context) => {
      // A trailing `&` would keep the call open until the process exits; start it detached instead.
      const trailingAmpersand = /(^|[^&])&\s*$/.test(command)
      if (background || trailingAmpersand) {
        const detached = trailingAmpersand ? command.replace(/&\s*$/, "").trim() : command
        const started = await vm.spawn(detached, { actor: "agent", cwd, signal: context.abortSignal, onOutput: (data) => api.output(data) })
        return {
          output: text(
            `Started in the background as process ${started.processId}.\nstdout: ${started.logPath}\nstderr: ${started.errLogPath}\n` +
              `Check on it with vm_exec: tail -n 50 ${started.logPath}`
          )
        }
      }
      const result = await vm.exec(command, {
        actor: "agent",
        cwd,
        timeoutSeconds: timeout_seconds ?? 120,
        signal: context.abortSignal,
        onOutput: (data) => api.output(data)
      })
      const exitCode = result.exitCode ?? -1
      return { output: text(`${clip(result.output)}\n[exit code ${exitCode}]`), isError: exitCode !== 0 }
    }
  }),

  defineTool({
    name: "vm_screenshot",
    description:
      "Take a screenshot of your VM's desktop (DISPLAY=:0) to see what is on screen, e.g. before and after clicking with xdotool. " +
      "Returns the image (scaled to fit 1280px) and the real screen size so you can map coordinates.",
    parameters: Type.Object({}),
    execute: async (_args, _api, context) => {
      const shot = await vm.screenshot("agent", context.abortSignal)
      const note =
        shot.scale < 1
          ? `Screen is ${shot.width}×${shot.height}; this image is scaled by ${shot.scale.toFixed(3)}. Divide image coordinates by ${shot.scale.toFixed(3)} for xdotool.`
          : `Screen is ${shot.width}×${shot.height}; image coordinates match xdotool coordinates.`
      return { output: [{ type: "image", data: shot.data, mimeType: "image/jpeg" }, { type: "text", text: note }] }
    }
  }),

  defineTool({
    name: "vm_read_file",
    description: "Read a text file from the VM (under /home/user or /tmp, up to 5 MB).",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async ({ path }, _api, context) => {
      const file = await vm.readFile(path, "agent", "utf8", context.abortSignal)
      return { output: text(clip(file.content)) }
    }
  }),

  defineTool({
    name: "vm_write_file",
    description: "Create or overwrite a file on the VM (under /home/user or /tmp, up to 5 MB). Parent directories are created.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    replay: "safe",
    execute: async ({ path, content }, _api, context) => {
      await vm.writeFile(path, content, "agent", context.abortSignal)
      return { output: text(`Wrote ${content.length} characters to ${path} on the VM.`) }
    }
  }),

  defineTool({
    name: "vm_expose_port",
    description:
      "Give a port on the VM an HTTPS URL (https://<vm>-<port>.on.boat.dev), e.g. to show the user a web app or API you started. " +
      "Private URLs carry an access token; public ones are open to anyone.",
    parameters: Type.Object({
      port: Type.Integer({ minimum: 1, maximum: 65535 }),
      public: Type.Optional(Type.Boolean({ description: "Default false." }))
    }),
    replay: "safe",
    execute: async ({ port, public: isPublic }, _api, context) => {
      const url = await vm.exposePort(port, isPublic ?? false, "agent", context.abortSignal)
      return { output: text(`Port ${port} is at ${url}`) }
    }
  }),

  defineTool({
    name: "vm_stop",
    description: "Stop your VM to save cost when you are done with it. Its disk is kept; the next VM command resumes it.",
    parameters: Type.Object({}),
    execute: async () => {
      await vm.stop("agent")
      return { output: text("VM stopped. Its disk is saved and it resumes on the next VM command.") }
    }
  })
]
