import { Context, Effect, Layer, Option, Schedule, Schema, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"

export const BOAT_API = "https://boat.dev/api/v1"

export class BoatError extends Schema.TaggedError<BoatError>()("BoatError", {
  /** boat's error code, e.g. `machine_not_running`, or `not_configured` / `network` / `invalid_response`. */
  code: Schema.String,
  status: Schema.Number,
  message: Schema.String,
  retryable: Schema.Boolean
}) {}

const OptionalString = Schema.optional(Schema.NullOr(Schema.String))

export const Sandbox = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  type: OptionalString,
  url: OptionalString,
  ip: OptionalString,
  archiveAfter: OptionalString,
  updatedAt: OptionalString,
  desktopAvailable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  stop: Schema.optional(Schema.NullOr(Schema.Struct({ status: OptionalString })))
})
export type Sandbox = typeof Sandbox.Type

const SandboxEnvelope = Schema.Struct({ sandbox: Sandbox })

export const CommandResult = Schema.Struct({
  exitCode: Schema.NullOr(Schema.Number),
  stdout: Schema.optional(Schema.String),
  stderr: Schema.optional(Schema.String),
  timedOut: Schema.optional(Schema.Boolean),
  oomKilled: Schema.optional(Schema.Boolean),
  signal: OptionalString
})
export type CommandResult = typeof CommandResult.Type

const CommandStarted = Schema.Struct({
  processId: Schema.Number,
  logPath: Schema.String,
  errLogPath: Schema.String
})

const FileRead = Schema.Struct({ content: Schema.String, size: Schema.Number })
const PortHosted = Schema.Struct({ url: Schema.String })
const DesktopResponse = Schema.Struct({ type: Schema.String, desktopUrl: OptionalString })

const StreamFrame = Schema.Union([
  Schema.Struct({ type: Schema.Literal("started") }),
  Schema.Struct({ type: Schema.Literals(["stdout", "stderr"]), data: Schema.String }),
  Schema.Struct({ type: Schema.Literal("exit"), exitCode: Schema.NullOr(Schema.Number), timedOut: Schema.optional(Schema.Boolean), oomKilled: Schema.optional(Schema.Boolean), signal: OptionalString }),
  Schema.Struct({ type: Schema.Literal("error"), error: Schema.optional(Schema.String), message: Schema.optional(Schema.String) })
])
const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(StreamFrame))

const ErrorBody = Schema.Struct({
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Struct({ details: Schema.optional(Schema.Struct({ retryable: Schema.optional(Schema.Boolean) })) }))
})

const MAX_COLLECTED_OUTPUT = 1_000_000

const RETRYABLE = new Set(["sandbox_starting", "boat_starting", "no_ready_machine", "out_of_capacity", "rate_limited", "network"])

/**
 * Cloudflare's own errors for a Worker subrequest it couldn't connect to boat.dev's server (521 down, 522 timed out,
 * 523 unreachable): the request never got there, so any of them is safe to send again.
 */
const UNREACHED = new Set([521, 522, 523])
/** Gateway errors and dropped connections: the request may have arrived, so only idempotent ones are resent. */
const TRANSIENT = new Set([0, 502, 503, 504, 520, 524])

const describeStatus = (status: number) =>
  UNREACHED.has(status)
    ? `Couldn't connect to boat.dev (Cloudflare ${status}: ${status === 522 ? "connection timed out" : status === 521 ? "server down" : "server unreachable"})`
    : `boat.dev returned ${status}`

export type SandboxType = "small" | "default" | "large"

export interface ExecOptions {
  readonly cwd?: string
  readonly timeoutSeconds?: number
  readonly onOutput?: (stream: "stdout" | "stderr", data: string) => void
}

/**
 * The boat.dev key for this agent's requests, read on each one: the key its user connected in Settings, or for the
 * owner the deployment's BOAT_API_KEY. None: VMs aren't available to this user.
 */
export class BoatKey extends Context.Service<BoatKey, { readonly get: Effect.Effect<Option.Option<string>> }>()("dex/agent/BoatKey") {}

