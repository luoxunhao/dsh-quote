/**
 * A quote must be delivered under this plugin's OWN source kind.
 *
 * Why this is a test and not a comment: the GUI's `messageDefinition` claims every
 * append-surface `user/message` event, and it classifies purely on `source.kind`:
 *
 *   - `kind === 'user'`  -> a `user` node, i.e. an ordinary user bubble that a
 *     plugin can never restyle;
 *   - any other kind     -> a `context` node, which `isVisibleChatNode` hides
 *     unless it carries tool additions/removals (ADR-0002).
 *
 * So neither DEFAULT projection can show a quote as an injected-context row. What
 * makes the visible row possible is the plugin registering its OWN Conversation
 * definition for this kind (see `src/client/quote-row.ts`), which republishes the
 * event as a `quote` node — a kind outside the visibility blacklist.
 *
 * That join is a two-sided contract: the host stamps `source.kind` here, and the
 * client definition matches `source.kind` there. This file pins the host half; a
 * mismatch would silently render nothing at all.
 */
import { describe, expect, it } from 'vitest'

import { buildContextUserMessage, quoteSummary } from '../src/quote-context.ts'
import { PLUGIN_NAME, QUOTE_CONTEXT_KIND } from '../src/source-kind.ts'

/** A minimal pending quote, as the store hands one to the context factory. */
const QUOTE = { id: 'q1', text: '选中的一段文字' }

describe('quote delivery', () => {
  it('carries the plugin\'s own source kind, which the client definition matches', () => {
    expect(buildContextUserMessage(QUOTE).source).toMatchObject({ kind: QUOTE_CONTEXT_KIND })
  })

  it('does NOT impersonate a user message', () => {
    // `kind: 'user'` would make the GUI draw an ordinary user bubble and leave
    // the plugin no way to render a distinguishable row.
    expect(buildContextUserMessage(QUOTE).source.kind).not.toBe('user')
  })

  it('distinguishes the durable source kind from the cordis plugin name', () => {
    // Load-bearing: the client matches on the source kind string, not the plugin
    // name. Collapsing the two would make the definition match the wrong events.
    expect(QUOTE_CONTEXT_KIND).not.toBe(PLUGIN_NAME)
    expect(QUOTE_CONTEXT_KIND).toBe('quote-context')
  })

  it('is still a user-role message the model reads as context', () => {
    expect(buildContextUserMessage(QUOTE).role).toBe('user')
  })

  it('carries the quoted text verbatim as its only content', () => {
    const message = buildContextUserMessage(QUOTE)
    expect(message.content).toEqual([{ type: 'text', text: QUOTE.text }])
  })

  it('stamps a notice form and a bounded summary the row can show collapsed', () => {
    const message = buildContextUserMessage(QUOTE)
    expect(message.source).toMatchObject({ form: 'notice', summary: QUOTE.text })
  })
})

describe('quoteSummary', () => {
  it('collapses whitespace so the collapsed row stays one line', () => {
    expect(quoteSummary('  a\n\n b\t c  ')).toBe('a b c')
  })

  it('bounds a long selection with an ellipsis', () => {
    const long = 'x'.repeat(400)
    const summary = quoteSummary(long)
    expect(summary.length).toBeLessThanOrEqual(80)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('leaves a short selection untouched', () => {
    expect(quoteSummary('short quote')).toBe('short quote')
  })
})
