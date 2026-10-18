import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-durable"
import { VM_ENV_FILE } from "../secrets"
import type { VmManager } from "../vm"

const text = (value: string) => [{ type: "text" as const, text: value }]
const MAX_MODEL_OUTPUT = 30_000
const clip = (value: string) =>
  value.length > MAX_MODEL_OUTPUT ? `… [${value.length - MAX_MODEL_OUTPUT} earlier chars cut]\n${value.slice(-MAX_MODEL_OUTPUT)}` : value

export const VM_GUIDE = `This chat has its own VM (other chats have their own), a full Ubuntu machine (user \`user\`, passwordless sudo) with Docker, Node 24, Bun, Python 3.12, git, the GitHub CLI and Google Chrome. Home is /home/user. It starts the first time you use a VM tool in this chat (that call can take ~30s) and keeps its disk across stops. It stops itself after a few minutes with no VM tool calls running, even if a background server is still up, so check that servers you started are still running before relying on them later. A desktop runs on DISPLAY=:0: GUI apps you launch there (e.g. \`DISPLAY=:0 google-chrome --no-first-run URL &\`) appear on it. The user can watch the desktop and every command you run live on the Machine page, and may take control of the desktop at any time; if something you did changed unexpectedly, take a fresh screenshot.`

/** The chat's secrets (see SecretVault): filled in on the VM, never shown to the model. */
export interface VmSecrets {
  /** Loads the chat's and account's secrets for masking, and brings the VM's env file up to date. */
  prepare(chatId: string): Promise<unknown>
  command(chatId: string, command: string): Promise<{ command: string; env: string | null }>
  fill(chatId: string, content: string): Promise<string>
}

const SECRET_NOTE =
  " Secrets the user entered in a password field appear as {{secret:name}}: use that placeholder (unquoted or in double quotes) " +
  "and Dex fills in the value on the VM; it's masked back in output, so you never see it."

