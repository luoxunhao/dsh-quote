/**
 * dsh-quote host half: serves the pending-quote HTTP bridge and folds pending
 * quotes into the next real user-text turn as user messages.
 *
 * The client bundle captures a text selection and calls the loopback HTTP API
 * below to add a pending quote to its session. The `agent/pre-step` fold then
 * consumes that session's pending quotes on its next real user-text message,
 * delivering each as an ordinary user-role message — a visible user bubble, never
 * merged into the user's own message text — one-shot, then clearing the queue.
 * See ADR-0003 and `quote-fold.ts`.
 *
 * There is deliberately no sent-quote record here. The transcript shows the quote
 * by itself now (it IS a user message), so the composer needs no receipt, and a
 * receipt is exactly what used to linger after a send. See ADR-0003.
 *
 * Set `DSH_QUOTE_TRACE=<path>` to append one JSON line per `agent/pre-step`
 * invocation plus one per claim/list. The fold's upstream conditions (a fresh
 * user-origin message in the claimed slice) are not visible from the outside, so
 * a quote that never gets consumed is otherwise undiagnosable.
 * @module dsh-quote/index
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { appendFileSync } from 'node:fs'
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
      // 'undefined' is what a client with no session id sends when it
      // interpolates a missing value. Treating it as a real session would let a
      // stale or unbound dock create a phantom queue that races the real one.
      if (sessionId === undefined || sessionId === '' || sessionId === 'undefined') {
        writeJson(response, 400, { ok: false, error: 'missing sessionId' })
        return
      }
      const quote = body as { quote?: PendingQuote; id?: string } | undefined
      if (url.pathname.endsWith('/quotes') && method === 'GET') {
        // Only the quotes still staged as a draft; a claimed one already rode a
        // sent message and must not reappear as removable.
        const staged = store.staged(sessionId)
        trace({ ev: 'list-staged', sessionId, count: staged.length, claimed: store.list(sessionId).map(q => q.claimed === true) })
        writeJson(response, 200, { quotes: staged })
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
        // Marking it `claimed` keeps it in the store (the fold still needs to
        // drain and inject it) while telling the client to stop showing it.
        const claimed = store.claim(sessionId)
        writeJson(response, 200, { ok: true, claimed: claimed.length })
        return
      }
      writeJson(response, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'dsh-quote: api routes')

  // Claim the staged quotes the moment the user's message reaches the inbox.
  //
  // `agent/inbox/inserted` is the authoritative "the user sent" signal: it fires
  // as the message is spliced into the inbox, BEFORE any turn starts, so it is
  // true even when the agent is mid-turn and the message merely queues. The client
  // cannot detect that case from the DOM, which is why claiming used to be driven
  // by a client-side guess and the card came back (ADR-0002).
  //
  // Note the runtime does NOT honour the declared `payload.agent` for this event:
  // `dsh-agent-loop` emits `{ message }` alone, even though the published payload
  // type lists an `agent` field. Reading `agent.session.id` therefore throws, and
  // a local catch would swallow it silently — leaving the quote unclaimed forever.
  // The session id is taken from the message's own scope instead: the dispatch is
  // agent-scoped, so the listener's `this` carries the owning agent.
  //
  // Claiming only marks the quotes as belonging to a sent message; the fold still
  // injects them, so a quote is never lost by being claimed early.
  ctx.on('agent/inbox/inserted', function (this: unknown, payload: { agent?: unknown; message?: unknown }) {
    try {
      const message = payload.message as { source?: { kind?: string } } | undefined
      const owner = (payload.agent ?? this) as
        | { session?: { id?: string } }
        | undefined
      const sessionId = owner?.session?.id
      if (message?.source?.kind !== 'user') return
      if (typeof sessionId !== 'string' || sessionId === '') {
        ctx.logger.warn('dsh-quote: inbox insert had no owning session; cannot claim')
        return
      }
      const claimed = store.claim(sessionId)
      trace({ ev: 'claimed-on-send', sessionId, count: claimed.length })
    } catch (error) {
      trace({ ev: 'claim-error', error: String(error) })
      ctx.logger.warn('dsh-quote: claim on send failed: %o', error)
    }
  })

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
