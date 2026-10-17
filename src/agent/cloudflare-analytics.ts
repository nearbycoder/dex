import { Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AppConfig } from "~/server/config"
import { CLOUDFLARE_RATES } from "~/shared/usage"

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql"
const SCRIPT = "dex"

export class CloudflareAnalyticsError extends Schema.TaggedError<CloudflareAnalyticsError>()("CloudflareAnalyticsError", {
  message: Schema.String
}) {}

const Num = Schema.optional(Schema.NullOr(Schema.Number))
const DateDims = Schema.Struct({ date: Schema.String })

const Response = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        viewer: Schema.Struct({
          accounts: Schema.Array(
            Schema.Struct({
              workers: Schema.optional(Schema.Array(Schema.Struct({ sum: Schema.Struct({ requests: Num, cpuTimeUs: Num }), dimensions: DateDims }))),
              objects: Schema.optional(
                Schema.Array(Schema.Struct({ sum: Schema.Struct({ requests: Num }), dimensions: Schema.Struct({ date: Schema.String, namespaceId: Schema.String }) }))
              ),
              periodic: Schema.optional(
                Schema.Array(
                  Schema.Struct({
                    sum: Schema.Struct({ duration: Num, inboundWebsocketMsgCount: Num, rowsRead: Num, rowsWritten: Num }),
                    dimensions: DateDims
                  })
                )
              ),
              ai: Schema.optional(Schema.Array(Schema.Struct({ sum: Schema.Struct({ totalNeurons: Num }), dimensions: DateDims })))
            })
          )
        })
      })
    )
  ),
  errors: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ message: Schema.String }))))
})

/** One day of Dex's Cloudflare usage. */
export interface CloudflareDay {
  workerRequests: number
  cpuMs: number
  doRequests: number
  doGbSeconds: number
  rowsRead: number
  rowsWritten: number
  /** Workers AI neurons; account-wide, since that dataset cannot be filtered by Worker. */
  aiNeurons: number
}

export const emptyDay = (): CloudflareDay => ({ workerRequests: 0, cpuMs: 0, doRequests: 0, doGbSeconds: 0, rowsRead: 0, rowsWritten: 0, aiNeurons: 0 })

/** A day's usage priced at list rates, before the plan's included allowance. */
export const dayCost = (day: CloudflareDay) =>
  (day.workerRequests / 1e6) * CLOUDFLARE_RATES.workerRequests.perMillion +
  (day.cpuMs / 1e6) * CLOUDFLARE_RATES.cpuMs.perMillion +
  (day.doRequests / 1e6) * CLOUDFLARE_RATES.doRequests.perMillion +
  (day.doGbSeconds / 1e6) * CLOUDFLARE_RATES.doGbSeconds.perMillion +
  (day.rowsRead / 1e6) * CLOUDFLARE_RATES.rowsRead.perMillion +
  (day.rowsWritten / 1e6) * CLOUDFLARE_RATES.rowsWritten.perMillion +
  (Math.max(0, day.aiNeurons - CLOUDFLARE_RATES.aiNeurons.includedDaily) / 1000) * CLOUDFLARE_RATES.aiNeurons.perThousand

