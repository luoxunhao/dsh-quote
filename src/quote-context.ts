/**
 * dsh-quote host adapter over the real dsh message model: builds one
 * plugin-sourced, model-visible context message per pending quote.
 *
 * The injected message carries the FULL selected text as its model-facing
 * content block, tagged with `source: { kind: 'plugin', plugin: 'dsh-quote',
 * form: 'notice', summary }` so the transcript renders it as a collapsed
 * plugin "notice" row while the model still reads the whole quote. A notice
 * is a one-off that supersedes nothing — matching the one-shot, use-it-once
 * semantics of a pending quote (see ADR-0001 / CONTEXT.md).
 * @module dsh-quote/quote-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage, ContentBlock } from '@deepseek-ai/dsh-llm'
import { boundContextSummary } from '@deepseek-ai/dsh-llm'

import type { PendingQuote } from './quote-store.ts'
import type { QuoteContextFactory } from './quote-fold.ts'
import { PLUGIN_NAME } from './quote-fold.ts'

/** One-line account shown on the collapsed transcript row. */
function summaryFor(text: string): string {
  return boundContextSummary(`Quoted: ${text}`)
}

/**
 * Build one plugin-sourced context UserMessage carrying the full quoted text.
 * @param quote - a pending quote.
 * @returns the immutable model-visible context message.
 */
export function buildContextUserMessage(quote: PendingQuote): UserMessage {
  const content: ContentBlock[] = [{ type: 'text', text: quote.text }]
  return createUserMessage({
    content,
    source: {
      kind: 'plugin',
      plugin: PLUGIN_NAME,
      form: 'notice',
      summary: summaryFor(quote.text),
    },
  })
}

/** A real context factory bound over {@link buildContextUserMessage}. */
export const contextMessageFactory: QuoteContextFactory<UserMessage> = {
  contextMessage(quote: PendingQuote): UserMessage {
    return buildContextUserMessage(quote)
  },
}
