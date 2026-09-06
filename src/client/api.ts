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

/** The quotes API surface. */
export interface QuoteApi {
  /** List a session's pending quotes (in insertion order). */
  list(sessionId: string): Promise<readonly PendingQuote[]>
  /** Add one pending quote to a session; resolves with the stored quote. */
  add(sessionId: string, quote: { text: string; sourceMessageId?: string; sourceKind?: string }): Promise<PendingQuote>
  /** Remove one pending quote by id; true when it existed. */
  remove(sessionId: string, quoteId: string): Promise<boolean>
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
      const parsed = await request<{ ok: boolean }>(base, 'DELETE', `/quotes?sessionId=${enc(sessionId)}`, { id: quoteId })
      return parsed.ok
    },
  }
}
