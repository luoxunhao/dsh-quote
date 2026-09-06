/**
 * @vitest-environment jsdom
 * dsh-quote client capture tests: resolution of a text selection over a chat
 * row into a quote candidate (any selectable text-bearing row may be quoted).
 * jsdom provides Element/DOM.
 */
import { describe, expect, it } from 'vitest'

import { quoteFromSelection } from '../src/client/quote-dock.tsx'

/** Build a chat row (with data-chat-flow-*) containing a selectable text node. */
function rowWithText(text: string, key: string, kind?: string): { row: HTMLElement; textNode: Text } {
  const row = document.createElement('div')
  row.setAttribute('data-chat-flow-key', key)
  if (kind !== undefined) row.setAttribute('data-chat-flow-kind', kind)
  const span = document.createElement('span')
  span.textContent = text
  row.appendChild(span)
  const textNode = span.firstChild as Text
  return { row, textNode }
}

describe('quoteFromSelection', () => {
  it('returns undefined on empty selection', () => {
    const { row } = rowWithText('some text', 'k1', 'assistant-step')
    expect(quoteFromSelection('   ', row)).toBeUndefined()
  })

  it('returns undefined when the anchor is not inside a chat row', () => {
    const outside = document.createElement('p')
    outside.textContent = 'not a chat row'
    const outsideNode = outside.firstChild as Text
    expect(quoteFromSelection('hello', outsideNode)).toBeUndefined()
  })

  it('returns undefined when the selection text is empty', () => {
    const { row } = rowWithText('text', 'k1', 'assistant-step')
    expect(quoteFromSelection('', row)).toBeUndefined()
  })

  it('quotes text over an assistant row (anchor inside the row)', () => {
    const { textNode } = rowWithText('selected text', 'k1', 'assistant-step')
    const out = quoteFromSelection('selected text', textNode)
    expect(out?.text).toBe('selected text')
    expect(out?.sourceKind).toBe('assistant-step')
  })

  it('quotes text over a user or tool row (any selectable block)', () => {
    const { textNode: userNode } = rowWithText('mine', 'k2', 'user')
    expect(quoteFromSelection('mine', userNode)?.sourceKind).toBe('user')
    const { textNode: toolNode } = rowWithText('tool out', 'k3', 'tool')
    expect(quoteFromSelection('tool out', toolNode)?.sourceKind).toBe('tool')
  })

  it('accepts the row element itself as the anchor', () => {
    const { row } = rowWithText('block', 'k1', 'assistant-step')
    const out = quoteFromSelection('block', row)
    expect(out?.sourceKind).toBe('assistant-step')
  })

  it('captures sourceMessageId only when nodes resolve it', () => {
    const { textNode } = rowWithText('selected', 'k1', 'assistant-step')
    const nodes = { get: (key: string) => key === 'k1'
      ? { data: { status: 'settled', finalNode: { messageId: 'm-42' } } }
      : undefined }
    const out = quoteFromSelection('selected', textNode, nodes)
    expect(out?.sourceMessageId).toBe('m-42')
    // without nodes, no messageId
    expect(quoteFromSelection('selected', textNode)?.sourceMessageId).toBeUndefined()
  })

  it('trims surrounding whitespace from the selection', () => {
    const { textNode } = rowWithText('  pick me  ', 'k1', 'assistant-step')
    expect(quoteFromSelection('  pick me  ', textNode)?.text).toBe('pick me')
  })
})
