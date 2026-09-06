/**
 * dsh-quote composer-dock entry: the whole client affordance.
 *
 * Registered into the session-scoped slot `conversation.composer.dock`, this
 * component is mounted for the whole active session (independent of which
 * conversation view is shown). From it we attach a DOCUMENT-level `contextmenu`
 * capture listener so a right-click over the rendered chat transcript (which
 * lives outside the composer dock) is still observed. On a non-empty text
 * selection whose target is inside an assistant message row
 * (`[data-chat-flow-key]`), we resolve the assistant node through `useChat`
 * and, if the user picks 「引用到对话」, silently queue the selection for its
 * session via the host HTTP API. While the session has pending quotes we also
 * render a quiet, removable indicator strip.
 *
 * Failure policy: DOM/API problems are logged, never thrown — a plugin must
 * not take the GUI down.
 * @module dsh-quote/client/quote-dock
 */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { SessionStandardProps, GlobalStandardProps, ChatNodeStoreLike, ChatSnapshotLike } from './slot-props.ts'
import { createQuoteApi, type QuoteApi } from './api.ts'

/** Selector over the chat snapshot we use to resolve a node key. */
type ChatNodeStore = ChatNodeStoreLike

const FLOW_KEY_ATTR = '[data-chat-flow-key]'
const MENU_LABEL = '引用到对话'

/** One resolved quote candidate from a selection over a chat row. */
export interface QuoteCandidate {
  /** The selected plain text (verbatim rendered text). */
  text: string
  /** The row kind the selection came from (assistant / user / tool / …). */
  sourceKind?: string
  /** The durable source message id, when the row resolves to a finalized message. */
  sourceMessageId?: string
}

export interface QuoteDockProps extends SessionStandardProps, GlobalStandardProps {
  /** The current session id (ui-session merge). */
  sessionId?: string
}

/**
 * Resolve a right-click over a selectable chat row into a quote candidate: the
 * non-empty selection text plus, when available, the row's source kind and its
 * finalized message id. Any text-bearing chat row may be quoted (assistant /
 * user / tool output — per the agreed "任意文字块" scope); the source message
 * id is only resolvable for settled assistant rows, whose node carries
 * `data.finalNode.messageId`.
 *
 * Returns undefined when the selection is empty or the target is not inside a
 * chat flow row (`[data-chat-flow-key]`).
 * @param selectionText - the current window selection text.
 * @param target - the contextmenu event target (an Element).
 * @param nodes - the chat node store (`useChat((s) => s.nodes)`).
 */
export function quoteFromChatRow(
  selectionText: string,
  target: Element | null,
  nodes: ChatNodeStore,
): QuoteCandidate | undefined {
  const text = selectionText.trim()
  if (text === '') return undefined
  const row = target?.closest(FLOW_KEY_ATTR)
  if (!(row instanceof HTMLElement)) return undefined
  const key = row.dataset.chatFlowKey
  if (key === undefined) return undefined
  const kind = row.dataset.chatFlowKind
  const node = nodes.get(key) as
    | { data?: { status?: string; finalNode?: { messageId?: string } } }
    | undefined
  const candidate: QuoteCandidate = { text }
  if (kind !== undefined && kind !== '') candidate.sourceKind = kind
  const messageId = node?.data?.finalNode?.messageId
  if (messageId !== undefined) candidate.sourceMessageId = messageId
  return candidate
}

/** A component-safe window selection read. */
function currentSelection(): string {
  const selection = window.getSelection?.()
  return selection ? selection.toString() : ''
}

/**
 * The composer.dock entry: hosts the document-level context-menu listener, the
 * 「引用到对话」menu, and the pending-quote indicator strip for this session.
 * @param props - session standard props (useChat) + the current session id.
 */
export function QuoteDock(props: QuoteDockProps): ReactElement | null {
  const { useChat, sessionId } = props
  const [menu, setMenu] = useState<{ x: number; y: number; candidate: QuoteCandidate } | null>(null)
  const [pending, setPending] = useState<readonly { id: string; text: string }[]>([])
  const api = createQuoteApi()
  const nodes = useChat((s: ChatSnapshotLike) => s.nodes)

  /** Refresh the session's pending quotes (only when there is a live session). */
  const refreshPending = (sid: string | undefined, client: QuoteApi): void => {
    if (sid === undefined) return
    client.list(sid).then(
      (list) => setPending(list),
      (error) => console.warn('[dsh-quote] list pending failed:', error),
    )
  }

  // Keep the pending indicator in sync with the host queue. There is no push
  // channel from host to this dock, so a light poll (only while mounted and only
  // when there is a live session) both seeds the strip on mount and clears it
  // shortly after a real send makes the host fold consume the quotes.
  useEffect(() => {
    if (sessionId === undefined) return undefined
    refreshPending(sessionId, api)
    const timer = window.setInterval(() => refreshPending(sessionId, api), 2000)
    return () => window.clearInterval(timer)
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (document === undefined) return
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const candidate = quoteFromChatRow(currentSelection(), target, nodes)
      if (candidate === undefined) return
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY, candidate })
    }
    const onClose = (): void => setMenu(null)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('click', onClose)
    document.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('click', onClose)
      document.removeEventListener('scroll', onClose, true)
    }
  }, [nodes, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const addQuote = (candidate: QuoteCandidate): void => {
    setMenu(null)
    if (sessionId === undefined) {
      console.warn('[dsh-quote] no session id; cannot queue quote')
      return
    }
    api.add(sessionId, candidate).then(
      () => refreshPending(sessionId, api),
      (error) => console.warn('[dsh-quote] queue quote failed:', error),
    )
  }

  const removeQuote = (quoteId: string): void => {
    if (sessionId === undefined) return
    api.remove(sessionId, quoteId).then(
      () => refreshPending(sessionId, api),
      (error) => console.warn('[dsh-quote] remove quote failed:', error),
    )
  }

  return (
    <>
      {menu !== null && (
        <div
          data-dsh-quote-menu=""
          role="menu"
          className="dsh-quote-menu"
          style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
          onClick={(event) => { event.stopPropagation() }}
        >
          <button type="button" role="menuitem" onClick={() => addQuote(menu.candidate)}>
            {MENU_LABEL}
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
