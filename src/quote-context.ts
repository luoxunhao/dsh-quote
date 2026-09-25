/**
 * dsh-quote host adapter over the real dsh message model: builds one
 * plugin-sourced, model-visible context message per pending quote.
 *
 * The injected message carries the FULL selected text as its model-facing
 * content block, tagged with a `quote-context` source so the transcript renders
 * it as a collapsed "notice" row while the model still reads the whole quote. A
 * notice is a one-off that supersedes nothing — matching the one-shot,
 * use-it-once semantics of a pending quote (see ADR-0001 / CONTEXT.md).
 *
 * The source `kind` is this plugin's OWN, declared by augmenting the runtime's
 * merge-extensible `MessageSourceMap`. The harness has no shared catch-all
 * `plugin` kind (a producer declares its own), and the transcript derives a
 * context row's producer label straight from `source.kind` — so the kind string
 * is both the durable attribution and the text the row header shows.
 * @module dsh-quote/quote-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage, ContentBlock } from '@deepseek-ai/dsh-llm'
import { boundContextSummary } from '@deepseek-ai/dsh-llm'

import type { PendingQuote } from './quote-store.ts'
import type { QuoteContextFactory } from './quote-fold.ts'
import { QUOTE_CONTEXT_KIND } from './source-kind.ts'

/**
 * Durable attribution for one quote the user injected into the conversation.
 *
 * A `notice` because a quote is a one-off account of something that just
 * happened: it supersedes nothing and is consumed exactly once.
 */
export interface QuoteContextSource {
  readonly kind: typeof QUOTE_CONTEXT_KIND
  /** A one-off account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of the quote, shown on the collapsed row. */
  readonly summary: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A selected passage the user injected as context via dsh-quote. */
    'quote-context': QuoteContextSource
  }
}

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
      kind: QUOTE_CONTEXT_KIND,
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
