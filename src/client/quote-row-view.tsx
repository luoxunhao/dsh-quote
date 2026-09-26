/**
 * dsh-quote visible quote row renderer: the component mounted at
 * `conversation.chat.node` under this plugin's own `quote` key.
 *
 * The visual language deliberately mirrors the host's own injected-context row —
 * a compact, collapsible line with a leading glyph, a producer label and a
 * one-line summary — so a quote reads as "something that was put into context"
 * rather than as something the user typed. That distinction is the whole point of
 * delivering the quote under a private source kind instead of impersonating a
 * user message.
 *
 * Props are read structurally: the seat hands this component the node and the
 * plugin's own injected share, and nothing here imports another `@deepseek-ai`
 * module (client purity gate).
 * @module dsh-quote/client/quote-row-view
 */

import { useState } from 'react'
import type { ReactElement } from 'react'

/** The node payload this plugin publishes for one quote. */
export interface QuoteRowNode {
  readonly data?: {
    readonly summary?: unknown
    readonly text?: unknown
  }
}

/** Props the keyed Chat seat passes to a renderer. */
export interface QuoteRowViewProps {
  readonly node?: QuoteRowNode
}

/** Quote-mark glyph, reusing the shape drawn in the composer affordances. */
function QuoteGlyph(): ReactElement {
  return (
    <svg className="dsh-quote-glyph" viewBox="0 0 16 16" width={14} height={14} fill="currentColor" aria-hidden="true">
      <path d="M2.6 9.7c0-2.6 1.6-4.8 4-5.9l.8 1.3C5.7 5.9 4.8 7.1 4.6 8.4c.2-.1.5-.2.8-.2 1.2 0 2.1.9 2.1 2.1s-1 2.1-2.2 2.1c-1.6 0-2.7-1.2-2.7-2.7Zm6.3 0c0-2.6 1.6-4.8 4-5.9l.8 1.3c-1.7.8-2.6 2-2.8 3.3.2-.1.5-.2.8-.2 1.2 0 2.1.9 2.1 2.1s-1 2.1-2.2 2.1c-1.6 0-2.7-1.2-2.7-2.7Z" />
    </svg>
  )
}

/**
 * One quote as a collapsed injected-context row that expands to the full text.
 * @param props - the Chat seat's node for this row.
 */
export function QuoteRowView(props: QuoteRowViewProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const summary = typeof props.node?.data?.summary === 'string' ? props.node.data.summary : ''
  const text = typeof props.node?.data?.text === 'string' ? props.node.data.text : ''
  if (summary === '' && text === '') return null

  return (
    <div data-dsh-quote-row="" className="dsh-quote-row">
      <button
        type="button"
        className="dsh-quote-row-head"
        data-dsh-quote-row-toggle=""
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dsh-quote-row-icon"><QuoteGlyph /></span>
        <span className="dsh-quote-row-title">引用上下文</span>
        <span className="dsh-quote-row-sep" aria-hidden="true" />
        <span className="dsh-quote-row-summary" data-dsh-quote-row-summary="">{summary}</span>
      </button>
      {open && (
        <div className="dsh-quote-row-body" data-dsh-quote-row-body="">{text}</div>
      )}
    </div>
  )
}
