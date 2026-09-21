/**
 * @vitest-environment jsdom
 * dsh-quote client presentation tests: the selection-menu placement, the
 * source-row label shown on a quote chip, and the pending-quote rail markup.
 * The rail is rendered through react-dom/server so the assertions read the
 * committed DOM shape without a test-only renderer dependency.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import { QuoteRail, menuPosition, sourceKindLabel } from '../src/client/quote-dock.tsx'

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
})
