/**
 * Source-kind contract: the durable `source.kind` the host stamps on an injected
 * quote, and the fact that the transcript does NOT show it.
 *
 * Why this is a test and not a comment: the harness has no shared catch-all
 * `plugin` source kind — each producer declares its own by augmenting
 * `MessageSourceMap` — so this string is the durable attribution that makes an
 * injected quote identifiable in the session log. It is deliberately NOT a
 * transcript handle. The shipped GUI hides every ordinary injected-context row
 * (`ui-chat`'s `isVisibleChatNode` admits a `context` node only when it carries
 * tool additions/removals), so a quote injected with this kind renders nowhere.
 *
 * The second half of this file pins that reasoning as an executable expectation,
 * because the 0.2 release shipped a stylesheet and a DOM marker that keyed on
 * this string and silently matched nothing.
 */
import { describe, expect, it } from 'vitest'

import { buildContextUserMessage } from '../src/quote-context.ts'
import { QUOTE_CONTEXT_KIND, PLUGIN_NAME } from '../src/source-kind.ts'

/** A minimal pending quote, as the store hands one to the context factory. */
const QUOTE = { id: 'q1', text: '选中的一段文字' }

describe('injected quote source', () => {
  it('carries the declared quote-context kind', () => {
    const message = buildContextUserMessage(QUOTE)
    expect(message.source).toMatchObject({ kind: QUOTE_CONTEXT_KIND })
  })

  it('does not use the removed catch-all plugin kind', () => {
    // The pre-0.1.7 runtime accepted `kind: 'plugin'`; 0.1.7-rc.2 declares no
    // such kind and the type rejects it at compile time. Pin the runtime value
    // too so a regression is caught even if a future type widens again.
    expect(buildContextUserMessage(QUOTE).source.kind).not.toBe('plugin')
  })

  it('is a notice carrying the model-visible quote verbatim', () => {
    const message = buildContextUserMessage(QUOTE)
    expect(message.source).toMatchObject({ form: 'notice' })
    expect(message.content).toEqual([{ type: 'text', text: QUOTE.text }])
    expect((message.source as { summary?: string }).summary).toContain(QUOTE.text)
  })

  it('distinguishes the durable source kind from the cordis plugin name', () => {
    // The GUI derives a context row's producer label from `source.kind`, never
    // from the plugin name, so the two being distinct is load-bearing: a marker
    // keyed on the plugin name would have matched no row even before the row was
    // filtered out.
    expect(QUOTE_CONTEXT_KIND).not.toBe(PLUGIN_NAME)
  })
})
