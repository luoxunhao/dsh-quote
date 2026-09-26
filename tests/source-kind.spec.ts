/**
 * A quote must be delivered as an ordinary user message.
 *
 * Why this is a test and not a comment: the GUI renders a transcript bubble only
 * for messages whose source kind is `user`. Any other kind — including a
 * plugin-private one — is classified as injected context and filtered out of the
 * transcript before any renderer runs. A quote that is not a `user` message is
 * therefore invisible by construction, which is exactly the defect this pins
 * against (ADR-0002, ADR-0003).
 */
import { describe, expect, it } from 'vitest'

import { buildContextUserMessage } from '../src/quote-context.ts'
import { PLUGIN_NAME } from '../src/source-kind.ts'

/** A minimal pending quote, as the store hands one to the context factory. */
const QUOTE = { id: 'q1', text: '选中的一段文字' }

describe('quote delivery', () => {
  it('carries the ordinary user source kind so the GUI renders a bubble', () => {
    expect(buildContextUserMessage(QUOTE).source).toMatchObject({ kind: 'user' })
  })

  it('is a user-role message', () => {
    expect(buildContextUserMessage(QUOTE).role).toBe('user')
  })

  it('carries the quoted text verbatim as its only content', () => {
    const message = buildContextUserMessage(QUOTE)
    expect(message.content).toEqual([{ type: 'text', text: QUOTE.text }])
  })

  it('does not use a plugin-private kind, which the transcript would hide', () => {
    // The removed plugin kind and the cordis plugin name are both wrong here:
    // either one would be classified as injected context and never rendered.
    const message = buildContextUserMessage(QUOTE)
    expect(message.source.kind).not.toBe('quote-context')
    expect(message.source.kind).not.toBe(PLUGIN_NAME)
    expect(message.source.kind).toBe('user')
  })
})
