/**
 * dsh-quote sent-quote presentation: how a quote that has already ridden a user
 * message is described back to the user in the composer.
 *
 * Why this module exists at all: the shipped GUI never renders an ordinary
 * injected-context row. `ui-chat`'s `isVisibleChatNode` admits a `context` node
 * to the transcript only when it carries tool additions or removals, so a quote
 * injected with source kind `quote-context` is filtered out of the visible Chat
 * nodes before any renderer — and therefore before any plugin DOM marker or CSS
 * — could see it. (The `conversation.chat.node` renderer for `context` exists
 * and is registered; it is simply never reached for our node.)
 *
 * There is consequently no transcript surface this plugin can style, and the 0.2
 * approach of marking `[data-context-source]` rows matched nothing at runtime.
 * What the plugin CAN own is the composer, where both the pending rail and this
 * sent card live. See `docs/adr/0002-quote-visibility.md`.
 * @module dsh-quote/client/sent-quotes
 */

import type { SentQuote } from './api.ts'

/** One sent quote as the composer card renders it. */
export interface SentQuoteCard {
  /** Stable id within its session. */
  readonly id: string
  /** The quoted text, verbatim. */
  readonly text: string
  /** Label for the row the quote came from. */
  readonly source: string
  /** Human-readable send time, or an empty string when unavailable. */
  readonly when: string
  /** Epoch ms the host consumed the quote, for timing the receipt's expiry. */
  readonly sentAt: number
}

/**
 * Describe one sent quote for display.
 *
 * The time is rendered through the browser's own locale machinery rather than a
 * hardcoded format, and an unreadable stamp degrades to an empty string instead
 * of throwing inside a render.
 * @param quote - a quote the host recorded as injected.
 * @param sourceLabel - label for the quote's source row.
 * @returns the display fields for one card.
 */
export function toSentQuoteCard(quote: SentQuote, sourceLabel: string): SentQuoteCard {
  return {
    id: quote.id,
    text: quote.text,
    source: sourceLabel,
    when: formatSentAt(quote.sentAt),
    sentAt: typeof quote.sentAt === 'number' && Number.isFinite(quote.sentAt) ? quote.sentAt : Date.now(),
  }
}

/**
 * Render a send time as a short local clock reading.
 * @param sentAt - epoch ms, or undefined for a record that carries none.
 * @returns the localized time, or an empty string when it cannot be read.
 */
export function formatSentAt(sentAt: number | undefined): string {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return ''
  const date = new Date(sentAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
