/**
 * @vitest-environment jsdom
 * dsh-quote transcript row marking: the collapsed injected-context row carries
 * no attribute that names its producer, so the plugin identifies its own rows by
 * the producer text the host renders and marks them for the card stylesheet.
 * The fixtures mirror the real ChatNodeSeat shape (flow row → slot outlet →
 * DisclosureRow chrome → [data-context-source]).
 */
import { describe, expect, it } from 'vitest'

import { markQuoteContextRows } from '../src/client/context-rows.ts'

/** Build one collapsed injected-context row as the host renders it. */
function contextRow(producer: string | null, summary?: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'EvIC1a_flowItem'
  row.dataset['chatFlowKind'] = 'context'
  const outlet = document.createElement('div')
  outlet.dataset.slot = 'conversation.chat.node'
  const chrome = document.createElement('div')
  const header = document.createElement('div')
  header.setAttribute('data-disclosure-row', 'true')
  const title = document.createElement('span')
  title.textContent = '上下文注入'
  header.appendChild(title)
  if (producer !== null) {
    const source = document.createElement('span')
    source.setAttribute('data-context-source', '')
    source.textContent = producer
    header.appendChild(source)
  }
  if (summary !== undefined) {
    const text = document.createElement('span')
    text.setAttribute('data-context-summary', '')
    text.textContent = summary
    header.appendChild(text)
  }
  chrome.appendChild(header)
  outlet.appendChild(chrome)
  row.appendChild(outlet)
  return row
}

const MARK = 'data-dsh-quote-context'

describe('markQuoteContextRows', () => {
  it('marks the row produced by dsh-quote', () => {
    const root = document.createElement('div')
    root.appendChild(contextRow('dsh-quote', 'Quoted: 一段引文'))
    expect(markQuoteContextRows(root)).toBe(1)
    expect(root.firstElementChild?.hasAttribute(MARK)).toBe(true)
  })

  it('leaves every other producer alone', () => {
    const root = document.createElement('div')
    for (const producer of ['tool-jobs', 'AGENTS.md', 'skill-catalog', 'dsh-codex-project'])
      root.appendChild(contextRow(producer, 'whatever'))
    expect(markQuoteContextRows(root)).toBe(0)
    expect([...root.children].every(child => !child.hasAttribute(MARK))).toBe(true)
  })

  it('removes a mark that no longer belongs', () => {
    const row = contextRow('tool-jobs')
    row.setAttribute(MARK, '')
    const root = document.createElement('div')
    root.appendChild(row)
    expect(markQuoteContextRows(root)).toBe(0)
    expect(row.hasAttribute(MARK)).toBe(false)
  })

  it('tolerates surrounding whitespace in the producer text', () => {
    const root = document.createElement('div')
    root.appendChild(contextRow('  dsh-quote\n'))
    expect(markQuoteContextRows(root)).toBe(1)
  })

  it('skips a row that names no producer', () => {
    const root = document.createElement('div')
    root.appendChild(contextRow(null))
    expect(markQuoteContextRows(root)).toBe(0)
    expect(root.firstElementChild?.hasAttribute(MARK)).toBe(false)
  })

  it('ignores rows that are not injected context', () => {
    const user = contextRow('dsh-quote')
    user.dataset['chatFlowKind'] = 'user'
    const root = document.createElement('div')
    root.appendChild(user)
    expect(markQuoteContextRows(root)).toBe(0)
    expect(user.hasAttribute(MARK)).toBe(false)
  })

  it('marks the root itself when it is a context row', () => {
    const row = contextRow('dsh-quote')
    expect(markQuoteContextRows(row)).toBe(1)
    expect(row.hasAttribute(MARK)).toBe(true)
  })

  it('is idempotent', () => {
    const root = document.createElement('div')
    root.appendChild(contextRow('dsh-quote'))
    expect(markQuoteContextRows(root)).toBe(1)
    expect(markQuoteContextRows(root)).toBe(1)
  })
})
