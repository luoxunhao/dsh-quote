/**
 * dsh-quote quote-store unit tests: session isolation, insertion order,
 * per-quote removal, wholesale clear, one-shot drain semantics, and the sent
 * history that backs the composer receipt.
 */
import { describe, expect, it } from 'vitest'

import { QuoteStore, SentQuoteStore } from '../src/quote-store.ts'

describe('QuoteStore', () => {
  it('starts empty per session', () => {
    const store = new QuoteStore()
    expect(store.list('s1')).toEqual([])
    expect(store.has('s1')).toBe(false)
    expect(store.state('s1').quotes).toEqual([])
  })

  it('adds quotes at the tail in insertion order, per session (no cross-session union)', () => {
    const store = new QuoteStore()
    const a = store.add('s1', 'first')
    const b = store.add('s1', 'second')
    store.add('s2', 'other session')
    expect(store.list('s1').map(q => q.text)).toEqual(['first', 'second'])
    expect(store.list('s2').map(q => q.text)).toEqual(['other session'])
    expect(store.has('s1')).toBe(true)
    expect(a.id).not.toBe(b.id)
    expect(a.text).toBe('first')
  })

  it('records optional provenance', () => {
    const store = new QuoteStore()
    const q = store.add('s1', 'selected', { sourceMessageId: 'm-1', sourceKind: 'assistant' })
    expect(q.sourceMessageId).toBe('m-1')
    expect(q.sourceKind).toBe('assistant')
    expect(store.list('s1')[0]?.sourceMessageId).toBe('m-1')
  })

  it('removes a single quote by id', () => {
    const store = new QuoteStore()
    const a = store.add('s1', 'a')
    const b = store.add('s1', 'b')
    expect(store.remove('s1', a.id)).toBe(true)
    expect(store.list('s1').map(q => q.text)).toEqual(['b'])
    // removing the last quote clears the bucket
    expect(store.remove('s1', b.id)).toBe(true)
    expect(store.has('s1')).toBe(false)
  })

  it('remove of unknown id / session returns false', () => {
    const store = new QuoteStore()
    expect(store.remove('missing', 'nope')).toBe(false)
    store.add('s1', 'x')
    expect(store.remove('s1', 'nope')).toBe(false)
    expect(store.list('s1').length).toBe(1)
  })

  it('clear empties a session', () => {
    const store = new QuoteStore()
    store.add('s1', 'a')
    store.add('s1', 'b')
    store.clear('s1')
    expect(store.has('s1')).toBe(false)
    expect(store.list('s1')).toEqual([])
  })

  it('take drains and returns the quotes (one-shot semantics)', () => {
    const store = new QuoteStore()
    store.add('s1', 'a')
    store.add('s1', 'b')
    const drained = store.take('s1')
    expect(drained.map(q => q.text)).toEqual(['a', 'b'])
    expect(store.has('s1')).toBe(false)
    // take on an empty session is a no-op
    expect(store.take('s1')).toEqual([])
  })
})

describe('QuoteStore claim-on-send', () => {
  it('reports every quote as staged before any send', () => {
    const store = new QuoteStore()
    store.add('s1', 'a')
    store.add('s1', 'b')
    expect(store.staged('s1').map(q => q.text)).toEqual(['a', 'b'])
  })

  it('claims the staged quotes and stops reporting them as staged', () => {
    const store = new QuoteStore()
    store.add('s1', 'a')
    store.add('s1', 'b')
    const claimed = store.claim('s1')
    expect(claimed.map(q => q.text)).toEqual(['a', 'b'])
    // The composer must not show them any more...
    expect(store.staged('s1')).toEqual([])
    // ...but the fold still has them to inject.
    expect(store.list('s1').map(q => q.text)).toEqual(['a', 'b'])
  })

  it('is idempotent: a second claim reports nothing new', () => {
    const store = new QuoteStore()
    store.add('s1', 'a')
    store.claim('s1')
    expect(store.claim('s1')).toEqual([])
    expect(store.list('s1')).toHaveLength(1)
  })

  it('leaves a quote staged after a claim on an empty session', () => {
    const store = new QuoteStore()
    expect(store.claim('s1')).toEqual([])
    store.add('s1', 'later')
    expect(store.staged('s1').map(q => q.text)).toEqual(['later'])
  })

  it('separates sessions', () => {
    const store = new QuoteStore()
    store.add('s1', 'mine')
    store.add('s2', 'theirs')
    store.claim('s1')
    expect(store.staged('s1')).toEqual([])
    expect(store.staged('s2').map(q => q.text)).toEqual(['theirs'])
  })

  it('a claimed quote is still injected by the fold', () => {
    // Claiming changes presentation only; the one-shot injection must survive it.
    const store = new QuoteStore()
    store.add('s1', 'rides the sent message')
    store.claim('s1')
    const taken = store.take('s1')
    expect(taken.map(q => q.text)).toEqual(['rides the sent message'])
    expect(store.has('s1')).toBe(false)
  })
})

describe('SentQuoteStore', () => {
  it('starts empty per session', () => {
    const store = new SentQuoteStore()
    expect(store.list('s1')).toEqual([])
  })

  it('records sent quotes oldest first, per session', () => {
    const store = new SentQuoteStore()
    store.record('s1', [{ id: 'q1', text: 'first' }], 1000)
    store.record('s1', [{ id: 'q2', text: 'second' }], 2000)
    store.record('s2', [{ id: 'q3', text: 'other' }], 3000)
    expect(store.list('s1').map(q => q.text)).toEqual(['first', 'second'])
    expect(store.list('s2').map(q => q.text)).toEqual(['other'])
    expect(store.list('s1')[0]?.sentAt).toBe(1000)
  })

  it('records several quotes from one step in injection order', () => {
    const store = new SentQuoteStore()
    const recorded = store.record('s1', [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], 500)
    expect(recorded).toHaveLength(2)
    expect(store.list('s1').map(q => q.id)).toEqual(['a', 'b'])
  })

  it('records nothing when a step injected nothing', () => {
    const store = new SentQuoteStore()
    expect(store.record('s1', [])).toEqual([])
    expect(store.list('s1')).toEqual([])
  })

  it('keeps the history bounded, dropping the oldest', () => {
    const store = new SentQuoteStore()
    for (let i = 0; i < 25; i += 1) store.record('s1', [{ id: `q${i}`, text: `t${i}` }], i)
    const list = store.list('s1')
    expect(list).toHaveLength(20)
    expect(list[0]?.id).toBe('q5')
    expect(list.at(-1)?.id).toBe('q24')
  })

  it('drops one sent quote by id and reports whether it existed', () => {
    const store = new SentQuoteStore()
    store.record('s1', [{ id: 'q1', text: 'a' }, { id: 'q2', text: 'b' }], 0)
    expect(store.remove('s1', 'q1')).toBe(true)
    expect(store.list('s1').map(q => q.id)).toEqual(['q2'])
    expect(store.remove('s1', 'nope')).toBe(false)
    // removing the last entry clears the bucket
    expect(store.remove('s1', 'q2')).toBe(true)
    expect(store.list('s1')).toEqual([])
  })

  it('reports false when removing from an unknown session', () => {
    const store = new SentQuoteStore()
    expect(store.remove('missing', 'q1')).toBe(false)
  })

  it('clear forgets a session entirely', () => {
    const store = new SentQuoteStore()
    store.record('s1', [{ id: 'q1', text: 'a' }], 0)
    store.clear('s1')
    expect(store.list('s1')).toEqual([])
  })
})