/** Reads Dex's Worker, Durable Object, and Workers AI usage from Cloudflare's GraphQL Analytics API. */
export class CloudflareAnalytics extends Context.Service<CloudflareAnalytics, {
  readonly configured: boolean
  /** Usage per UTC date between `since` and `until` (YYYY-MM-DD, at most ~31 days apart). */
  daily(since: string, until: string): Effect.Effect<Map<string, CloudflareDay>, CloudflareAnalyticsError>
}>()("dex/agent/CloudflareAnalytics") {
  static readonly layer = Layer.effect(
    CloudflareAnalytics,
    Effect.gen(function*() {
      const { cloudflareApiToken, cloudflareAccountId } = yield* AppConfig
      const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
      const credentials = Option.all({ token: cloudflareApiToken, account: cloudflareAccountId })

      const query = Effect.fnUntraced(function*(text: string, variables: Record<string, unknown>) {
        if (Option.isNone(credentials)) {
          return yield* new CloudflareAnalyticsError({ message: "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to see Cloudflare usage." })
        }
        const result = yield* HttpClientRequest.post(GRAPHQL).pipe(
          HttpClientRequest.bearerToken(Redacted.value(credentials.value.token)),
          HttpClientRequest.bodyJsonUnsafe({ query: text, variables: { account: credentials.value.account, ...variables } }),
          http.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)),
          Effect.mapError((cause) => new CloudflareAnalyticsError({ message: `Cloudflare analytics request failed: ${cause}` }))
        )
        if (result.errors?.length) return yield* new CloudflareAnalyticsError({ message: result.errors.map((error) => error.message).join("; ") })
        const account = result.data?.viewer.accounts[0]
        if (!account) return yield* new CloudflareAnalyticsError({ message: "No such Cloudflare account, or the token cannot read its analytics." })
        return account
      })

      const daily = Effect.fn("CloudflareAnalytics.daily")(function*(since: string, until: string) {
        const days = new Map<string, CloudflareDay>()
        const day = (date: string) => {
          let entry = days.get(date)
          if (!entry) days.set(date, (entry = emptyDay()))
          return entry
        }

        // Requests and CPU filter by Worker name; Durable Object duration and storage only by namespace,
        // so the first query also finds Dex's namespace ids.
        const first = yield* query(
          `query($account: String!, $since: Date!, $until: Date!) { viewer { accounts(filter: { accountTag: $account }) {
            workers: workersInvocationsAdaptive(limit: 1000, filter: { date_geq: $since, date_leq: $until, scriptName: "${SCRIPT}" }) {
              sum { requests cpuTimeUs } dimensions { date } }
            objects: durableObjectsInvocationsAdaptiveGroups(limit: 1000, filter: { date_geq: $since, date_leq: $until, scriptName: "${SCRIPT}" }) {
              sum { requests } dimensions { date namespaceId } }
            ai: aiInferenceAdaptiveGroups(limit: 1000, filter: { date_geq: $since, date_leq: $until }) {
              sum { totalNeurons } dimensions { date } } } } }`,
          { since, until }
        )
        for (const row of first.workers ?? []) {
          day(row.dimensions.date).workerRequests += row.sum.requests ?? 0
          day(row.dimensions.date).cpuMs += (row.sum.cpuTimeUs ?? 0) / 1000
        }
        for (const row of first.objects ?? []) day(row.dimensions.date).doRequests += row.sum.requests ?? 0
        for (const row of first.ai ?? []) day(row.dimensions.date).aiNeurons += row.sum.totalNeurons ?? 0

        const namespaces = [...new Set((first.objects ?? []).map((row) => row.dimensions.namespaceId))]
        if (namespaces.length) {
          const second = yield* query(
            `query($account: String!, $since: Date!, $until: Date!, $namespaces: [String!]) { viewer { accounts(filter: { accountTag: $account }) {
              periodic: durableObjectsPeriodicGroups(limit: 1000, filter: { date_geq: $since, date_leq: $until, namespaceId_in: $namespaces }) {
                sum { duration inboundWebsocketMsgCount rowsRead rowsWritten } dimensions { date } } } } }`,
            { since, until, namespaces }
          )
          for (const row of second.periodic ?? []) {
            const entry = day(row.dimensions.date)
            // `duration` is already in GB-seconds (wall time × 128 MB), the unit Cloudflare bills.
            entry.doGbSeconds += row.sum.duration ?? 0
            // Incoming WebSocket messages bill as requests at 20:1.
            entry.doRequests += (row.sum.inboundWebsocketMsgCount ?? 0) / 20
            entry.rowsRead += row.sum.rowsRead ?? 0
            entry.rowsWritten += row.sum.rowsWritten ?? 0
          }
        }
        return days
      })

      return CloudflareAnalytics.of({ configured: Option.isSome(credentials), daily })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
