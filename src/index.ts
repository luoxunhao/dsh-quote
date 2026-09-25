/**
 * dsh-quote host half: serves the pending-quote HTTP bridge and folds pending
 * quotes into the next real user-text turn as injected context.
 *
 * The client bundle captures a text selection and calls the loopback HTTP API
 * below to add a pending quote to its session. The `agent/pre-step` fold then
 * consumes that session's pending quotes on its next real user-text message —
 * injecting them as plugin-sourced context (never into the user's message
 * text), one-shot, and clearing them. See ADR-0001 and `quote-fold.ts`.
 *
 * Consumed quotes are also recorded in a bounded per-session list the composer
 * reads back, because the transcript cannot show them: the shipped GUI hides
 * every ordinary injected-context row. See ADR-0002.
 *
 * Set `DSH_QUOTE_TRACE=<path>` to append one JSON line per `agent/pre-step`
 * invocation. The fold's upstream conditions (a fresh user-origin message in the
 * claimed slice) are not visible from the outside, so a quote that never gets
 * consumed is otherwise undiagnosable.
 * @module dsh-quote/index
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'

import { QuoteStore, SentQuoteStore } from './quote-store.ts'
import { foldPendingQuotes } from './quote-fold.ts'
import type { PendingQuote } from './quote-store.ts'
import { contextMessageFactory } from './quote-context.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-quote'

/** Services required before mounting. */
export const inject = ['webServer']

/**
 * Optional diagnostic sink: when `DSH_QUOTE_TRACE` names a file, every
 * `agent/pre-step` appends one JSON line describing what the fold saw and did.
 */
const TRACE_PATH = process.env['DSH_QUOTE_TRACE'] ?? ''

/**
 * Append one trace record, when tracing is enabled.
 * @param record - the fields to record; a timestamp is added.
 */
function trace(record: Record<string, unknown>): void {
  if (TRACE_PATH === '') return
  try {
    appendFileSync(TRACE_PATH, `${JSON.stringify({ t: Date.now(), ...record })}\n`)
  } catch {
    // Diagnostics must never break the fold they are observing.
  }
}

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
  const sent = new SentQuoteStore()

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
        // Only the quotes still staged as a draft; a claimed one already rode a
        // sent message and must not reappear as removable.
        writeJson(response, 200, { quotes: store.staged(sessionId) })
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
      if (url.pathname.endsWith('/claim') && method === 'POST') {
        // The user pressed send. Take ownership of whatever is staged NOW, so it
        // rides the message they just sent rather than a turn that may not begin
        // for a while (a busy agent queues the message and keeps working).
        //
        // Without this the quote legitimately stays pending until the queued
        // message is finally picked up, and the composer shows the card again —
        // correct by the old semantics, and useless to the user who just sent it.
        // Marking it `claiming` keeps it in the store (the fold still needs to
        // drain and inject it) while telling the client to stop showing it.
        const claimed = store.claim(sessionId)
        writeJson(response, 200, { ok: true, claimed: claimed.length })
        return
      }
      if (url.pathname.endsWith('/sent') && method === 'GET') {
        writeJson(response, 200, { quotes: sent.list(sessionId) })
        return
      }
      if (url.pathname.endsWith('/sent') && method === 'DELETE') {
        // Dismissing the "what I sent" card must not be undone by the next poll.
        const quoteId = url.searchParams.get('quoteId')
        if (typeof quoteId === 'string' && quoteId !== '') {
          writeJson(response, 200, { ok: sent.remove(sessionId, quoteId) })
          return
        }
        sent.clear(sessionId)
        writeJson(response, 200, { ok: true })
        return
      }
      writeJson(response, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-quote: api routes')

  // Fold pending quotes into the next real user-text turn as injected context.
  // The fold is pure and hands back only the decision, so the quotes it consumed
  // are read off the store either side of the call: whatever the fold drained is
  // exactly what this step injected.
  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const decision = await next()
    const sessionId = agent.session.id
    const claimedKinds = messages.map(message => (message as { source?: { kind?: string } }).source?.kind ?? '?')
    try {
      const pendingBefore = store.list(sessionId)
      const rewritten = foldPendingQuotes(decision, messages, store, sessionId, contextMessageFactory)
      const remaining = store.list(sessionId)
      const injected = pendingBefore.filter(quote => !remaining.some(kept => kept.id === quote.id))
      if (injected.length > 0) sent.record(sessionId, injected)
      // Record BOTH collections: the fold gates on `claimed` but places against
      // `decision.messages`, so a divergence between them is exactly the case
      // where a real user turn fails to consume its quote.
      const enteringKinds = decision.kind === 'enter'
        ? decision.messages.map(message => (message as { source?: { kind?: string } }).source?.kind ?? '?')
        : []
      trace({
        ev: 'pre-step',
        sessionId,
        decision: decision.kind,
        claimedKinds,
        enteringKinds,
        diverged: JSON.stringify(claimedKinds) !== JSON.stringify(enteringKinds),
        pendingBefore: pendingBefore.length,
        pendingAfter: remaining.length,
        injected: injected.length,
      })
      return rewritten
    } catch (error) {
      trace({ ev: 'pre-step-error', sessionId, claimedKinds, error: String(error) })
      ctx.logger.warn('dsh-quote: pending-quote fold failed: %o', error)
      return decision
    }
  })
}

function parseQuery(url: URL): { sessionId?: string } {
  return { sessionId: url.searchParams.get('sessionId') ?? undefined }
}
