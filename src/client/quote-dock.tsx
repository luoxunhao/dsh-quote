/**
 * dsh-quote composer affordances: a selection-triggered 「复制文本 / 添加到对话」
 * menu plus the pending-quote rail of attachment-style cards.
 *
 * Registered into the session-scoped slot `conversation.input.overlay`, this
 * component is mounted for the whole active session, inside the composer card.
 * From it we attach DOCUMENT-level `mouseup` / `selectionchange` listeners so
 * that whenever the user finishes a text selection over a chat message row
 * (`[data-chat-flow-key]`), a compact menu appears centered above the selection.
 * 「添加到对话」queues the selected text for the session through the host HTTP
 * API; every queued quote then renders as one card in a rail pinned to the top
 * of the composer card, where the host's own attachment rail lives.
 *
 * The component never crashes on a missing prop: DOM/API/slot problems degrade
 * to a logged no-op, never a throw, so a host that composes differently simply
 * shows no affordance.
 *
 * Note the transcript is deliberately NOT touched. An earlier revision marked
 * this plugin's injected-context rows there; the GUI filters those rows out
 * before any renderer runs, so the marker matched nothing. See ADR-0002.
 * @module dsh-quote/client/quote-dock
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { ChatNodeStoreLike } from './slot-props.ts'
import { createQuoteApi, type QuoteApi, type SentQuote } from './api.ts'
import { toSentQuoteCard, type SentQuoteCard } from './sent-quotes.ts'

/** Selector over the chat snapshot we use to resolve a node key. */
type ChatNodeStore = ChatNodeStoreLike

const FLOW_KEY_ATTR = '[data-chat-flow-key]'
const COPY_LABEL = '复制文本'
const COPIED_LABEL = '已复制'
const ADD_LABEL = '添加到对话'
const REMOVE_LABEL = '移除引用'
const DISMISS_LABEL = '不再显示'
/** Shown on a quote card while the agent is mid-turn and cannot take it yet. */
const RAIL_BUSY_HINT = '回合进行中，稍后随你的消息发出'
/** Shown on a quote card that has been waiting for the user to send. */
const RAIL_WAITING_HINT = '发送后随你的消息作为上下文'
/** How long a quote must sit before the rail explains what it is waiting for. */
const RAIL_WAITING_MS = 3000
/**
 * How long the pending poll stays quiet after a send, so it cannot re-show cards
 * the user already saw disappear before the host has drained the queue.
 */
const SEND_GRACE_MS = 2500
/** Gap between the selection and the menu, and between the menu and a viewport edge. */
const MENU_OFFSET = 8
/**
 * How long a sent-quote receipt stays up before it dismisses itself.
 *
 * The receipt reports something that already happened, so it must not become
 * permanent chrome; the transcript is not going to confirm it, and the session
 * log is the durable record. Twelve seconds is long enough to read one line and
 * short enough not to sit in the composer.
 */
const RECEIPT_TTL_MS = 12_000

/** One resolved quote candidate from a selection over a chat row. */
export interface QuoteCandidate {
  /** The selected plain text (verbatim rendered text). */
  text: string
  /** The row kind the selection came from (assistant / user / tool / …). */
  sourceKind?: string
  /** The durable source message id, when the selection resolves to a finalized message. */
  sourceMessageId?: string
}

/** A viewport rectangle, as returned by `Range.getBoundingClientRect`. */
export interface ClientBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** A box size, as measured from a rendered element. */
export interface BoxSize {
  width: number
  height: number
}

/** Where the floating menu sits and which side of the selection it hangs from. */
export interface MenuPosition {
  /** Horizontal center of the menu. */
  x: number
  /** The selection edge the menu is pinned to. */
  y: number
  /** `'above'` pins the menu's bottom edge to `y`; `'below'` pins its top edge. */
  placement: 'above' | 'below'
}

/** One pending quote as the rail renders it. */
export interface RailQuote {
  /** Stable id within its session. */
  id: string
  /** The selected plain text, verbatim. */
  text: string
  /** The source row kind the selection came from, when captured. */
  sourceKind?: string
}

export interface QuoteDockProps {
  /** The current session id (ui-session merge; absent only when not composed). */
  sessionId?: string
}

