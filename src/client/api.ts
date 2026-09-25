/**
 * dsh-quote client HTTP face over the host's loopback `/dsh-quote/api` routes.
 * Same-origin GUI; the host fences the routes to loopback. Every call throws
 * {@link QuoteApiError} on a non-2xx response.
 * @module dsh-quote/client/api
 */

/** One pending quote as the host stores it (mirror of the host PendingQuote). */
export interface PendingQuote {
  /** Stable id within its session. */
  readonly id: string
  /** The selected plain text, verbatim. */
  readonly text: string
  /** The durable source message id the selection came from, when resolvable. */
  readonly sourceMessageId?: string
  /** The source row kind the selection came from (assistant / user / tool / …). */
  readonly sourceKind?: string
}

/** A failed quotes call: HTTP status plus the host's message. */
export class QuoteApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'QuoteApiError'
  }
}

/** A quote the host already injected, as the composer shows it. */
export interface SentQuote extends PendingQuote {
  /** When the host consumed it, as epoch ms. */
  readonly sentAt: number
}

/** The quotes API surface. */
export interface QuoteApi {
  /** List a session's still-staged quotes (in insertion order). */
  list(sessionId: string): Promise<readonly PendingQuote[]>
  /** Add one pending quote to a session; resolves with the stored quote. */
  add(sessionId: string, quote: { text: string; sourceMessageId?: string; sourceKind?: string }): Promise<PendingQuote>
  /** Remove one pending quote by id; true when it existed. */
  remove(sessionId: string, quoteId: string): Promise<boolean>
  /**
   * Tell the host the user just sent a message, so the quotes staged right now
   * belong to it. A send made while the agent is busy starts no turn, so without
   * this the quote stays visibly pending until the queued message is picked up.
   * @returns how many quotes became claimed.
   */
  claim(sessionId: string): Promise<number>
  /** List the quotes already injected into a session, oldest first. */
  sent(sessionId: string): Promise<readonly SentQuote[]>
  /** Forget one sent quote (or all of them) so it stops being shown. */
  dismissSent(sessionId: string, quoteId?: string): Promise<boolean>
}

async function request<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new QuoteApiError(0, `网络请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const parsed = await response.json() as { error?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      // non-JSON error body: keep the status message
    }
    throw new QuoteApiError(response.status, message)
  }
  return (await response.json()) as T
}

/** Create the quotes API client against one base path. */
export function createQuoteApi(base = '/dsh-quote/api'): QuoteApi {
  const enc = encodeURIComponent
  return {
    list: async (sessionId) => (await request<{ quotes: PendingQuote[] }>(base, 'GET', `/quotes?sessionId=${enc(sessionId)}`)).quotes,
    add: async (sessionId, quote) => {
      const parsed = await request<{ quote: PendingQuote }>(base, 'PUT', `/quotes?sessionId=${enc(sessionId)}`, { quote })
      return parsed.quote
    },
    remove: async (sessionId, quoteId) => {
      // DELETE carries no JSON body; the quote id travels as a query parameter.
      const parsed = await request<{ ok: boolean }>(base, 'DELETE', `/quotes?sessionId=${enc(sessionId)}&quoteId=${enc(quoteId)}`)
      return parsed.ok
    },
    claim: async (sessionId) => {
      const parsed = await request<{ claimed: number }>(base, 'POST', `/claim?sessionId=${enc(sessionId)}`)
      return parsed.claimed
    },
    sent: async (sessionId) => (await request<{ quotes: SentQuote[] }>(base, 'GET', `/sent?sessionId=${enc(sessionId)}`)).quotes,
    dismissSent: async (sessionId, quoteId) => {
      const query = quoteId === undefined ? '' : `&quoteId=${enc(quoteId)}`
      const parsed = await request<{ ok: boolean }>(base, 'DELETE', `/sent?sessionId=${enc(sessionId)}${query}`)
      return parsed.ok
    },
  }
}
