/**
 * @vitest-environment jsdom
 * The quote Conversation definition: what it claims, what it must NOT claim, and
 * the visible node it publishes.
 *
 * This is the load-bearing half of a two-sided contract. The host stamps
 * `source.kind = 'quote-context'` on the injected message; this definition is
 * what turns that event into a VISIBLE row. If the match is too broad the plugin
 * hijacks messages it does not own (including the user's own), and if it is too
 * narrow the quote renders nowhere at all — both failures are silent in the GUI,
 * which is why they are pinned here.
 *
 * Why a private kind is needed at all: the host's `messageDefinition` classifies
 * every `user/message` on `source.kind`. `user` becomes an ordinary user bubble
 * no plugin can restyle; anything else becomes a `context` node that
 * `isVisibleChatNode` filters out. Registering our OWN kind is what escapes both
 * (ADR-0004).
 */
import { describe, expect, it } from 'vitest'

import { createQuoteDefinition, QUOTE_NODE_KIND } from '../src/client/quote-row.ts'
import { QUOTE_CONTEXT_KIND } from '../src/source-kind.ts'

const definition = createQuoteDefinition(QUOTE_CONTEXT_KIND)

/**
 * One append-surface `user/message` event carrying a plugin source.
 *
 * A key that is absent from `overrides` takes its normal value; a key that is
 * PRESENT with an explicit `undefined`/`null` stays absent on the event. The
 * distinction matters — `??` would fold "explicitly missing" back into the
 * default and make those cases untestable.
 * @param overrides - fields to substitute.
 */
function quoteEvent(overrides: {
  kind?: string
  id?: unknown
  text?: string
  summary?: unknown
  surfaceOp?: string
  type?: string
} = {}) {
  const has = <K extends string>(key: K): boolean => Object.hasOwn(overrides, key)
  return {
    type: has('type') ? overrides.type : 'user/message',
    seq: 42,
    time: 1_700_000_000_000,
    surfaceOp: has('surfaceOp') ? overrides.surfaceOp : 'append',
    data: {
      id: has('id') ? overrides.id : 'm1',
      content: [{ type: 'text', text: overrides.text ?? '引文正文' }],
      source: {
        kind: overrides.kind ?? QUOTE_CONTEXT_KIND,
        ...(has('summary') ? { summary: overrides.summary } : { summary: '引文摘要' }),
      },
    },
  }
}

const LOCATION = { kind: 'step' }

describe('quote definition identity', () => {
  it('publishes a kind outside the visibility blacklist', () => {
    // `system-prompt`, `context`, and permission commands are the only kinds
    // `isVisibleChatNode` rejects; anything else is visible by default.
    expect(definition.kind).toBe(QUOTE_NODE_KIND)
    expect(['system-prompt', 'context', 'command']).not.toContain(definition.kind)
  })

  it('targets the chat transcript', () => {
    expect(definition.target).toBe('chat')
  })
})

describe('quote definition match', () => {
  it('claims this plugin\'s own injected message', () => {
    expect(definition.match(quoteEvent())).toEqual({ id: 'm1', role: 'start' })
  })

  it('does NOT claim the user\'s own message', () => {
    // The host's messageDefinition owns those; claiming one would replace a real
    // user bubble with a quote row.
    expect(definition.match(quoteEvent({ kind: 'user' }))).toBeNull()
  })

  it('does NOT claim another plugin\'s or another kind\'s message', () => {
    expect(definition.match(quoteEvent({ kind: 'agent-instructions' }))).toBeNull()
    expect(definition.match(quoteEvent({ kind: 'skill-invocation' }))).toBeNull()
  })

  it('ignores non user/message events', () => {
    expect(definition.match(quoteEvent({ type: 'assistant/message' }))).toBeNull()
    expect(definition.match(quoteEvent({ type: 'tool/result' }))).toBeNull()
  })

  it('ignores a replacement copy, claiming only append-origin events', () => {
    // A replacement shadowed an existing surface range; the human transcript's
    // durable source material is append-origin events only.
    expect(definition.match(quoteEvent({ surfaceOp: 'replace' }))).toBeNull()
    expect(definition.match(quoteEvent({ surfaceOp: undefined }))).toBeNull()
  })

  it('ignores an event with no usable id', () => {
    expect(definition.match(quoteEvent({ id: undefined }))).toBeNull()
    expect(definition.match(quoteEvent({ id: null }))).toBeNull()
  })
})

describe('quote definition state and node', () => {
  const claim = { event: quoteEvent({ text: '被引用的原文', summary: '摘要文本' }) }

  it('carries the summary and the full text into state', () => {
    expect(definition.start(undefined, claim)).toMatchObject({
      id: 'm1',
      seq: 42,
      summary: '摘要文本',
      text: '被引用的原文',
    })
  })

  it('falls back to the text when the host sent no summary', () => {
    const state = definition.start(undefined, { event: quoteEvent({ text: '仅正文', summary: '' }) })
    expect(state.summary).toBe('仅正文')
  })

  it('publishes a VISIBLE node of this plugin\'s own kind', () => {
    const state = definition.start(undefined, claim)
    const node = definition.buildViewNode({ state, key: 'k1', id: 'm1', start: { location: LOCATION } })
    expect(node).toMatchObject({
      kind: QUOTE_NODE_KIND,
      target: 'chat',
      visibility: 'visible',
      anchorSeq: 42,
      location: LOCATION,
      data: { summary: '摘要文本', text: '被引用的原文' },
    })
  })

  it('publishes nothing before state exists', () => {
    // Guarding here is what keeps a half-built context from rendering a blank row.
    expect(definition.buildViewNode({ state: undefined, key: 'k1', id: 'm1' })).toBeNull()
  })

  it('keeps the message identifiable by the id the host stamped', () => {
    const state = definition.start(undefined, claim)
    const node = definition.buildViewNode({ state, key: 'k1', id: 'ctx-1', start: { location: LOCATION } })
    expect(node?.id).toBe('m1')
  })
})
