/**
 * @vitest-environment jsdom
 * dsh-quote client capture tests: resolution of a right-click over a chat row
 * into a quote candidate (any selectable text-bearing row may be quoted).
 * jsdom provides Element/DOM.
 */
import { describe, expect, it } from 'vitest'

import { quoteFromChatRow } from '../src/client/quote-dock.tsx'

function rowWithKey(key: string, kind?: string): HTMLElement {
  const div = document.createElement('div')
  div.setAttribute('data-chat-flow-key', key)
  if (kind !== undefined) div.setAttribute('data-chat-flow-kind', kind)
  return div
}

/** A fake chat node store keyed like the snapshot's nodes store. */
function nodeStore(records: Record<string, unknown>) {
  return { get: (key: string) => records[key] }
}

describe('quoteFromChatRow', () => {
  it('returns undefined on empty selection', () => {
    expect(quoteFromChatRow('   ', rowWithKey('k1'), nodeStore({}))).toBeUndefined()
  })

  it('returns undefined when the target is not inside a chat row', () => {
    const plain = document.createElement('p')
    plain.textContent = 'not a row'
    expect(quoteFromChatRow('hello', plain, nodeStore({}))).toBeUndefined()
  })

  it('quotes text over an assistant row', () => {
    const row = rowWithKey('k1', 'assistant-step')
    const out = quoteFromChatRow('selected text', row, nodeStore({}))
    expect(out).toEqual({ text: 'selected text', sourceKind: 'assistant-step' })
  })

  it('quotes text over a user or tool row (any selectable block)', () => {
    expect(quoteFromChatRow('mine', rowWithKey('k2', 'user'), nodeStore({}))?.text).toBe('mine')
    expect(quoteFromChatRow('tool out', rowWithKey('k3', 'tool'), nodeStore({}))?.sourceKind).toBe('tool')
  })

  it('captures the source message id from a settled assistant node', () => {
    const row = rowWithKey('k1', 'assistant-step')
    const nodes = nodeStore({
      k1: { data: { status: 'settled', finalNode: { messageId: 'm-42' } } },
    })
    const out = quoteFromChatRow('selected', row, nodes)
    expect(out).toEqual({ text: 'selected', sourceKind: 'assistant-step', sourceMessageId: 'm-42' })
  })

  it('trims surrounding whitespace from the selection', () => {
    const row = rowWithKey('k1', 'assistant-step')
    const out = quoteFromChatRow('  pick me  ', row, nodeStore({}))
    expect(out?.text).toBe('pick me')
  })
})
