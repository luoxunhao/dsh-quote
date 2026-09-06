/**
 * dsh-quote pre-step fold: the pure, testable core that decides whether and
 * how a session's pending quotes are injected as model context on the next
 * real user-text turn.
 *
 * The fold is deliberately split from the DSH plumbing: it operates on a
 * structural `Decision`/`ClaimedMessage` shape and a `QuoteSource` it can fold
 * from, so the rules (only consume on a real user turn; one-shot; clear after)
 * are unit-testable without a DSH runtime. The host (`index.ts`) adapts the
 * real `agent/pre-step` decision and message objects onto these shapes and
 * supplies a real `QuoteSource` that builds plugin-sourced context messages.
 *
 * Semantics (per ADR-0001 / CONTEXT.md):
 * - A quote becomes model context only on a turn that CLAIMS at least one
 *   genuine user-origin message — the user actually typed/sent something.
 *   Intermediate assistant / tool steps (no fresh user message) never consume.
 * - All pending quotes of that session ride the SAME turn (accumulate), then
 *   the session's queue is cleared (one-shot, never persisted).
 * - Injection never touches the user's own message text: quotes are spliced as
 *   separate context messages right after the claimed user messages.
 * @module dsh-quote/quote-fold
 */

import type { PendingQuote } from './quote-store.ts'

/**
 * A minimal message face the fold reads (`source.kind` distinguishes a genuine
 * user message from a plugin-injected / tool / model one). Generic so the fold
 * can operate on the real dsh `UserMessage` in the host while tests pass a fake.
 */
export interface MessageLike {
  readonly source?: { readonly kind?: string; readonly plugin?: string }
}

/** The pre-step outcome the fold may rewrite, generic over the message type. */
export type Decision<M extends MessageLike> = {
  kind: 'reject'
} | {
  kind: 'enter'
  messages: M[]
  startsRequestSeries?: true
}

/**
 * Something that turns one pending quote into a single model-visible context
 * message. The host supplies a real implementation over `createUserMessage`
 * with a plugin source; tests supply a fake.
 */
export interface QuoteContextFactory<M extends MessageLike> {
  /** Build the injected context message for one pending quote. */
  contextMessage(quote: PendingQuote): M
}

/** A store holding per-session pending quotes (the fold only needs `has`/`take`). */
export interface PendingQuoteFace {
  has(sessionId: string): boolean
  take(sessionId: string): readonly PendingQuote[]
}

/** The host's plugin identity tag used on injected messages. */
export const PLUGIN_NAME = 'dsh-quote'

/**
 * Whether a step's claimed messages represent a REAL user turn (the user
 * actually typed/sent text) as opposed to a plugin/agent-injected step or a
 * bare continuation with no fresh user message.
 *
 * A genuine user message carries `source.kind === 'user'` (the dsh message
 * model: `MessageSourceMap.user`). Tool results are `kind === 'tool'`,
 * injected context is `kind === 'plugin'`, model output is `kind === 'model'` —
 * none of these is the user sending fresh text, so they do not consume a
 * pending quote (per the user's Q7 decision: quotes ride the next real
 * user-text message only).
 * @param claimed - the messages this step claimed from the inbox.
 */
export function isRealUserTurn(claimed: readonly MessageLike[]): boolean {
  return claimed.some(message => message.source?.kind === 'user')
}

/**
 * The pure fold: given the proposed decision, the claimed messages, a
 * session's pending-quote face, and a context-message factory, decide whether
 * to inject the session's pending quotes as context on this turn.
 *
 * Injects ONLY when the decision enters AND the step claims a real user turn
 * AND the session currently has pending quotes. When it injects, the session's
 * queue is drained (taken) and its messages are spliced as context messages
 * right after the last claimed message. Otherwise the decision is returned
 * unchanged (a no-op).
 * @param decision - the decision produced by prior pre-step listeners.
 * @param claimed - the messages this step claimed from the inbox.
 * @param pending - the session's pending-quote face (has/take).
 * @param sessionId - the owning session.
 * @param makeContext - builds a context message per pending quote.
 * @returns the (possibly rewritten) decision.
 */
export function foldPendingQuotes<M extends MessageLike>(
  decision: Decision<M>,
  claimed: readonly M[],
  pending: PendingQuoteFace,
  sessionId: string,
  makeContext: QuoteContextFactory<M>,
): Decision<M> {
  if (decision.kind !== 'enter') return decision
  if (!isRealUserTurn(claimed)) return decision
  if (!pending.has(sessionId)) return decision
  const quotes = pending.take(sessionId)
  if (quotes.length === 0) return decision
  const injected = quotes.map(quote => makeContext.contextMessage(quote))
  // Insert right after the LAST genuine user-origin message in the step. We
  // locate it by SOURCE KIND, not reference identity: `claimed` (the inbox
  // slice the loop hands the listener) and the messages inside `decision.messages`
  // may not be the same object instances, so `includes`-based placement is
  // fragile. The user's own text must stay ahead of the injected context.
  const lastUserIndex = decision.messages.findLastIndex(message => message.source?.kind === 'user')
  const insertAt = lastUserIndex >= 0 ? lastUserIndex + 1 : decision.messages.length
  return { kind: 'enter', messages: decision.messages.toSpliced(insertAt, 0, ...injected) }
}