/** Each chat has its own VM; `vmFor` finds the calling chat's. */
export const vmTools = (vmFor: (chatId: string) => VmManager, secrets: VmSecrets) => [
  defineTool({
    name: "vm_exec",
    description:
      `Run a shell command on your cloud VM and get its output. ${VM_GUIDE} ` +
      "Output streams live to the user. Commands time out after timeout_seconds (max 600). For servers, GUI apps, watchers, " +
      "or anything long-running, set background=true and read its log file later; never put `&` in the command, because the call " +
      "waits for every process it starts. To click, type, or scroll on the desktop, use vm_computer (it returns a fresh screenshot)." +
      SECRET_NOTE,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command or script." }),
      cwd: Type.Optional(Type.String({ description: "Working directory, relative to /home/user or absolute." })),
      timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600, description: "Default 120." })),
      background: Type.Optional(Type.Boolean({ description: "Start it and return immediately with its process id and log paths." }))
    }),
    execute: async ({ command: written, cwd, timeout_seconds, background }, api, context) => {
      const chatId = String(api.conversationId)
      const vm = vmFor(chatId)
      await secrets.prepare(chatId)
      // Secrets reach the command as environment variables, defined in a file it sources and deletes first.
      const resolved = await secrets.command(chatId, written)
      // Saved secrets (Settings → Secrets) load from the VM's env file before every command.
      let command = `. ${VM_ENV_FILE} 2>/dev/null\n${resolved.command}`
      if (resolved.env) {
        const file = `/tmp/.dex-env-${crypto.randomUUID()}`
        await vm.writeFile(file, resolved.env, "agent", context.abortSignal)
        command = `. ${file}; rm -f ${file}\n${command}`
      }
      const title = written
      // A trailing `&` would keep the call open until the process exits; start it detached instead.
      const trailingAmpersand = /(^|[^&])&\s*$/.test(command)
      if (background || trailingAmpersand) {
        const detached = trailingAmpersand ? command.replace(/&\s*$/, "").trim() : command
        const started = await vm.spawn(detached, {
          actor: "agent",
          cwd,
          signal: context.abortSignal,
          onOutput: (data) => api.output(data),
          title: title.replace(/&\s*$/, "").trim()
        })
        return {
          output: text(
            `Started in the background as process ${started.processId}.\nstdout: ${started.logPath}\nstderr: ${started.errLogPath}\n` +
              `Check on it with vm_exec: tail -n 50 ${started.logPath}`
          )
        }
      }
      const result = await vm.exec(command, {
        actor: "agent",
        title,
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
      "Take a screenshot of your VM's desktop (DISPLAY=:0) to see what is on screen. To act on it, vm_computer clicks, types, or scrolls and returns a screenshot in one call. " +
      "Returns the image (scaled to fit 1280px) and the real screen size so you can map coordinates.",
    parameters: Type.Object({}),
    execute: async (_args, api, context) => {
      const vm = vmFor(String(api.conversationId))
      const shot = await vm.screenshot("agent", context.abortSignal)
      const note =
        shot.scale < 1
          ? `Screen is ${shot.width}×${shot.height}; this image is scaled by ${shot.scale.toFixed(3)}. Divide image coordinates by ${shot.scale.toFixed(3)} for xdotool.`
          : `Screen is ${shot.width}×${shot.height}; image coordinates match xdotool coordinates.`
      return { output: [{ type: "image", data: shot.data, mimeType: "image/jpeg" }, { type: "text", text: note }] }
    }
  }),

  defineTool({
    name: "vm_computer",
    description:
      "Use your VM's desktop (DISPLAY=:0) like a person: click, double-click, right-click, drag, type, press keys, scroll, or wait, " +
      "and get a fresh screenshot back in the same call (after settle_ms, default 600). x/y are pixels in the latest screenshot " +
      "image; Dex maps them to the screen. action=screenshot just looks. Prefer this over vm_exec + xdotool + vm_screenshot: one " +
      "call per step. Keys use xdotool names: Return, Tab, Escape, BackSpace, ctrl+l, ctrl+shift+t, alt+Left, Page_Down." +
      SECRET_NOTE,
    parameters: Type.Object({
      action: Type.Union(
        ["screenshot", "click", "double_click", "right_click", "middle_click", "move", "drag", "type", "key", "scroll", "wait"].map((value) =>
          Type.Literal(value)
        )
      ),
      x: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000, description: "Image x for click, move, drag start, or where to scroll." })),
      y: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
      to_x: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000, description: "Drag end." })),
      to_y: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
      text: Type.Optional(Type.String({ maxLength: 4_000, description: "For type: the text to type (into whatever has focus)." })),
      keys: Type.Optional(Type.String({ maxLength: 120, pattern: "^[A-Za-z0-9_+\\- ]+$", description: "For key: one or more key combos, space-separated." })),
      direction: Type.Optional(Type.Union([Type.Literal("up"), Type.Literal("down"), Type.Literal("left"), Type.Literal("right")])),
      amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, description: "Scroll steps (default 5)." })),
      seconds: Type.Optional(Type.Number({ minimum: 0.1, maximum: 30, description: "For wait." })),
      settle_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 5_000, description: "Pause before the screenshot (default 600)." }))
    }),
    execute: async (args, api, context) => {
      const chatId = String(api.conversationId)
      const vm = vmFor(chatId)
      // Everything numeric goes into the shell command, so it's coerced and clamped here too, whatever validated it.
      const int = (value: number | undefined, max: number) => Math.min(max, Math.max(0, Math.round(Number(value) || 0)))
      const point = (x: number | undefined, y: number | undefined, what: string) => {
        if (x === undefined || y === undefined) throw new Error(`${args.action} needs ${what}.`)
        return `X=$(map ${int(x, 10_000)}); Y=$(map ${int(y, 10_000)})`
      }
      // Screenshot pixels to screen pixels (see DESKTOP_PRELUDE: L is the screen's longer side).
      const lines = [`map() { awk -v v="$1" -v l="$L" 'BEGIN { s = (l > 1280) ? l / 1280 : 1; printf "%d", v * s + 0.5 }'; }`]
      let title: string = args.action
      let env: string | null = null
      switch (args.action) {
        case "screenshot":
          title = "screenshot"
          break
        case "click":
        case "double_click":
        case "right_click":
        case "middle_click": {
          const button = args.action === "right_click" ? 3 : args.action === "middle_click" ? 2 : 1
          const repeat = args.action === "double_click" ? " --repeat 2 --delay 80" : ""
          lines.push(point(args.x, args.y, "x and y"), `xdotool mousemove --sync "$X" "$Y" click${repeat} ${button}`)
          title = `${String(args.action).replace("_", " ")} ${args.x},${args.y}`
          break
        }
        case "move":
          lines.push(point(args.x, args.y, "x and y"), `xdotool mousemove --sync "$X" "$Y"`)
          title = `move ${args.x},${args.y}`
          break
        case "drag":
          lines.push(
            point(args.x, args.y, "x and y"),
            `TX=$(map ${int(args.to_x, 10_000)}); TY=$(map ${int(args.to_y, 10_000)})`,
            `xdotool mousemove --sync "$X" "$Y" mousedown 1 sleep 0.1 mousemove --sync "$TX" "$TY" sleep 0.1 mouseup 1`
          )
          if (args.to_x === undefined || args.to_y === undefined) throw new Error("drag needs to_x and to_y.")
          title = `drag ${args.x},${args.y} → ${args.to_x},${args.to_y}`
          break
        case "type": {
          if (!args.text) throw new Error("type needs text.")
          // Double-quoted for bash; secret placeholders become variables the command defines (see VmSecrets).
          const quoted = args.text.replace(/[\\"$`]/g, (char) => `\\${char}`)
          await secrets.prepare(chatId)
          const resolved = await secrets.command(chatId, `xdotool type --delay 12 -- "${quoted}"`)
          lines.push(resolved.command)
          env = resolved.env
          title = `type ${JSON.stringify(args.text.length > 40 ? `${args.text.slice(0, 40)}…` : args.text)}`
          break
        }
        case "key":
          if (!args.keys || !/^[A-Za-z0-9_+\- ]+$/.test(args.keys)) throw new Error("key needs keys: xdotool key names, e.g. ctrl+l Return.")
          lines.push(`xdotool key --delay 40 -- ${args.keys.trim()}`)
          title = `key ${args.keys.trim()}`
          break
        case "scroll": {
          const button = { up: 4, down: 5, left: 6, right: 7 }[args.direction ?? "down"] ?? 5
          if (args.x !== undefined && args.y !== undefined) lines.push(point(args.x, args.y, "x and y"), `xdotool mousemove --sync "$X" "$Y"`)
          lines.push(`xdotool click --repeat ${int(args.amount ?? 5, 30) || 1} --delay 30 ${button}`)
          title = `scroll ${args.direction ?? "down"} ${args.amount ?? 5}`
          break
        }
        case "wait":
          lines.push(`sleep ${(Math.min(30, Math.max(0.1, Number(args.seconds) || 1))).toFixed(2)}`)
          title = `wait ${args.seconds ?? 1}s`
          break
      }
      if (args.action !== "screenshot" && args.action !== "wait") lines.push(`sleep ${(int(args.settle_ms ?? 600, 5_000) / 1000).toFixed(2)}`)
      const shot = await vm.desktop(lines.join("\n"), title, "agent", context.abortSignal, env)
      const imageWidth = Math.round(shot.width * shot.scale)
      const imageHeight = Math.round(shot.height * shot.scale)
      return {
        output: [
          { type: "image", data: shot.data, mimeType: "image/jpeg" },
          { type: "text", text: `Screen ${shot.width}×${shot.height}; this image is ${imageWidth}×${imageHeight}. Give x/y in this image's pixels.` }
        ]
      }
    }
  }),

  defineTool({
    name: "vm_read_file",
    description: "Read a text file from the VM (under /home/user or /tmp, up to 5 MB). Secret values in it are shown as {{secret:name}}.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async ({ path }, api, context) => {
      const vm = vmFor(String(api.conversationId))
      await secrets.prepare(String(api.conversationId))
      const file = await vm.readFile(path, "agent", "utf8", context.abortSignal)
      return { output: text(clip(file.content)) }
    }
  }),

  defineTool({
    name: "vm_write_file",
    description:
      "Create or overwrite a file on the VM (under /home/user or /tmp, up to 5 MB). Parent directories are created. " +
      "{{secret:name}} placeholders in the content are written as the secret's value (e.g. an env file; chmod 600 it after).",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    replay: "safe",
    execute: async ({ path, content }, api, context) => {
      const vm = vmFor(String(api.conversationId))
      await vm.writeFile(path, await secrets.fill(String(api.conversationId), content), "agent", context.abortSignal)
      return { output: text(`Wrote ${content.length} characters to ${path} on the VM.`) }
    }
  }),

  defineTool({
    name: "vm_expose_port",
    description:
      "Give a port on the VM an HTTPS URL (https://<vm>-<port>.on.boat.dev), e.g. to show the user a web app or API you started. " +
      "The URL carries an access token, so only people you give it to can open it. Only the user can make a port public " +
      "(on the Machine page); ask them if something needs a public URL. Ports are for live apps only: to show the user a video, " +
      "audio file, or image, use share_media instead. A file served over a port stops working when the VM sleeps, and simple " +
      "file servers (python -m http.server) can't stream video, so it won't play on iPhones.",
    parameters: Type.Object({
      port: Type.Integer({ minimum: 1, maximum: 65535 })
    }),
    replay: "safe",
    // Never public from here: a prompt-injected agent could otherwise open a backdoor to the VM.
    execute: async ({ port }, api, context) => {
      const vm = vmFor(String(api.conversationId))
      const url = await vm.exposePort(port, false, "agent", context.abortSignal)
      return { output: text(`Port ${port} is at ${url}`) }
    }
  }),

  defineTool({
    name: "vm_stop",
    description: "Stop your VM to save cost when you are done with it. Its disk is kept; the next VM command resumes it.",
    parameters: Type.Object({}),
    execute: async (_args, api) => {
      const vm = vmFor(String(api.conversationId))
      await vm.stop("agent")
      return { output: text("VM stopped. Its disk is saved and it resumes on the next VM command.") }
    }
  })
]
