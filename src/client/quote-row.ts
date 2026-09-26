/**
 * dsh-quote visible quote row: a Conversation definition that claims this
 * plugin's own injected messages and republishes them as a `quote` Chat node.
 *
 * Why this module exists — the visibility problem, precisely:
 *
 * `ui-chat` classifies every append-surface `user/message` event in
 * `messageDefinition`, keyed on `source.kind`:
 *
 *   - `kind === 'user'`  -> a `user` node -> an ordinary user bubble, and no
 *     plugin can turn that into anything else.
 *   - any other kind     -> a `context` node -> hidden, because
 *     `isVisibleChatNode` admits a `context` node only when it carries tool
 *     additions or removals. That filter runs in `orderedVisibleChatNodes`
 *     BEFORE any renderer seat is consulted, so a `context`-classified quote has
 *     no DOM at all and no CSS or marker can reach it (ADR-0002).
 *
 * Both default projections are therefore closed to a plugin that wants a
 * visible injected row. What IS open is the node KIND space: `isVisibleChatNode`
 * is a blacklist (`system-prompt`, `context`, permission commands), so any other
 * kind is visible. Registering a definition with our own `kind` claims the event
 * first and publishes a node the blacklist does not name, which the plugin then
 * renders through its own `conversation.chat.node` seat.
 *
 * Everything here is structural: the client bundle may not value-import another
 * `@deepseek-ai` module (purity gate), so the definition is typed against local
 * interfaces that mirror the published contract, and registration goes through
 * the runtime service rather than an import.
 *
 * Failure policy: never throw into the GUI. A definition that cannot be built or
 * registered is logged and skipped; the quote still reaches the model.
 * @module dsh-quote/client/quote-row
 */

/** Node kind this plugin publishes. Not in the visibility blacklist. */
export const QUOTE_NODE_KIND = 'quote'

/** Minimal event face the definition reads. */
interface EventLike {
  readonly type?: string
  readonly seq?: number
  readonly time?: number
  readonly surfaceOp?: string
  readonly data?: {
    readonly id?: unknown
    readonly content?: unknown
    readonly source?: { readonly kind?: string; readonly summary?: unknown }
  }
}

/** Minimal view-node face this plugin builds. */
interface QuoteViewNode {
  readonly key: string
  readonly kind: string
  readonly id: string
  readonly target: string
  readonly anchorSeq: number
  readonly location: unknown
  readonly visibility: string
  readonly data: { readonly summary: string; readonly text: string }
}

/** The state one claimed quote carries between start and publication. */
interface QuoteState {
  readonly id: string
  readonly seq: number
  readonly summary: string
  readonly text: string
}

/** Plain text of a message's content blocks. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const record = block as { type?: string; text?: unknown } | null
      return record !== null && record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .join('')
}

/** Whether an event is an append-origin surface event (mirrors the host helper). */
function isAppendSurfaceEvent(event: EventLike): boolean {
  return event.surfaceOp === 'append'
}

/**
 * The quote definition, matching only THIS plugin's injected messages.
 *
 * Matching on our private `source.kind` is what keeps the claim unambiguous: the
 * host's `messageDefinition` matches the same event type, and both contexts
 * legitimately own it. The host's copy still projects a `context` node, which the
 * visibility filter drops, so exactly one visible row results.
 * @param kind - the source kind stamped by the host half.
 */
export function createQuoteDefinition(kind: string): unknown {
  return {
    kind: QUOTE_NODE_KIND,
    target: 'chat',
    match(event: EventLike) {
      if (event.type !== 'user/message') return null
      if (!isAppendSurfaceEvent(event)) return null
      if (event.data?.source?.kind !== kind) return null
      const id = event.data?.id
      if (id === undefined || id === null) return null
      return { id: String(id), role: 'start' }
    },
    start(_context: unknown, match: { event: EventLike }): QuoteState {
      const event = match.event
      const text = textOf(event.data?.content)
      const rawSummary = event.data?.source?.summary
      return {
        id: String(event.data?.id ?? ''),
        seq: typeof event.seq === 'number' ? event.seq : 0,
        summary: typeof rawSummary === 'string' && rawSummary !== '' ? rawSummary : text,
        text,
      }
    },
    update(context: { state?: QuoteState }): QuoteState {
      return context.state as QuoteState
    },
    buildViewNode(context: {
      state?: QuoteState
      key: string
      id: string
      start?: { location: unknown }
    }): QuoteViewNode | null {
      const state = context.state
      if (state === undefined) return null
      return {
        key: context.key,
        kind: QUOTE_NODE_KIND,
        id: state.id,
        target: 'chat',
        anchorSeq: state.seq,
        location: context.start?.location ?? null,
        visibility: 'visible',
        data: { summary: state.summary, text: state.text },
      }
    },
  }
}
