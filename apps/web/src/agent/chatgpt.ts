import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy"
import { createProvider } from "@earendil-works/pi-ai/models"
import { Context, Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { modelsOf } from "~/shared/models"

/**
 * ChatGPT plan usage through Sign in with ChatGPT (https://developers.openai.com/siwc/token-sharing-open-source):
 * the user's ChatGPT Plus or Pro plan pays for the models, through OpenAI's own Responses API.
 *
 * pi-ai calls the provider `openai` and treats a credential that isn't an `sk-` key as a Sign in with ChatGPT token
 * (it then leaves out the request fields those tokens reject), so the pi-ai id stays `openai` while Dex calls the
 * subscription `chatgpt`.
 */
export const CHATGPT_PI_PROVIDER_ID = "openai"
export const CHATGPT_BASE_URL = "https://api.openai.com/v1"

const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize"
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
/** Every first sign-in registers a new client under this id; OpenAI sends the issued id back with the code. */
const DYNAMIC_CLIENT_ID = "dynamic_agent_client"
/**
 * OpenAI allows only a loopback callback for open-source apps. Dex runs on Cloudflare, so nothing listens there:
 * the browser lands on a page that doesn't load, and the user pastes its address back into Dex.
 */
export const CHATGPT_REDIRECT_URI = "http://127.0.0.1:1455/auth/callback"
const DIRECT_TOKEN_SCOPE = "chatgpt.tokens.use.direct"
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_TOKEN_SCOPE}`
/** Refresh this long before the real expiry, so a request never starts with a token about to expire. */
const EXPIRY_MARGIN_MS = 3 * 60_000

/** What Dex keeps (sealed) after a sign-in. Refreshing replaces `refresh` too: it rotates. */
export interface ChatGPTCredential {
  readonly access: string
  readonly refresh: string
  readonly expires: number
  /** The client OpenAI issued at sign-in; refreshes must use it. */
  readonly clientId: string
  /** The account's email from the ID token, to show which account is connected. */
  readonly email: string | null
}

/** A sign-in in progress: the PKCE verifier and state the pasted callback has to match. */
export interface ChatGPTPending {
  readonly verifier: string
  readonly state: string
  readonly startedAt: number
}

/**
 * ChatGPT as a pi-ai provider: OpenAI's Responses API with the signed-in plan's access token. `resolveToken` runs
 * before each model request (refreshing the token when it's near expiry), so a sign-in or sign-out in the UI
 * applies to the next request.
 */
export const chatGPTProvider = (resolveToken: () => Promise<{ key: string; source: string } | undefined>) =>
  createProvider({
    id: CHATGPT_PI_PROVIDER_ID,
    name: "ChatGPT",
    baseUrl: CHATGPT_BASE_URL,
    auth: {
      apiKey: {
        name: "ChatGPT sign-in",
        resolve: async () => {
          const resolved = await resolveToken()
          return resolved && { auth: { apiKey: resolved.key }, source: resolved.source }
        }
      }
    },
    models: modelsOf("chatgpt").map((model) => ({
      id: model.apiId,
      name: model.name,
      api: "openai-responses" as const,
      provider: CHATGPT_PI_PROVIDER_ID,
      baseUrl: CHATGPT_BASE_URL,
      reasoning: true,
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.thinkingLevelMap && { thinkingLevelMap: model.thinkingLevelMap }),
      ...(model.compat && { compat: model.compat })
      // pi-ai types compat per API; the catalog carries pi-ai's own values for each model.
    })) as never,
    api: openAIResponsesApi()
  })

export class ChatGPTError extends Schema.TaggedError<ChatGPTError>()("ChatGPTError", {
  /** `expired`: the sign-in can't be refreshed any more (revoked, or unused for 30 days); sign in again. */
  reason: Schema.Literals(["bad_callback", "denied", "expired", "unreachable", "unexpected"]),
  message: Schema.String
}) {}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const randomValue = () => base64url(crypto.getRandomValues(new Uint8Array(32)))

/** The page to sign in on, and what the callback must match. `hostId` is this agent's stable UUID. */
export async function startChatGPTSignIn(hostId: string): Promise<{ url: string; pending: ChatGPTPending }> {
  const verifier = randomValue()
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
  const state = randomValue()
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: DYNAMIC_CLIENT_ID,
    agent_name_hint: "Dex",
    // One host per agent: an opaque id, never anything that identifies the user.
    ext_agent_host_id: `urn:uuid:${hostId.toLowerCase()}`,
    response_type: "code",
    redirect_uri: CHATGPT_REDIRECT_URI,
    resource: CHATGPT_BASE_URL,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    nonce: randomValue()
  }).toString()
  return { url: url.toString(), pending: { verifier, state, startedAt: Date.now() } }
}

/** The code and issued client id from the address the browser landed on, checked against the sign-in's state. */
export function parseChatGPTCallback(input: string, expectedState: string): { code: string; clientId: string } | ChatGPTError {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return new ChatGPTError({ reason: "bad_callback", message: "Paste the whole address from the browser's address bar (it starts with http://127.0.0.1:1455)." })
  }
  const error = url.searchParams.get("error")
  if (error) {
    const detail = url.searchParams.get("error_description")
    return new ChatGPTError({ reason: "denied", message: `ChatGPT didn't connect: ${detail ?? error}` })
  }
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const clientId = url.searchParams.get("client_id")?.trim()
  if (!code || !state) return new ChatGPTError({ reason: "bad_callback", message: "That address has no sign-in code. Paste the one the browser landed on after you approved." })
  if (state !== expectedState) return new ChatGPTError({ reason: "bad_callback", message: "That address is from a different sign-in. Start again and paste the newest one." })
  if (!clientId) return new ChatGPTError({ reason: "bad_callback", message: "That address has no client id from OpenAI. Paste the whole address." })
  return { code, clientId }
}

