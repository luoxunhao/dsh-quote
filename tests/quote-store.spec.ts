/**
 * dsh-quote quote-store unit tests: session isolation, insertion order,
 * per-quote removal, wholesale clear, and one-shot drain semantics.
 */
import { describe, expect, it } from 'vitest'

import { QuoteStore } from '../src/quote-store.ts'

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