/** boat.dev cloud VMs: lifecycle, commands, files, ports, and the live desktop. */
export class BoatClient extends Context.Service<BoatClient, {
  create(options: { type: SandboxType; ttlSeconds: number; idempotencyKey: string }): Effect.Effect<Sandbox, BoatError>
  get(id: string): Effect.Effect<Sandbox, BoatError>
  resume(id: string, ttlSeconds: number): Effect.Effect<Sandbox, BoatError>
  stop(id: string): Effect.Effect<void, BoatError>
  remove(id: string): Effect.Effect<void, BoatError>
  extend(id: string, ttlSeconds: number): Effect.Effect<Sandbox, BoatError>
  /** Runs a command, streaming its output to `onOutput`; resolves with the exit status. */
  exec(id: string, command: string, options?: ExecOptions): Effect.Effect<CommandResult, BoatError>
  /** Starts a command that keeps running after the call returns. */
  spawn(id: string, command: string, cwd?: string): Effect.Effect<typeof CommandStarted.Type, BoatError>
  readFile(id: string, path: string, encoding?: "utf8" | "base64"): Effect.Effect<typeof FileRead.Type, BoatError>
  writeFile(id: string, path: string, content: string, encoding?: "utf8" | "base64"): Effect.Effect<void, BoatError>
  hostPort(id: string, port: number, isPublic: boolean): Effect.Effect<string, BoatError>
  /**
   * A desktop URL: `stream` (low-latency WebCodecs player, Chromium only) or `vnc` (noVNC, works everywhere).
   * noVNC is requested with public access: no cookie, gated by the VNC password in the URL, so it also works
   * embedded in Safari, which blocks the third-party cookie the private route needs. Undefined while provisioning.
   */
  desktop(id: string, mode: "stream" | "vnc"): Effect.Effect<string | undefined, BoatError>
}>()("dex/agent/BoatClient") {
  static readonly layer = Layer.effect(
    BoatClient,
    Effect.gen(function*() {
      const boatKey = yield* BoatKey
      const http = yield* HttpClient.HttpClient

      const notConfigured = new BoatError({ code: "not_configured", status: 0, message: "No boat.dev key: connect yours in Settings → Cloud VMs.", retryable: false })

      const failFrom = Effect.fnUntraced(function*(response: HttpClientResponse.HttpClientResponse) {
        const json = yield* response.json.pipe(Effect.orElseSucceed(() => ({})))
        const body = Option.getOrElse(Schema.decodeUnknownOption(ErrorBody)(json), () => ({}) as typeof ErrorBody.Type)
        const code = body.code ?? `http_${response.status}`
        return yield* new BoatError({
          code,
          status: response.status,
          message: body.message ?? describeStatus(response.status),
          retryable: body.error?.details?.retryable ?? RETRYABLE.has(code)
        })
      })

      const attempt = Effect.fnUntraced(function*(request: HttpClientRequest.HttpClientRequest) {
        const key = yield* boatKey.get
        if (Option.isNone(key)) return yield* notConfigured
        const response = yield* http.execute(request.pipe(HttpClientRequest.bearerToken(key.value))).pipe(
          Effect.mapError((cause) => new BoatError({ code: "network", status: 0, message: `Could not reach boat.dev: ${cause}`, retryable: true }))
        )
        if (response.status >= 400) return yield* failFrom(response)
        return response
      })

      // boat.dev is one server, and Cloudflare's path to it occasionally times out: try twice more before giving up.
      // Running a command is the one request that isn't safe to repeat once it may have arrived.
      const send = (request: HttpClientRequest.HttpClientRequest) => {
        const repeatable = !(request.method === "POST" && request.url.endsWith("/commands"))
        return attempt(request).pipe(
          Effect.retry({
            times: 2,
            schedule: Schedule.exponential("750 millis"),
            while: (error) => error.code !== "not_configured" && (UNREACHED.has(error.status) || (repeatable && TRANSIENT.has(error.status)))
          })
        )
      }

      const json = <S extends Schema.Constraint>(schema: S) =>
        Effect.fnUntraced(function*(request: HttpClientRequest.HttpClientRequest) {
          const response = yield* send(request)
          const body = yield* response.json.pipe(
            Effect.mapError(() => new BoatError({ code: "invalid_response", status: response.status, message: "boat.dev sent invalid JSON", retryable: false }))
          )
          return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError((error) => new BoatError({ code: "invalid_response", status: response.status, message: String(error), retryable: false }))
          ) as Effect.Effect<S["Type"], BoatError>
        })

      const url = (path: string) => `${BOAT_API}${path}`
      const body = (value: unknown) => HttpClientRequest.bodyJsonUnsafe(value)
      const sandbox = (request: HttpClientRequest.HttpClientRequest) => json(SandboxEnvelope)(request).pipe(Effect.map((envelope) => envelope.sandbox))

      return BoatClient.of({
        create: ({ type, ttlSeconds, idempotencyKey }) =>
          sandbox(HttpClientRequest.post(url("/sandboxes")).pipe(HttpClientRequest.setHeader("idempotency-key", idempotencyKey), body({ type, ttlSeconds }))),

        get: (id) => sandbox(HttpClientRequest.get(url(`/sandboxes/${id}`))),

        resume: (id, ttlSeconds) => sandbox(HttpClientRequest.post(url(`/sandboxes/${id}/resume`)).pipe(body({ ttlSeconds }))),

        stop: (id) => send(HttpClientRequest.post(url(`/sandboxes/${id}/stop`)).pipe(body({}))).pipe(Effect.asVoid),

        remove: (id) =>
          send(HttpClientRequest.make("DELETE")(url(`/sandboxes/${id}`)).pipe(HttpClientRequest.setHeader("x-ascii-confirm-delete", id))).pipe(Effect.asVoid),

        extend: (id, ttlSeconds) => sandbox(HttpClientRequest.make("PATCH")(url(`/sandboxes/${id}`)).pipe(body({ ttlSeconds }))),

        exec: Effect.fnUntraced(function*(id: string, command: string, options: ExecOptions = {}) {
          const response = yield* send(
            HttpClientRequest.post(url(`/sandboxes/${id}/commands`)).pipe(
              body({ command, cwd: options.cwd, timeoutSeconds: options.timeoutSeconds ?? 120, stream: true })
            )
          )
          let result: CommandResult | undefined
          let failure: string | undefined
          // The exit frame carries no output, so collect it (bounded) for callers that need it.
          const collected = { stdout: "", stderr: "" }
          yield* Stream.decodeText(response.stream).pipe(
            Stream.splitLines,
            Stream.runForEach((line) =>
              Effect.sync(() => {
                const frame = decodeFrame(line)
                if (Option.isNone(frame)) return
                const value = frame.value
                if (value.type === "stdout" || value.type === "stderr") {
                  options.onOutput?.(value.type, value.data)
                  collected[value.type] = (collected[value.type] + value.data).slice(-MAX_COLLECTED_OUTPUT)
                }
                else if (value.type === "exit") result = value
                else if (value.type === "error") failure = value.message ?? value.error ?? "Command failed"
              })
            ),
            Effect.mapError((cause) => new BoatError({ code: "network", status: 0, message: `Output stream broke: ${cause}`, retryable: false }))
          )
          if (failure !== undefined) return yield* new BoatError({ code: "command_error", status: 0, message: failure, retryable: false })
          if (!result) return yield* new BoatError({ code: "invalid_response", status: 0, message: "The command ended without an exit status", retryable: false })
          return { ...result, stdout: collected.stdout, stderr: collected.stderr }
        }),

        spawn: (id, command, cwd) =>
          json(CommandStarted)(HttpClientRequest.post(url(`/sandboxes/${id}/commands`)).pipe(body({ command, cwd, detached: true }))),

        readFile: (id, path, encoding = "utf8") =>
          json(FileRead)(HttpClientRequest.get(url(`/sandboxes/${id}/files`)).pipe(HttpClientRequest.setUrlParams({ path, encoding }))),

        writeFile: (id, path, content, encoding = "utf8") =>
          send(HttpClientRequest.put(url(`/sandboxes/${id}/files`)).pipe(body({ path, content, encoding }))).pipe(Effect.asVoid),

        hostPort: (id, port, isPublic) =>
          json(PortHosted)(HttpClientRequest.post(url(`/sandboxes/${id}/host`)).pipe(body({ port, public: isPublic }))).pipe(Effect.map((hosted) => hosted.url)),

        desktop: (id, mode) =>
          json(DesktopResponse)(
            HttpClientRequest.post(url(`/sandboxes/${id}/desktop${mode === "vnc" ? "?vnc=1" : ""}`)).pipe(body(mode === "vnc" ? { publicAccess: true } : {}))
          ).pipe(
            Effect.map((response) => (response.type === "desktop.url" ? (response.desktopUrl ?? undefined) : undefined))
          )
      })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}

/** Checks a boat.dev API key before Dex stores it: null when it works, else what's wrong. */
export async function checkBoatKey(key: string): Promise<string | null> {
  const response = await fetch(`${BOAT_API}/sandboxes?limit=1`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) }).catch(
    () => null
  )
  if (!response) return "Couldn't reach boat.dev. Try again in a moment."
  if (response.status === 401 || response.status === 403) return "boat.dev didn't accept that key."
  if (!response.ok) return `boat.dev returned ${response.status}. Try again in a moment.`
  return null
}
