/** Where an inbound signed webhook delivers its rendered prompt. */
export type WebhookTarget =
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "space"; readonly spaceId: string }
  | { readonly kind: "agent"; readonly agentId: string }

/** An inbound webhook shown in the UI (the signing secret is never returned after creation/rotation). */
export interface WebhookInfo {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly target: WebhookTarget
  /** Prompt prefix prepended before the event payload; supports `{{event}}` and `{{payload}}`. */
  readonly prompt: string
  /** Public URL path: `/api/hooks/<encodedUser>/<id>`. */
  readonly path: string
  readonly triggerCount: number
  readonly lastTriggeredAt: number | null
  readonly lastError: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WebhookDraft {
  readonly id?: string
  readonly name: string
  readonly enabled?: boolean
  readonly target: WebhookTarget
  readonly prompt?: string
}

/** Returned once when creating a webhook or rotating its signing secret. */
export interface CreatedWebhook {
  readonly webhook: WebhookInfo
  readonly secret: string
}