const TokenBody = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Number,
  scope: Schema.optional(Schema.String),
  id_token: Schema.optional(Schema.String)
})

/** A claim from a JWT's payload. Read only for display; the token came straight from OpenAI over TLS. */
const jwtClaim = (token: string | undefined, claim: string): string | null => {
  const payload = token?.split(".")[1]
  if (!payload) return null
  try {
    const value = (JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>)[claim]
    return typeof value === "string" ? value : null
  } catch {
    return null
  }
}

/** Talks to OpenAI outside the agent loop: finishing a sign-in, refreshing its token, and listing the plan's models. */
export class ChatGPTClient extends Context.Service<ChatGPTClient, {
  /** Trades the pasted callback's code for tokens. */
  exchange(code: string, verifier: string, clientId: string): Effect.Effect<ChatGPTCredential, ChatGPTError>
  /** A fresh access token (and a replacement refresh token). */
  refresh(credential: ChatGPTCredential): Effect.Effect<ChatGPTCredential, ChatGPTError>
  /** The ids of the models this account can use now. */
  models(access: string): Effect.Effect<ReadonlySet<string>, ChatGPTError>
}>()("dex/agent/ChatGPTClient") {
  static readonly layer = Layer.effect(
    ChatGPTClient,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient

      const token = Effect.fn("ChatGPTClient.token")(function*(params: Record<string, string>, previous?: ChatGPTCredential) {
        const response = yield* HttpClientRequest.post(TOKEN_URL).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyUrlParams({ ...params, resource: CHATGPT_BASE_URL }),
          client.execute,
          Effect.timeout("20 seconds"),
          Effect.mapError((cause) => new ChatGPTError({ reason: "unreachable", message: `Could not reach OpenAI: ${cause}` }))
        )
        if (response.status >= 400) {
          const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""))
          // A refresh token that's revoked, expired, or already used comes back as invalid_grant.
          if (response.status < 500 && /invalid_grant|invalid_token|expired|revoked/i.test(body)) {
            return yield* new ChatGPTError({ reason: "expired", message: "Your ChatGPT sign-in has expired. Sign in again in Settings." })
          }
          return yield* new ChatGPTError({ reason: "unexpected", message: `OpenAI returned ${response.status}: ${body.slice(0, 300)}` })
        }
        const body = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(TokenBody)),
          Effect.mapError(() => new ChatGPTError({ reason: "unexpected", message: "OpenAI sent tokens in an unexpected shape." }))
        )
        if (body.scope !== undefined && !body.scope.split(/\s+/).includes(DIRECT_TOKEN_SCOPE)) {
          return yield* new ChatGPTError({
            reason: "denied",
            message: "OpenAI didn't grant plan usage for this account. It needs an eligible ChatGPT Plus or Pro plan."
          })
        }
        return {
          access: body.access_token,
          refresh: body.refresh_token,
          expires: Date.now() + body.expires_in * 1000 - EXPIRY_MARGIN_MS,
          clientId: params.client_id!,
          email: jwtClaim(body.id_token, "email") ?? previous?.email ?? null
        } satisfies ChatGPTCredential
      })

      const exchange = (code: string, verifier: string, clientId: string) =>
        token({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: CHATGPT_REDIRECT_URI })

      const refresh = (credential: ChatGPTCredential) =>
        token({ grant_type: "refresh_token", client_id: credential.clientId, refresh_token: credential.refresh }, credential)

      const models = Effect.fn("ChatGPTClient.models")(function*(access: string) {
        const response = yield* HttpClientRequest.get(`${CHATGPT_BASE_URL}/models`).pipe(
          HttpClientRequest.bearerToken(access),
          HttpClientRequest.acceptJson,
          client.execute,
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new ChatGPTError({ reason: "unreachable", message: `Could not reach OpenAI: ${cause}` }))
        )
        if (response.status === 401) return yield* new ChatGPTError({ reason: "expired", message: "OpenAI rejected the ChatGPT sign-in." })
        if (response.status >= 300) return yield* new ChatGPTError({ reason: "unexpected", message: `OpenAI returned ${response.status}` })
        const body = (yield* response.json.pipe(
          Effect.mapError(() => new ChatGPTError({ reason: "unexpected", message: "OpenAI sent its model list in an unexpected shape." }))
        )) as { data?: Array<{ id?: unknown; visibility?: unknown }> }
        // OpenAI's docs: list the models whose visibility is "list".
        return new Set(
          (body.data ?? []).filter((model) => model.visibility === undefined || model.visibility === "list").map((model) => String(model.id))
        ) as ReadonlySet<string>
      })

      return ChatGPTClient.of({ exchange, refresh, models })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
