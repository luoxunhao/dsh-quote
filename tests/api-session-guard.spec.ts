/**
 * The quotes API client must never issue a request with a missing session id.
 *
 * Why this is a regression test: an unbound dock interpolated its absent session
 * id into the URL, producing `GET /quotes?sessionId=undefined`. The host answered
 * about a session literally named "undefined", and that reply raced the real
 * session's reply into the same React state — so a card the user had already sent
 * could come back. Both halves now refuse the value; this pins the client half.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQuoteApi } from '../src/client/api.ts'

/** Install a fetch stub and return the recorded request URLs. */
function stubFetch(payload: unknown = {}): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', (input: string | URL | Request) => {
    calls.push(String(input))
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('quote API session guard', () => {
  it('never requests a session named "undefined"', async () => {
    const calls = stubFetch({ quotes: [] })
    const api = createQuoteApi()
    for (const bad of [undefined, '', 'undefined'] as unknown as string[]) {
      expect(await api.list(bad)).toEqual([])
      expect(await api.claim(bad)).toBe(0)
      expect(await api.remove(bad, 'q1')).toBe(false)
    }
    expect(calls).toEqual([])
  })

  it('still issues requests for a real session id', async () => {
    const calls = stubFetch({ quotes: [] })
    const api = createQuoteApi()
    await api.list('session-abc')
    expect(calls).toEqual(['/dsh-quote/api/quotes?sessionId=session-abc'])
  })

  it('refuses to add under a missing session instead of queueing a phantom', async () => {
    const calls = stubFetch({ quote: { id: 'q', text: 'x' } })
    const api = createQuoteApi()
    await expect(api.add(undefined as unknown as string, { text: 'x' })).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('claims against the real session on a normal send', async () => {
    const calls = stubFetch({ claimed: 2 })
    const api = createQuoteApi()
    expect(await api.claim('session-abc')).toBe(2)
    expect(calls).toEqual(['/dsh-quote/api/claim?sessionId=session-abc'])
  })
})
