/**
 * dsh-quote composer-dock entry: a selection-triggered 「添加到对话」popover.
 *
 * Registered into the session-scoped slot `conversation.composer.dock`, this
 * component is mounted for the whole active session. From it we attach
 * DOCUMENT-level `selectionchange` / `mouseup` listeners so that whenever the
 * user makes a text selection over a chat message row (`[data-chat-flow-key]`),
 * a small floating 「添加到对话」button appears anchored at the selection's end.
 * Clicking it silently queues the selected text for the session via the host
 * HTTP API; while the session has pending quotes a quiet, removable indicator
 * strip also renders below the composer.
 *
 * The component never crashes on a missing prop: DOM/API/slot problems degrade
 * to a logged no-op, never a throw, so a host that composes differently simply
 * shows no affordance.
 * @module dsh-quote/client/quote-dock
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { ChatNodeStoreLike } from './slot-props.ts'
import { createQuoteApi, type QuoteApi } from './api.ts'

/** Selector over the chat snapshot we use to resolve a node key. */
type ChatNodeStore = ChatNodeStoreLike

const FLOW_KEY_ATTR = '[data-chat-flow-key]'
const BUTTON_LABEL = '添加到对话'

/** One resolved quote candidate from a selection over a chat row. */
export interface QuoteCandidate {
  /** The selected plain text (verbatim rendered text). */
  text: string
  /** The row kind the selection came from (assistant / user / tool / …). */
  sourceKind?: string
  /** The durable source message id, when the row resolves to a finalized message. */
  sourceMessageId?: string
}

/** Where the floating button should sit: viewport coords of the selection end. */
export interface PopoverAnchor {
  x: number
  y: number
}

export interface QuoteDockProps {
  /** The current session id (ui-session merge; absent only when not composed). */
  sessionId?: string
}

/**
 * Resolve a text selection over a chat row into a quote candidate: the selected
 * text plus, when resolvable, its row kind and finalized message id. Returns
 * undefined when the selection is empty or its anchor is not inside a chat flow
 * row (`[data-chat-flow-key]`).
 *
 * The selection is read from the live `window` selection (rendered text, verbatim
 * — per ADR-0001 we ingest what the user sees, not reconstructed markdown).
 * @param selectionText - the current window selection text.
 * @param anchorNode - the selection's anchor Node (an Element ancestor is walked).
 * @param nodes - the chat node store (`useChat((s) => s.nodes)`), optional.
 */
export function quoteFromSelection(
  selectionText: string,
  anchorNode: Node | null,
  nodes?: ChatNodeStore,
): QuoteCandidate | undefined {
  const text = selectionText.trim()
  if (text === '') return undefined
  if (!(anchorNode instanceof Node)) return undefined
  const row = anchorNode.parentElement?.closest(FLOW_KEY_ATTR) ?? (
    anchorNode instanceof Element ? anchorNode.closest(FLOW_KEY_ATTR) : null
  )
  if (!(row instanceof HTMLElement)) return undefined
  const key = row.dataset.chatFlowKey
  const kind = row.dataset.chatFlowKind
  const candidate: QuoteCandidate = { text }
  if (kind !== undefined && kind !== '') candidate.sourceKind = kind
  if (nodes !== undefined && key !== undefined) {
    const node = nodes.get(key) as
      | { data?: { status?: string; finalNode?: { messageId?: string } } }
      | undefined
    const messageId = node?.data?.finalNode?.messageId
    if (messageId !== undefined) candidate.sourceMessageId = messageId
  }
  return candidate
}

/** The viewport rect at the END of the current selection (for anchoring the button). */
export function selectionAnchorRect(): PopoverAnchor | undefined {
  const selection = window.getSelection?.()
  if (selection == null || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(selection.rangeCount - 1).cloneRange()
  range.collapse(false) // collapse to the selection END (caret after the selected text)
  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    // Fallback: no usable rect from the collapsed range; use the selection text rect.
    const all = selection.getRangeAt(0).getBoundingClientRect()
    return { x: all.right, y: all.bottom }
  }
  return { x: rect.left, y: rect.bottom }
}

