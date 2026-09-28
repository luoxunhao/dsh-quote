/**
 * dsh-quote host adapter over the real dsh message model: turns one pending quote
 * into one plugin-sourced message the client republishes as a visible quote row.
 *
 * The message carries this plugin's OWN `source.kind`. That is deliberate and is
 * what makes a visible injected row possible at all:
 *
 * - `ui-chat`'s `messageDefinition` claims every append-surface `user/message`
 *   event. A message with `source.kind === 'user'` therefore ALWAYS projects to a
 *   `user` bubble, and a plugin has no way to render it as anything else.
 * - Any other kind projects to a `context` node, which `isVisibleChatNode` hides
 *   unless it carries tool additions/removals.
 *
 * So neither DEFAULT projection can show a quote as an injected row. The client
 * half registers its own Conversation definition that matches THIS kind, claims
 * the event away from the default classification, and republishes it as a
 * `quote` node — a kind outside the visibility blacklist, rendered by this
 * plugin's own `conversation.chat.node` seat. See ADR-0004.
 *
 * The body is FRAMED rather than sent bare: a quote arrives as one message out of
 * nowhere, so without a header the model cannot tell an excerpt from an
 * instruction or know how long the passage is. The text shaping lives in the
 * zero-dependency `quote-text.ts` leaf so the composer card can bound its own
 * rendering with the same rules.
 * @module dsh-quote/quote-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage, ContentBlock } from '@deepseek-ai/dsh-llm'

import type { PendingQuote } from './quote-store.ts'
import type { QuoteContextFactory } from './quote-fold.ts'
import { QUOTE_CONTEXT_KIND } from './source-kind.ts'
import { quoteFrame, quoteSummary } from './quote-text.ts'

export { quoteSummary, quoteLineCount, quoteLimitError } from './quote-text.ts'

/**
 * Durable attribution for one quote this plugin injected into the conversation.
 *
 * A `notice` because a quote is a one-off account of something the user chose to
 * bring into context: it supersedes nothing and is consumed exactly once.
 */
export interface QuoteContextSource {
  readonly kind: typeof QUOTE_CONTEXT_KIND
  /** A one-off account shown as a single collapsed row. */
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

/**
 * Build one plugin-sourced message carrying the quoted text.
 *
 * `source.kind` is this plugin's own kind — the join the client half matches on.
 * The content is the FRAMED quote, so the model learns what the block is and
 * where it came from before reading it. The `summary` stays a separate, harder-
 * bounded field because the collapsed row shows it inside one line; deriving it
 * from the frame would put the header text on the row.
 * @param quote - a pending quote.
 * @returns the immutable model-visible message.
 */
export function buildContextUserMessage(quote: PendingQuote): UserMessage {
  const content: ContentBlock[] = [{
    type: 'text',
    text: quoteFrame({
      text: quote.text,
      ...(quote.sourceKind !== undefined ? { sourceLabel: quote.sourceKind } : {}),
      ...(quote.filePath !== undefined ? { filePath: quote.filePath } : {}),
    }),
  }]
  return createUserMessage({
    content,
    source: {
      kind: QUOTE_CONTEXT_KIND,
      form: 'notice',
      summary: quoteSummary(quote.text),
    },
  })
}

/** A real context factory bound over {@link buildContextUserMessage}. */
export const contextMessageFactory: QuoteContextFactory<UserMessage> = {
  contextMessage(quote: PendingQuote): UserMessage {
    return buildContextUserMessage(quote)
  },
}
