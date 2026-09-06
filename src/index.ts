/**
 * dsh-quote host half: serves the pending-quote HTTP bridge and folds pending
 * quotes into the next real user-text turn as injected context.
 *
 * The client bundle captures a text selection and calls the loopback HTTP API
 * below to add a pending quote to its session. The `agent/pre-step` fold then
 * consumes that session's pending quotes on its next real user-text message —
 * injecting them as plugin-sourced context (never into the user's message
 * text), one-shot, and clearing them. See ADR-0001 and `quote-fold.ts`.
 * @module dsh-quote/index
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { QuoteStore } from './quote-store.ts'
import { foldPendingQuotes } from './quote-fold.ts'
import type { PendingQuote } from './quote-store.ts'
import { contextMessageFactory } from './quote-context.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-quote'

/** Services required before mounting. */
export const inject = ['webServer']

/** Loopback Host trust fence. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const host = request.headers.host ?? ''
  const hostname = host.split(':')[0] ?? ''
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** Read one JSON request body (PUT/POST); GET/DELETE carry none. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (request.method !== 'POST' && request.method !== 'PUT') return undefined
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Plugin body: serve the /dsh-quote/api routes and fold pending quotes on
 * each real user turn.
 * @param ctx - the host cordis context (webServer; agent events fire on ctx).
 */
export function apply(ctx: Context): void {
  const store = new QuoteStore()

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/dsh-quote/api',
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (!isLoopbackRequest(request)) {
        writeJson(response, 403, { ok: false, error: 'forbidden' })
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const method = request.method ?? 'GET'
      const body = await readJsonBody(request)
      const { sessionId } = parseQuery(url)
      if (sessionId === undefined) {
        writeJson(response, 400, { ok: false, error: 'missing sessionId' })
        return
      }
      const quote = body as { quote?: PendingQuote; id?: string } | undefined
      if (url.pathname.endsWith('/quotes') && method === 'GET') {
        writeJson(response, 200, { quotes: store.list(sessionId) })
        return
      }
      if (url.pathname.endsWith('/quotes') && method === 'PUT') {
        if (quote?.quote?.text === undefined || typeof quote.quote.text !== 'string') {
          writeJson(response, 400, { ok: false, error: 'bad quote' })
          return
        }
        const added = store.add(sessionId, quote.quote.text, {
          ...(typeof quote.quote.sourceMessageId === 'string'
            ? { sourceMessageId: quote.quote.sourceMessageId }
            : {}),
          ...(typeof quote.quote.sourceKind === 'string'
            ? { sourceKind: quote.quote.sourceKind }
            : {}),
        })
        writeJson(response, 200, { quote: added })
        return
      }
      if (url.pathname.endsWith('/quotes') && method === 'DELETE') {
        // DELETE carries no body; the quote id travels as a query parameter.
        const quoteId = url.searchParams.get('quoteId')
        const removed = typeof quoteId === 'string' && quoteId !== '' && store.remove(sessionId, quoteId)
        writeJson(response, 200, { ok: removed })
        return
      }
      writeJson(response, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-quote: api routes')

  // Fold pending quotes into the next real user-text turn as injected context.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    try {
      return foldPendingQuotes(decision, messages, store, agent.session.id, contextMessageFactory)
    } catch (error) {
      ctx.logger.warn('dsh-quote: pending-quote fold failed: %o', error)
      return decision
    }
  })
}

function parseQuery(url: URL): { sessionId?: string } {
  return { sessionId: url.searchParams.get('sessionId') ?? undefined }
}
