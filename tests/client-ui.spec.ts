/**
 * @vitest-environment jsdom
 * dsh-quote client presentation tests: the selection-menu placement, the
 * source-row label shown on a quote chip, the pending-quote rail markup, and the
 * rule that keeps a submitted quote from reappearing — the two surfaces this
 * plugin owns in the composer, plus the send-clear rule behind them. The
 * transcript needs no assertion here: a quote is an ordinary user message and
 * the GUI renders its bubble by itself (see docs/adr/0003-quote-as-user-message.md).
 * Components render through react-dom/server so the assertions read the
 * committed DOM shape without a test-only renderer dependency.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import { QuoteRail, menuPosition, selectRailQuotes, sourceKindLabel } from '../src/client/quote-dock.tsx'

const VIEWPORT = { width: 1200, height: 800 }
const MENU_SIZE = { width: 160, height: 32 }

describe('menuPosition', () => {
  it('centers the menu above the selection', () => {
    const out = menuPosition({ left: 200, top: 150, right: 300, bottom: 170 }, MENU_SIZE, VIEWPORT)
    expect(out).toEqual({ x: 250, y: 142, placement: 'above' })
  })

  it('flips below when there is no room above', () => {
    const out = menuPosition({ left: 200, top: 20, right: 300, bottom: 40 }, MENU_SIZE, VIEWPORT)
    expect(out).toEqual({ x: 250, y: 48, placement: 'below' })
  })

  it('clamps to the left and right viewport edges', () => {
    const left = menuPosition({ left: 0, top: 300, right: 40, bottom: 320 }, MENU_SIZE, VIEWPORT)
    expect(left.x).toBe(88)
    const right = menuPosition({ left: 1170, top: 300, right: 1210, bottom: 320 }, MENU_SIZE, VIEWPORT)
    expect(right.x).toBe(1112)
  })

  it('centers when the menu is wider than the viewport', () => {
    const out = menuPosition({ left: 0, top: 300, right: 10, bottom: 320 }, { width: 1400, height: 32 }, { width: 1000, height: 800 })
    expect(out.x).toBe(500)
  })

  it('ignores an unmeasured menu size without shifting the anchor', () => {
    const out = menuPosition({ left: 200, top: 150, right: 300, bottom: 170 }, { width: 0, height: 0 }, VIEWPORT)
    expect(out.x).toBe(250)
    expect(out.placement).toBe('above')
  })
})

describe('sourceKindLabel', () => {
  it('names the source row kind', () => {
    expect(sourceKindLabel('assistant-step')).toBe('助手消息')
    expect(sourceKindLabel('assistant')).toBe('助手消息')
    expect(sourceKindLabel('user')).toBe('用户消息')
    expect(sourceKindLabel('reasoning')).toBe('思考过程')
  })

  it('groups every tool row kind under one label', () => {
    expect(sourceKindLabel('tool')).toBe('工具输出')
    expect(sourceKindLabel('tool-call')).toBe('工具输出')
    expect(sourceKindLabel('tool-result')).toBe('工具输出')
  })

  it('falls back to the selection label for unknown or missing kinds', () => {
    expect(sourceKindLabel()).toBe('选中的文本')
    expect(sourceKindLabel('turn-process')).toBe('选中的文本')
    expect(sourceKindLabel('')).toBe('选中的文本')
  })
})

describe('QuoteRail', () => {
  const quotes = [
    { id: 'q1', text: '并且没有偷偷修好我埋的真 bug——这一行很长很长很长', sourceKind: 'assistant-step' },
    { id: 'q2', text: '短引文', sourceKind: 'user' },
  ]

  it('renders nothing when there is no pending quote', () => {
    expect(renderToStaticMarkup(createElement(QuoteRail, { quotes: [], onRemove: () => {} }))).toBe('')
  })

  it('renders one card per quote with the source label as the subtitle', () => {
    const html = renderToStaticMarkup(createElement(QuoteRail, { quotes, onRemove: () => {} }))
    expect(html).toContain('data-dsh-quote-rail=""')
    expect(html).toContain('data-quote-id="q1"')
    expect(html).toContain('data-quote-id="q2"')
    // CSS ellipsizes the title, so the verbatim text is what ships in the markup.
    expect(html).toContain('并且没有偷偷修好我埋的真 bug——这一行很长很长很长')
    expect(html).toContain('助手消息')
    expect(html).toContain('用户消息')
  })

  it('gives every card a removal control addressed to its own quote id', () => {
    const html = renderToStaticMarkup(createElement(QuoteRail, { quotes, onRemove: () => {} }))
    expect(html.match(/aria-label="移除引用"/g)).toHaveLength(2)
    expect(html).toContain('data-quote-remove="q1"')
  })

  it('labels an unattributed quote as selected text', () => {
    const html = renderToStaticMarkup(createElement(QuoteRail, { quotes: [{ id: 'q3', text: 'x' }], onRemove: () => {} }))
    expect(html).toContain('选中的文本')
  })

  it('shows the source label immediately after staging', () => {
    // No "agent is busy" state exists: the composer exposes no running-turn
    // affordance to a plugin, so such an indicator could only be a guess. The
    // send itself is decided by the host (see ADR-0002).
    const html = renderToStaticMarkup(createElement(QuoteRail, {
      quotes: [{ id: 'q5', text: 'x', sourceKind: 'assistant-step' }],
      onRemove: () => {},
    }))
    expect(html).toContain('助手消息')
  })

  it('never renders a turn-state hint', () => {
    const html = renderToStaticMarkup(createElement(QuoteRail, {
      quotes: [{ id: 'q6', text: 'x', sourceKind: 'assistant' }],
      onRemove: () => {},
    }))
    expect(html).not.toContain('回合进行中')
  })
})

describe('selectRailQuotes (requirement: a sent card must not come back)', () => {
  const staged = [
    { id: 'q1', text: '已提交的引文' },
    { id: 'q2', text: '还没发的引文' },
  ]

  it('hides a submitted quote the host still reports as staged', () => {
    // This is the exact state a send-while-busy produces: the user submitted, but
    // the host has not drained the queue because no turn has started yet. The
    // card must stay gone for the whole (unbounded) wait.
    const submitted = new Set(['q1'])
    const visible = selectRailQuotes(staged, submitted)
    expect(visible.map(q => q.id)).toEqual(['q2'])
    // ...and the record is KEPT, so the next poll hides it again.
    expect(submitted.has('q1')).toBe(true)
    expect(selectRailQuotes(staged, submitted).map(q => q.id)).toEqual(['q2'])
  })

  it('prunes ids the host no longer reports, so the record stays bounded', () => {
    const submitted = new Set(['q1', 'gone'])
    selectRailQuotes(staged, submitted)
    expect([...submitted]).toEqual(['q1'])
  })

  it('shows everything when nothing has been submitted', () => {
    expect(selectRailQuotes(staged, new Set()).map(q => q.id)).toEqual(['q1', 'q2'])
  })

  it('empties the rail once every staged quote has been submitted', () => {
    expect(selectRailQuotes(staged, new Set(['q1', 'q2']))).toEqual([])
  })
})
