/**
 * dsh-quote pending-quote store: the in-memory, session-scoped registry of
 * quotes the user has "quoted into context" but not yet sent. The agent/pre-step
 * fold (see quote-fold.ts) consumes the quotes of a session on its next real
 * user-text message and then clears them — one-shot, never persisted.
 *
 * The store is deliberately pure TypeScript (no DSH dependency) so it is
 * trivially unit-testable and independent of the host's session model. A quote
 * records the plain text the user selected (verbatim rendered text, per
 * ADR-0001) plus, when known, the durable source message it came from.
 * @module dsh-quote/quote-store
 */

/** A random-ish local id for a pending quote (host-side, non-cryptographic). */
export function newQuoteId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** One pending quote: the text the user selected plus its provenance. */
export interface PendingQuote {
  /** Stable id within its session (enables per-quote removal). */
  readonly id: string
  /** The selected plain text, verbatim (`window.getSelection().toString()` at capture time). */
  readonly text: string
  /** The durable source message id the selection came from, when resolvable. */
  readonly sourceMessageId?: string
  /** The source row kind the selection came from (assistant / user / tool / …). */
  readonly sourceKind?: string
}

/** The store's observable state for one session: its pending quotes, in order. */
export interface PendingQuoteState {
  readonly sessionId: string
  readonly quotes: readonly PendingQuote[]
}

/**
 * In-memory, per-session pending-quote registry. Each session has its own
 * ordered list; quotes are added at the tail, removed by id, and cleared
 * wholesale when consumed. No cross-session union, no persistence.
 * @class
 */
export class QuoteStore {
  private readonly bySession = new Map<string, PendingQuote[]>()

  /**
   * Add one pending quote to a session's queue.
   * @param sessionId - the owning session.
   * @param text - the selected text (verbatim).
   * @param meta - optional provenance (source message id / kind).
   * @returns the added quote, with its generated id.
   */
  add(
    sessionId: string,
    text: string,
    meta: { sourceMessageId?: string; sourceKind?: string } = {},
  ): PendingQuote {
    const quote: PendingQuote = {
      id: newQuoteId(),
      text,
      ...(meta.sourceMessageId !== undefined ? { sourceMessageId: meta.sourceMessageId } : {}),
      ...(meta.sourceKind !== undefined ? { sourceKind: meta.sourceKind } : {}),
    }
    const list = this.bySession.get(sessionId) ?? []
    list.push(quote)
    this.bySession.set(sessionId, list)
    return quote
  }

  /** The pending quotes of one session, in insertion order. */
  list(sessionId: string): readonly PendingQuote[] {
    return this.bySession.get(sessionId) ?? []
  }

  /** Remove one pending quote by id; true when it existed and was removed. */
  remove(sessionId: string, quoteId: string): boolean {
    const list = this.bySession.get(sessionId)
    if (list === undefined) return false
    const next = list.filter(quote => quote.id !== quoteId)
    if (next.length === list.length) return false
    if (next.length === 0) this.bySession.delete(sessionId)
    else this.bySession.set(sessionId, next)
    return true
  }

  /** Clear all pending quotes of one session (called when they are consumed). */
  clear(sessionId: string): void {
    this.bySession.delete(sessionId)
  }

  /** Whether a session currently has any pending quote. */
  has(sessionId: string): boolean {
    return (this.bySession.get(sessionId)?.length ?? 0) > 0
  }

  /** Snapshot state for one session (used to build the model-visible view). */
  state(sessionId: string): PendingQuoteState {
    return { sessionId, quotes: this.list(sessionId) }
  }

  /** Drain and return the quotes of a session, clearing its queue. */
  take(sessionId: string): readonly PendingQuote[] {
    const list = this.bySession.get(sessionId) ?? []
    this.bySession.delete(sessionId)
    return list
  }
}
