/**
 * dsh-quote fold unit tests: the pure decision logic for injecting pending
 * quotes on the next REAL user-text turn (ADR-0001 / CONTEXT.md semantics).
 * The fold is exercised through a fake store and a fake context factory, so
 * no DSH runtime is required.
 */
import { describe, expect, it } from 'vitest'

import { foldPendingQuotes, isRealUserTurn } from '../src/quote-fold.ts'
import type { Decision, MessageLike, PendingQuoteFace } from '../src/quote-fold.ts'
import { QuoteStore } from '../src/quote-store.ts'

/** A minimal fake message with a source (source.kind mirrors the dsh model). */
function msg(sourceKind: string, id = `${sourceKind}-${Math.random()}`): MessageLike {
  return { source: { kind: sourceKind } }
}

/** A context factory that tags injected messages with a marker prefix. */
const fakeFactory = {
  contextMessage(quote: { id: string; text: string }): MessageLike {
    return { source: { kind: 'plugin' }, __quote: quote.text } as MessageLike
  },
}

function enterDecision(msgs: MessageLike[]): Decision<MessageLike> {
  return { kind: 'enter', messages: msgs }
}

function fakePending(quotes: Array<{ id: string; text: string }>): PendingQuoteFace {
  const store = new QuoteStore()
  for (const q of quotes) store.add('s', q.text, { sourceMessageId: q.id })
  return store
}

describe('isRealUserTurn', () => {
  it('true when at least one claimed message is user-origin', () => {
    expect(isRealUserTurn([msg('user')])).toBe(true)
    expect(isRealUserTurn([msg('user'), msg('tool')])).toBe(true)
  })

  it('false when empty or no genuine user message', () => {
    expect(isRealUserTurn([])).toBe(false)
    expect(isRealUserTurn([msg('plugin'), msg('tool')])).toBe(false)
    expect(isRealUserTurn([msg('model')])).toBe(false)
  })
})

describe('foldPendingQuotes', () => {
  it('no-ops on a rejected decision', () => {
    const d: Decision<MessageLike> = { kind: 'reject' }
    const out = foldPendingQuotes(d, [msg('user')], fakePending([{ id: 'q', text: 'x' }]), 's', fakeFactory)
    expect(out).toBe(d)
  })

  it('does NOT consume on a step with no real user message (assistant/tool continuation)', () => {
    const d = enterDecision([msg('plugin')])
    const pending = fakePending([{ id: 'q', text: 'keep' }])
    const out = foldPendingQuotes(d, [msg('plugin')], pending, 's', fakeFactory)
    expect(out).toBe(d)
    expect(pending.has('s')).toBe(true) // queue untouched
  })

  it('injects all pending quotes onto a real user turn and clears the queue', () => {
    const pending = fakePending([{ id: 'q1', text: 'first' }, { id: 'q2', text: 'second' }])
    const claimed = [msg('user')]
    const d = enterDecision(claimed)
    const out = foldPendingQuotes(d, claimed, pending, 's', fakeFactory)
    expect(out.kind).toBe('enter')
    if (out.kind !== 'enter') return
    // injected messages appended after the claimed user message
    expect(out.messages.length).toBe(1 + 2)
    expect(pending.has('s')).toBe(false) // one-shot: cleared
  })

  it('no-op when a real user turn arrives but the session has no pending quotes', () => {
    const d = enterDecision([msg('user')])
    const empty = fakePending([])
    const out = foldPendingQuotes(d, [msg('user')], empty, 's', fakeFactory)
    expect(out).toBe(d)
  })

  it('injected context does not enter the user message text (separate messages)', () => {
    const claimed = [msg('user', 'the-user-typed-question')]
    const d = enterDecision(claimed)
    const out = foldPendingQuotes(d, claimed, fakePending([{ id: 'q', text: 'quoted block' }]), 's', fakeFactory)
    if (out.kind !== 'enter') return
    // the user's own message is preserved verbatim as the first message
    expect(out.messages[0]).toBe(claimed[0])
    // an injected context message follows it, distinct from the user text
    expect(out.messages[1]).not.toBe(claimed[0])
  })

  it('places injected context after the user message even when decision.messages instances differ from claimed', () => {
    // Simulate the loop handing the listener a `claimed` slice that is NOT the
    // same object instance as the messages inside decision.messages. Placement
    // must be by source kind, not reference identity.
    const claimed = [msg('user', 'claimed-user')]
    const inDecision = [msg('user', 'in-decision-user'), msg('tool', 'tool-result')]
    const d = enterDecision(inDecision)
    const out = foldPendingQuotes(d, claimed, fakePending([{ id: 'q', text: 'quoted' }]), 's', fakeFactory)
    if (out.kind !== 'enter') return
    expect(out.messages.map(m => m.source?.kind)).toEqual(['user', 'plugin', 'tool'])
    expect(out.messages[0]).toBe(inDecision[0]) // user message unchanged & first
    // injected context lands right after the user message (index 1), before the tool result
    expect(out.messages[1]?.source?.kind).toBe('plugin')
    expect(out.messages[2]).toBe(inDecision[1]) // tool result preserved after
  })

  // The gate reads `claimed` while placement reads `decision.messages`. A step
  // whose claim is empty is a continuation of work already under way, NOT a
  // fresh user turn, so it must keep the quote. This is the behaviour that made
  // a mid-turn agent look like a stalled queue (ADR-0002): the card correctly
  // waits, and the rail now explains that instead of sitting silent.
  it('keeps the quote on a continuation step that claims nothing, even with a busy step', () => {
    const pending = fakePending([{ id: 'q', text: 'must wait' }])
    const d = enterDecision([msg('tool', 'tool-result')])
    const out = foldPendingQuotes(d, [], pending, 's', fakeFactory)
    expect(out).toBe(d)
    expect(pending.has('s')).toBe(true)
  })

  it('consumes on the first step that claims a user message, however many empty claims preceded it', () => {
    const pending = fakePending([{ id: 'q', text: 'rides the next turn' }])
    // A long run of empty claims (a busy agent) must not drain or drop it.
    for (let i = 0; i < 39; i += 1) {
      const d = enterDecision([msg('tool')])
      foldPendingQuotes(d, [], pending, 's', fakeFactory)
    }
    expect(pending.has('s')).toBe(true)

    // Then the real user turn arrives and takes it.
    const claimed = [msg('user')]
    const d = enterDecision(claimed)
    const out = foldPendingQuotes(d, claimed, pending, 's', fakeFactory)
    if (out.kind !== 'enter') return
    expect(out.messages.length).toBe(2)
    expect(pending.has('s')).toBe(false)
  })
})
