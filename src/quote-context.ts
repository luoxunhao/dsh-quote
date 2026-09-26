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
 * The `form: 'notice'` + `summary` pair mirrors how the host presents its own
 * injected-context rows: a one-line account that expands to the full text.
 * @module dsh-quote/quote-context
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage, ContentBlock } from '@deepseek-ai/dsh-llm'

import type { PendingQuote } from './quote-store.ts'
import type { QuoteContextFactory } from './quote-fold.ts'
import { QUOTE_CONTEXT_KIND } from './source-kind.ts'

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

/** Longest summary kept on the collapsed row. */
const SUMMARY_LIMIT = 80

/**
 * Build the one-line summary shown on the collapsed quote row.
 *
 * Flattens the quote to a single line and bounds it, so the row stays one line
 * high no matter how much text the user selected.
 * @param text - the quoted text, verbatim.
 * @returns a bounded single-line summary.
 */
export function quoteSummary(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= SUMMARY_LIMIT ? flat : `${flat.slice(0, SUMMARY_LIMIT - 1)}…`
}

/**
 * Build one plugin-sourced message carrying the quoted text.
 *
 * `source.kind` is this plugin's own kind — the join the client half matches on.
 * The full quote travels as message content, so the model reads the whole
 * selection while the row shows only the bounded summary.
 * @param quote - a pending quote.
 * @returns the immutable model-visible message.
 */
export function buildContextUserMessage(quote: PendingQuote): UserMessage {
  const content: ContentBlock[] = [{ type: 'text', text: quote.text }]
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