/**
 * Name the chat row a quote came from, for the chip's subtitle. Unknown and
 * missing kinds fall back to the plain 「选中的文本」 label rather than leaking
 * a raw node kind into the UI.
 * @param kind - the row's `data-chat-flow-kind` value, when captured.
 */
export function sourceKindLabel(kind?: string): string {
  switch (kind) {
    case 'assistant':
    case 'assistant-step':
      return '助手消息'
    case 'user':
      return '用户消息'
    case 'reasoning':
      return '思考过程'
    case 'tool':
    case 'tool-call':
    case 'tool-result':
      return '工具输出'
    default:
      return '选中的文本'
  }
}

/**
 * Place the selection menu: centered on the selection's horizontal midpoint,
 * above it when there is room and below it otherwise, clamped so a measured
 * menu never leaves the viewport.
 * @param box - the selection's viewport rect.
 * @param size - the menu's measured size; zero before the first measurement.
 * @param viewport - the window's inner size.
 */
export function menuPosition(box: ClientBox, size: BoxSize, viewport: BoxSize): MenuPosition {
  const center = (box.left + box.right) / 2
  const halfWidth = size.width / 2
  const min = MENU_OFFSET + halfWidth
  const max = viewport.width - MENU_OFFSET - halfWidth
  const x = max < min ? viewport.width / 2 : Math.min(Math.max(center, min), max)
  const aboveY = box.top - MENU_OFFSET
  return aboveY - size.height < MENU_OFFSET
    ? { x, y: box.bottom + MENU_OFFSET, placement: 'below' }
    : { x, y: aboveY, placement: 'above' }
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

/** The viewport rect covering the current selection, or undefined when collapsed. */
export function selectionClientBox(): ClientBox | undefined {
  const selection = window.getSelection?.()
  if (selection == null || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return undefined
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** A component-safe window selection read. */
function currentSelection(): { text: string; anchorNode: Node | null } {
  const selection = window.getSelection?.()
  if (selection == null || selection.rangeCount === 0) return { text: '', anchorNode: null }
  const anchor = selection.anchorNode
  return { text: selection.toString(), anchorNode: anchor instanceof Node ? anchor : null }
}

/** `ic_ds_copy_outline_16`-shaped copy glyph, drawn locally (see the purity gate). */
function CopyGlyph(): ReactElement {
  return (
    <svg className="dsh-quote-glyph" viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden="true">
      <rect x="5.6" y="5.6" width="8" height="8" rx="2" />
      <path d="M10.6 3.6H4.4a1.9 1.9 0 0 0-1.9 1.9v6.1" strokeLinecap="round" />
    </svg>
  )
}

/** Quote-mark glyph marking a selection as a quote. */
function QuoteGlyph(): ReactElement {
  return (
    <svg className="dsh-quote-glyph" viewBox="0 0 16 16" width={14} height={14} fill="currentColor" aria-hidden="true">
      <path d="M2.6 9.7c0-2.6 1.6-4.8 4-5.9l.8 1.3C5.7 5.9 4.8 7.1 4.6 8.4c.2-.1.5-.2.8-.2 1.2 0 2.1.9 2.1 2.1s-1 2.1-2.2 2.1c-1.6 0-2.7-1.2-2.7-2.7Zm6.3 0c0-2.6 1.6-4.8 4-5.9l.8 1.3c-1.7.8-2.6 2-2.8 3.3.2-.1.5-.2.8-.2 1.2 0 2.1.9 2.1 2.1s-1 2.1-2.2 2.1c-1.6 0-2.7-1.2-2.7-2.7Z" />
    </svg>
  )
}

/**
 * The pending-quote rail: one attachment-style card per queued quote, each
 * showing the verbatim quote (CSS-ellipsized) over its source-row label, with a
 * removal control. Renders nothing when the session has no pending quote.
 *
 * A pending quote rides the next turn that claims a fresh user message. When the
 * agent is mid-turn (a long tool loop, a stuck step) that turn has not started
 * yet, and the queue correctly keeps the quote. From the outside that is
 * indistinguishable from a stall, so once a card has waited past
 * {@link RAIL_WAITING_MS} the rail says so instead of silently sitting there.
 * @param props - the session's pending quotes, their removal handler, and whether
 * a turn is currently running.
 */
export function QuoteRail(props: {
  quotes: readonly RailQuote[]
  onRemove: (quoteId: string) => void
  /** Whether the agent is currently mid-turn (so the quote cannot ride yet). */
  busy?: boolean
}): ReactElement | null {
  const { quotes, onRemove, busy = false } = props
  const [waited, setWaited] = useState(false)
  const firstId = quotes[0]?.id

  // A quote that arrives while the agent is busy is waiting by definition; one
  // that is still here after the settle window is waiting for the user.
  useEffect(() => {
    if (firstId === undefined || busy) { setWaited(false); return undefined }
    const timer = window.setTimeout(() => setWaited(true), RAIL_WAITING_MS)
    return () => window.clearTimeout(timer)
  }, [firstId, busy])

  if (quotes.length === 0) return null
  const hint = busy ? RAIL_BUSY_HINT : (waited ? RAIL_WAITING_HINT : null)
  return (
    <div data-dsh-quote-rail="" className="dsh-quote-rail" role="list">
      {quotes.map((quote) => (
        <div key={quote.id} data-quote-id={quote.id} className="dsh-quote-card" role="listitem" title={quote.text}>
          <span className="dsh-quote-card-icon"><QuoteGlyph /></span>
          <span className="dsh-quote-card-body">
            <span className="dsh-quote-card-title">{quote.text}</span>
            <span className="dsh-quote-card-sub">{hint ?? sourceKindLabel(quote.sourceKind)}</span>
          </span>
          <button
            type="button"
            className="dsh-quote-card-remove"
            data-quote-remove={quote.id}
            aria-label={REMOVE_LABEL}
            onClick={() => onRemove(quote.id)}
          >×</button>
        </div>
      ))}
    </div>
  )
}

/**
 * The sent-quote receipt: a short-lived acknowledgement that the quotes the user
 * staged actually rode their last message as injected context.
 *
 * This is the replacement for the transcript card the plugin cannot have. The
 * GUI hides ordinary injected-context rows before any renderer sees them
 * (ADR-0002), so without this the user's only evidence would be the model
 * happening to mention the quote. Renders nothing when no quote was just sent.
 * @param props - the recently injected quotes and their dismissal handler.
 */
export function SentReceipt(props: {
  quotes: readonly SentQuoteCard[]
  onDismiss: (quoteId: string) => void
}): ReactElement | null {
  const { quotes, onDismiss } = props
  if (quotes.length === 0) return null
  return (
    <div data-dsh-quote-receipt="" className="dsh-quote-receipt" role="list">
      {quotes.map(quote => (
        <div key={quote.id} data-quote-id={quote.id} className="dsh-quote-receipt-card" role="listitem" title={quote.text}>
          <span className="dsh-quote-receipt-icon"><QuoteGlyph /></span>
          <span className="dsh-quote-receipt-body">
            <span className="dsh-quote-receipt-title">{quote.text}</span>
            <span className="dsh-quote-receipt-sub">
              {quote.source}
              {quote.when === '' ? '' : ` · ${quote.when}`}
            </span>
          </span>
          <button
            type="button"
            className="dsh-quote-receipt-close"
            data-quote-dismiss={quote.id}
            aria-label={DISMISS_LABEL}
            onClick={() => onDismiss(quote.id)}
          >×</button>
        </div>
      ))}
    </div>
  )
}

/**
 * The composer overlay entry: hosts the selection listeners, the
 * 「复制文本 / 添加到对话」menu, and the pending-quote rail for this session.
 *
 * Deliberately does NOT read `useChat`/other standard props: like sibling overlay
 * entries it is behavior-only over the DOM, so a host that composes different
 * standard props still works. The quote carries the verbatim selected text and
 * its row kind; the durable messageId is a nice-to-have we forgo to stay
 * dependency-free.
 * @param props - session standard props; only `sessionId` is read.
 */
export function QuoteDock(props: QuoteDockProps): ReactElement | null {
  const sessionId = (props as { sessionId?: string }).sessionId
  const [offer, setOffer] = useState<{ box: ClientBox; candidate: QuoteCandidate } | null>(null)
  const [menuSize, setMenuSize] = useState<BoxSize>({ width: 0, height: 0 })
  const [copied, setCopied] = useState(false)
  const [pending, setPending] = useState<readonly RailQuote[]>([])
  const [sent, setSent] = useState<readonly SentQuoteCard[]>([])
  const [busy, setBusy] = useState(false)
  /** Until this epoch ms, the pending poll must not overwrite the optimistic clear. */
  const suppressPollUntil = useRef(0)
  const api: QuoteApi = createQuoteApi()

  /** Measure the rendered menu so placement can clamp against its real width. */
  const measureMenu = useCallback((node: HTMLDivElement | null): void => {
    if (node === null) return
    const width = node.offsetWidth
    const height = node.offsetHeight
    setMenuSize((current) => (current.width === width && current.height === height
      ? current
      : { width, height }))
  }, [])

  /** Refresh the session's pending quotes. */
  const refreshPending = (sid: string | undefined): void => {
    if (sid === undefined) return
    // A send cleared the rail optimistically; do not undo that until the host has
    // had its chance to drain the queue.
    if (Date.now() < suppressPollUntil.current) return
    api.list(sid).then(
      (list) => setPending(list),
      (error) => console.warn('[dsh-quote] list pending failed:', error),
    )
  }

  /** Refresh the receipt for quotes the host has already injected. */
  const refreshSent = (sid: string | undefined): void => {
    if (sid === undefined) return
    api.sent(sid).then(
      (list: readonly SentQuote[]) => setSent(list.map(quote => toSentQuoteCard(quote, sourceKindLabel(quote.sourceKind)))),
      (error) => console.warn('[dsh-quote] list sent failed:', error),
    )
  }

  /** Stop showing one receipt (it expired, or the user closed it). */
  const dismissSent = (quoteId: string): void => {
    if (sessionId === undefined) return
    setSent(current => current.filter(card => card.id !== quoteId))
    api.dismissSent(sessionId, quoteId).then(
      () => undefined,
      (error) => console.warn('[dsh-quote] dismiss sent failed:', error),
    )
  }

  /**
   * Drop the staged cards as soon as the user sends, and tell the host they now
   * belong to the message being sent.
   *
   * Claiming on the host is what makes this stick. Hiding alone was not enough: a
   * send made while the agent is busy starts no turn, so the quote stays pending
   * — correctly — until the queued message is finally picked up, and the poll
   * would show the card again for as long as the agent kept working. The user had
   * already sent it, so it must not come back.
   *
   * The host keeps the quote so the fold can still inject it; `staged` simply
   * stops reporting claimed quotes to the composer.
   */
  const clearStagedOnSend = (): void => {
    setPending((current) => (current.length === 0 ? current : []))
    suppressPollUntil.current = Date.now() + SEND_GRACE_MS
    if (sessionId === undefined) return
    api.claim(sessionId).then(
      () => undefined,
      (error) => console.warn('[dsh-quote] claim on send failed:', error),
    )
  }

  // Keep the rail in sync with the host queue (host fold consumes quotes on
  // send; no push channel exists, so a light poll clears it shortly after).
  useEffect(() => {
    if (sessionId === undefined) return undefined
    refreshPending(sessionId)
    refreshSent(sessionId)
    const timer = window.setInterval(() => refreshPending(sessionId), 2000)
    return () => window.clearInterval(timer)
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Offer the menu once a selection over a chat row is finished. `selectionchange`
  // fires throughout the drag, so it only ever dismisses; the menu appears on
  // mouseup and disappears as soon as the selection or the view moves.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const dismiss = (): void => setOffer(null)
    const maybeOffer = (): void => {
      try {
        const { text, anchorNode } = currentSelection()
        const candidate = quoteFromSelection(text, anchorNode)
        const box = selectionClientBox()
        if (candidate === undefined || box === undefined) { dismiss(); return }
        setCopied(false)
        setOffer({ box, candidate })
      } catch {
        dismiss()
      }
    }
    document.addEventListener('mouseup', maybeOffer)
    document.addEventListener('selectionchange', dismiss)
    document.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('mouseup', maybeOffer)
      document.removeEventListener('selectionchange', dismiss)
      document.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  // Hide the staged cards the moment the user sends, and track whether a turn is
  // running so the rail can explain a quote that has to wait.
  //
  // Detecting the send itself, not a turn transition: watching only for an
  // idle→running edge missed every send made while the agent was already
  // thinking, which is precisely when a staged card is most likely to be sitting
  // there. The reliable, host-owned signal is the draft: pressing Enter submits
  // the composer and empties its editable region, whether or not a turn was
  // already in flight. This is read-only DOM observation; the composer's submit
  // handler belongs to the host and is not reachable from a client plugin
  // (client purity gate).
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const readRunning = (): boolean =>
      document.querySelector('[aria-label*="停止"], [data-turn-running]') !== null
    const readDraft = (): string => {
      const editor = document.querySelector('[contenteditable="true"][data-composer-input]')
      return editor?.textContent ?? ''
    }

    let running = readRunning()
    let draft = readDraft()
    setBusy(running)

    const observer = new MutationObserver(() => {
      const nextRunning = readRunning()
      if (nextRunning !== running) {
        running = nextRunning
        setBusy(nextRunning)
      }
      const nextDraft = readDraft()
      if (nextDraft === draft) return
      const hadText = draft.trim() !== ''
      draft = nextDraft
      // An emptied draft after real content is a submission. Clearing on this
      // edge covers sends made mid-turn, which the turn-state edge cannot see.
      if (hadText && nextDraft.trim() === '') clearStagedOnSend()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll the host for what it has already injected. The pending rail clears
  // when the fold drains the queue, and the receipt that replaces it tells the
  // user their quote actually rode the message — the transcript will not, since
  // the GUI hides ordinary injected-context rows entirely (ADR-0002).
  useEffect(() => {
    if (sessionId === undefined) return undefined
    const timer = window.setInterval(() => refreshSent(sessionId), 2000)
    return () => window.clearInterval(timer)
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Retire a receipt that has been up long enough to read.
  useEffect(() => {
    if (sent.length === 0) return undefined
    const oldest = sent[0]
    if (oldest === undefined) return undefined
    const remaining = oldest.sentAt + RECEIPT_TTL_MS - Date.now()
    const timer = window.setTimeout(() => { dismissSent(oldest.id) }, Math.max(remaining, 0))
    return () => window.clearTimeout(timer)
  }, [sent]) // eslint-disable-line react-hooks/exhaustive-deps

  const addQuote = (candidate: QuoteCandidate): void => {
    setOffer(null)
    window.getSelection?.()?.removeAllRanges()
    if (sessionId === undefined) {
      console.warn('[dsh-quote] no session id; cannot queue quote')
      return
    }
    api.add(sessionId, candidate).then(
      () => refreshPending(sessionId),
      (error) => console.warn('[dsh-quote] queue quote failed:', error),
    )
  }

  const copyQuote = (candidate: QuoteCandidate): void => {
    navigator.clipboard?.writeText(candidate.text).then(
      () => setCopied(true),
      (error) => console.warn('[dsh-quote] copy failed:', error),
    )
  }

  // Hold the menu open long enough to show the copy landed, then dismiss it.
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => { setCopied(false); setOffer(null) }, 900)
    return () => window.clearTimeout(timer)
  }, [copied])

  const removeQuote = (quoteId: string): void => {
    if (sessionId === undefined) return
    api.remove(sessionId, quoteId).then(
      () => refreshPending(sessionId),
      (error) => console.warn('[dsh-quote] remove quote failed:', error),
    )
  }

  const position = offer === null
    ? undefined
    : menuPosition(offer.box, menuSize, { width: window.innerWidth, height: window.innerHeight })

  return (
    <>
      {offer !== null && position !== undefined && (
        <div
          ref={measureMenu}
          data-dsh-quote-offer=""
          data-placement={position.placement}
          className="dsh-quote-offer"
          style={{ position: 'fixed', left: position.x, top: position.y, zIndex: 9999 }}
        >
          <button
            type="button"
            className="dsh-quote-offer-item"
            onClick={() => copyQuote(offer.candidate)}
            onMouseDown={(event) => event.preventDefault()}
          >
            <CopyGlyph />
            {copied ? COPIED_LABEL : COPY_LABEL}
          </button>
          <span className="dsh-quote-offer-sep" aria-hidden="true" />
          <button
            type="button"
            className="dsh-quote-offer-item"
            onClick={() => addQuote(offer.candidate)}
            onMouseDown={(event) => event.preventDefault()}
          >
            <QuoteGlyph />
            {ADD_LABEL}
          </button>
        </div>
      )}
      <QuoteRail quotes={pending} onRemove={removeQuote} busy={busy} />
      <SentReceipt quotes={sent} onDismiss={dismissSent} />
    </>
  )
}
