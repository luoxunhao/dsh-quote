/**
 * Fold failure atomicity: a failed injection attempt must not destroy the quotes.
 *
 * `foldPendingQuotes` used to call `pending.take(sessionId)` BEFORE building the
 * context messages. A factory that threw left the queue empty with nothing
 * injected, and the host's `catch` swallowed the error — so the rail cleared as
 * though the injection had succeeded and no receipt was recorded. The quote was
 * gone with no trace in the UI.
 *
 * Scope: this closed a LATENT defect, not an observed one. The shipped factory
 * (`buildContextUserMessage`) runs `structuredClone`, which accepts every string
 * the HTTP bridge can deliver — ordinary text, 200k characters, lone surrogates,
 * and even a missing `text`. The fold is fixed regardless, because it is the
 * component that owns the invariant and a future factory (or a change in the
 * bridge's validation) must not be able to reintroduce the loss.
 */
import { describe, expect, it } from 'vitest'

import { foldPendingQuotes } from '../src/quote-fold.ts'
import type { Decision, MessageLike } from '../src/quote-fold.ts'
import { QuoteStore } from '../src/quote-store.ts'

function msg(sourceKind: string): MessageLike {
  return { source: { kind: sourceKind } }
}

describe('foldPendingQuotes failure atomicity', () => {
  it('keeps the quotes when the context factory throws', () => {
    const store = new QuoteStore()
    store.add('s', 'important quote')
    const claimed = [msg('user')]
    const decision: Decision<MessageLike> = { kind: 'enter', messages: claimed }

    const throwing = {
      contextMessage(): MessageLike {
        throw new Error('factory exploded')
      },
    }

    expect(() => foldPendingQuotes(decision, claimed, store, 's', throwing)).toThrow('factory exploded')
    // The quote must survive a failed injection attempt.
    expect(store.has('s')).toBe(true)
    expect(store.list('s').map(q => q.text)).toEqual(['important quote'])
  })

  it('keeps ALL quotes when the factory fails partway through', () => {
    // Draining first would lose the quotes already built as well as the ones
    // not yet reached; the queue must be untouched by a partial failure.
    const store = new QuoteStore()
    store.add('s', 'first')
    store.add('s', 'second')
    store.add('s', 'third')
    const claimed = [msg('user')]
    const decision: Decision<MessageLike> = { kind: 'enter', messages: claimed }

    let calls = 0
    const flaky = {
      contextMessage(): MessageLike {
        calls += 1
        if (calls === 2) throw new Error('second one failed')
        return msg('plugin')
      },
    }

    expect(() => foldPendingQuotes(decision, claimed, store, 's', flaky)).toThrow('second one failed')
    expect(store.list('s').map(q => q.text)).toEqual(['first', 'second', 'third'])
  })

  it('drains exactly once on a successful fold, and the retry injects the same quotes', () => {
    const store = new QuoteStore()
    store.add('s', 'retryable')
    const claimed = [msg('user')]
    const decision: Decision<MessageLike> = { kind: 'enter', messages: claimed }

    // First attempt fails and leaves the queue intact...
    expect(() => foldPendingQuotes(decision, claimed, store, 's', {
      contextMessage(): MessageLike { throw new Error('boom') },
    })).toThrow('boom')
    expect(store.has('s')).toBe(true)

    // ...so a later step can still deliver it.
    const out = foldPendingQuotes(decision, claimed, store, 's', {
      contextMessage: () => msg('plugin'),
    })
    if (out.kind !== 'enter') throw new Error('expected enter')
    expect(out.messages.map(m => m.source?.kind)).toEqual(['plugin', 'user'])
    expect(store.has('s')).toBe(false)
  })
})