/** A component-safe window selection read. */
function currentSelection(): { text: string; anchorNode: Node | null } {
  const selection = window.getSelection?.()
  if (selection == null || selection.rangeCount === 0) return { text: '', anchorNode: null }
  const anchor = selection.anchorNode
  return { text: selection.toString(), anchorNode: anchor instanceof Node ? anchor : null }
}

/**
 * The composer.dock entry: hosts the selection listeners, the floating
 * 「添加到对话」button, and the pending-quote indicator strip for this session.
 *
 * Deliberately does NOT read `useChat`/other standard props: like sibling dock
 * entries it is behavior-only over the DOM, so a host that composes different
 * standard props still works. The quote carries the verbatim selected text and
 * its row kind; the durable messageId is a nice-to-have we forgo to stay
 * dependency-free.
 * @param props - session standard props; only `sessionId` is read.
 */
export function QuoteDock(props: QuoteDockProps): ReactElement | null {
  const sessionId = (props as { sessionId?: string }).sessionId
  const [offer, setOffer] = useState<{ anchor: PopoverAnchor; candidate: QuoteCandidate } | null>(null)
  const [pending, setPending] = useState<readonly { id: string; text: string }[]>([])
  const api = createQuoteApi()

  /** Refresh the session's pending quotes. */
  const refreshPending = (sid: string | undefined): void => {
    if (sid === undefined) return
    api.list(sid).then(
      (list) => setPending(list),
      (error) => console.warn('[dsh-quote] list pending failed:', error),
    )
  }

  // Keep the pending indicator in sync with the host queue (host fold consumes
  // quotes on send; no push channel exists, so a light poll clears it shortly after).
  useEffect(() => {
    if (sessionId === undefined) return undefined
    refreshPending(sessionId)
    const timer = window.setInterval(() => refreshPending(sessionId), 2000)
    return () => window.clearInterval(timer)
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Offer the 「添加到对话」button when a text selection is made over a chat row.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const maybeOffer = (): void => {
      try {
        const { text, anchorNode } = currentSelection()
        const candidate = quoteFromSelection(text, anchorNode)
        const anchor = selectionAnchorRect()
        if (candidate === undefined || anchor === undefined) { setOffer(null); return }
        setOffer({ anchor, candidate })
      } catch {
        setOffer(null)
      }
    }
    document.addEventListener('mouseup', maybeOffer)
    document.addEventListener('selectionchange', maybeOffer)
    document.addEventListener('scroll', () => setOffer(null), true)
    return () => {
      document.removeEventListener('mouseup', maybeOffer)
      document.removeEventListener('selectionchange', maybeOffer)
      document.removeEventListener('scroll', () => setOffer(null), true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const addQuote = (candidate: QuoteCandidate): void => {
    setOffer(null)
    if (sessionId === undefined) {
      console.warn('[dsh-quote] no session id; cannot queue quote')
      return
    }
    api.add(sessionId, candidate).then(
      () => refreshPending(sessionId),
      (error) => console.warn('[dsh-quote] queue quote failed:', error),
    )
  }

  const removeQuote = (quoteId: string): void => {
    if (sessionId === undefined) return
    api.remove(sessionId, quoteId).then(
      () => refreshPending(sessionId),
      (error) => console.warn('[dsh-quote] remove quote failed:', error),
    )
  }

  return (
    <>
      {offer !== null && (
        <div
          data-dsh-quote-offer=""
          className="dsh-quote-offer"
          style={{ position: 'fixed', left: offer.anchor.x, top: offer.anchor.y, zIndex: 9999 }}
        >
          <button
            type="button"
            className="dsh-quote-offer-button"
            onClick={() => addQuote(offer.candidate)}
            onMouseDown={(event) => event.preventDefault()}
          >
            {BUTTON_LABEL}
          </button>
        </div>
      )}
      {pending.length > 0 && (
        <div data-dsh-quote-pending="" className="dsh-quote-pending">
          <span className="dsh-quote-pending-label">待生效引用 ({pending.length})</span>
          {pending.map((quote) => (
            <span key={quote.id} className="dsh-quote-pending-item">
              <span className="dsh-quote-pending-text" title={quote.text}>{truncate(quote.text, 40)}</span>
              <button
                type="button"
                aria-label="移除引用"
                onClick={() => removeQuote(quote.id)}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}
