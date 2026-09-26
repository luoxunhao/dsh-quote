/**
 * dsh-quote host adapter over the real dsh message model: turns one pending quote
 * into one ordinary user message.
 *
 * A quote is delivered as a SEPARATE user-role message whose source kind is the
 * ordinary `user`, so the GUI renders it as a normal user bubble in the
 * transcript — the same chrome as text the user typed. That is the point: a quote
 * is something the user chose to say, and the conversation should show it.
 *
 * This replaces the earlier design (ADR-0001) that delivered quotes as a
 * plugin-sourced "injected context" message. That approach was invisible by
 * construction: the GUI filters ordinary injected-context rows out of the
 * transcript before any renderer runs, so no client-side styling could ever show
 * one (ADR-0002). See ADR-0003.
 * @module dsh-quote/quote-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage, ContentBlock } from '@deepseek-ai/dsh-llm'

import type { PendingQuote } from './quote-store.ts'
import type { QuoteContextFactory } from './quote-fold.ts'

/**
 * Build one user-role message carrying the quoted text.
 *
 * The source is the ordinary `user` kind rather than a plugin-private one: that
 * is what makes the GUI treat this as the user's own message and render a bubble
 * for it. A custom kind is classified as injected context and filtered out of the
 * transcript entirely.
 * @param quote - a pending quote.
 * @returns the immutable model-visible user message.
 */
export function buildContextUserMessage(quote: PendingQuote): UserMessage {
  const content: ContentBlock[] = [{ type: 'text', text: quote.text }]
  return createUserMessage({ content, source: { kind: 'user' } })
}

/** A real context factory bound over {@link buildContextUserMessage}. */
export const contextMessageFactory: QuoteContextFactory<UserMessage> = {
  contextMessage(quote: PendingQuote): UserMessage {
    return buildContextUserMessage(quote)
  },
}
