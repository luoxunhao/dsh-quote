/**
 * @vitest-environment jsdom
 * dsh-quote client presentation tests: the selection-menu placement, the
 * source-row label shown on a quote chip, and the pending-quote rail markup —
 * the surfaces this plugin owns in the composer. The transcript needs no
 * assertion here: a quote renders through this plugin's own Chat node definition
 * (see docs/adr/0004-quote-as-own-chat-node.md).
 * Components render through react-dom/server so the assertions read the
 * committed DOM shape without a test-only renderer dependency.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import { QuoteRail, isSubmitKeyEvent, menuPosition, railSourceLabel, sourceKindLabel } from '../src/client/quote-dock.tsx'

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

describe('railSourceLabel', () => {
  it('shows the FILE name when the quote came out of a file', () => {
    // The user needs to see WHICH file a passage came from; a generic row label
    // would hide exactly that.
    expect(railSourceLabel({ filePath: 'E:\\project\\dsh\\dsh-quote\\src\\api.ts' })).toBe('api.ts')
    expect(railSourceLabel({ filePath: '/home/me/proj/README.md' })).toBe('README.md')
  })

  it('prefers the file over the row kind, which carries less information', () => {
    expect(railSourceLabel({ filePath: 'E:\\p\\a.ts', sourceKind: 'assistant' })).toBe('a.ts')
  })

  it('falls back to the row kind when the quote did not come from a file', () => {
    expect(railSourceLabel({ sourceKind: 'tool' })).toBe('工具输出')
    expect(railSourceLabel({})).toBe('选中的文本')
  })

  it('ignores a blank file path rather than rendering an empty subtitle', () => {
    expect(railSourceLabel({ filePath: '   ', sourceKind: 'user' })).toBe('用户消息')
    expect(railSourceLabel({ filePath: '' })).toBe('选中的文本')
  })

  it('tolerates a path with no trailing segment', () => {
    expect(railSourceLabel({ filePath: 'E:\\' })).toBe('E:')
  })
})

describe('isSubmitKeyEvent (submit must not be confused with a deletion)', () => {
  // Regression: the rail used to clear on "the draft had text and is now empty",
  // which fires just as well when the user DELETES their draft. That misread hid
  // the quote card permanently (the ids were also recorded as submitted) while the
  // host still held the quote and injected it on the next real message — so the
  // user saw no card and accumulated invisible quotes. Pinning the trigger to the
  // submit keystroke removes the ambiguity at its source.

  it('accepts a bare Enter, which is what submits', () => {
    expect(isSubmitKeyEvent({ key: 'Enter' })).toBe(true)
  })

  it('rejects Enter with a modifier, which the composer binds elsewhere', () => {
    expect(isSubmitKeyEvent({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(isSubmitKeyEvent({ key: 'Enter', altKey: true })).toBe(false)
    expect(isSubmitKeyEvent({ key: 'Enter', ctrlKey: true })).toBe(false)
    expect(isSubmitKeyEvent({ key: 'Enter', metaKey: true })).toBe(false)
  })

  it('rejects an IME confirmation, which also reports Enter but is text entry', () => {
    expect(isSubmitKeyEvent({ key: 'Enter', isComposing: true })).toBe(false)
  })

  it('rejects the keys a deletion is made of', () => {
    // These are the events that emptied the draft in the reported bug. None of
    // them may be read as a submit.
    for (const key of ['Backspace', 'Delete', 'a', 'Escape', ' ']) {
      expect(isSubmitKeyEvent({ key })).toBe(false)
    }
  })

  it('rejects a selection-replacing keystroke that empties the draft', () => {
    // Ctrl+A then Backspace is a common way to clear the composer before typing
    // something else; neither half is a submit.
    expect(isSubmitKeyEvent({ key: 'a', ctrlKey: true })).toBe(false)
    expect(isSubmitKeyEvent({ key: 'Backspace' })).toBe(false)
  })
})

