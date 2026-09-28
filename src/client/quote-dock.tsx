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
 * The transcript is NOT touched from here, and it does not need to be: a quote
 * is delivered to the host as an ordinary user-role message, so the GUI renders
 * it as a normal user bubble on its own (see ADR-0003). This module owns only
 * the two composer affordances — the selection menu and the staged-quote rail.
 * @module dsh-quote/client/quote-dock
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

import type { ChatNodeStoreLike } from './slot-props.ts'
import { createQuoteApi, type QuoteApi } from './api.ts'

/** Selector over the chat snapshot we use to resolve a node key. */
type ChatNodeStore = ChatNodeStoreLike

const FLOW_KEY_ATTR = '[data-chat-flow-key]'
const COPY_LABEL = '复制文本'
const COPIED_LABEL = '已复制'
const ADD_LABEL = '添加到对话'
const REMOVE_LABEL = '移除引用'
/** Shown on a quote card that has been waiting for the user to send. */
const RAIL_WAITING_HINT = '发送后随你的消息作为上下文'
/** How long a quote must sit before the rail explains what it is waiting for. */
const RAIL_WAITING_MS = 3000
/** Gap between the selection and the menu, and between the menu and a viewport edge. */
const MENU_OFFSET = 8

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
 * @param props - the session's staged quotes and their removal handler.
 */
export function QuoteRail(props: {
  quotes: readonly RailQuote[]
  onRemove: (quoteId: string) => void
}): ReactElement | null {
  const { quotes, onRemove } = props
  const [waited, setWaited] = useState(false)
  const firstId = quotes[0]?.id

  // A card still here after the settle window is waiting for the user to send.
  // There is no "agent is busy" state to show: the composer gives a plugin no
  // running-turn affordance, so any such indicator would be a guess.
  useEffect(() => {
    if (firstId === undefined) { setWaited(false); return undefined }
    const timer = window.setTimeout(() => setWaited(true), RAIL_WAITING_MS)
    return () => window.clearTimeout(timer)
  }, [firstId])

  if (quotes.length === 0) return null
  const hint = waited ? RAIL_WAITING_HINT : null
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
 * Whether a keyboard event is a composer SUBMIT rather than an insertion.
 *
 * This exists because the previous "the draft went empty" heuristic could not
 * tell a submit from the user deleting their own draft, and the difference
 * matters: misreading a deletion as a send hid a quote that was still pending and
 * about to be injected on the next real message.
 *
 * Shift+Enter inserts a newline; Alt/Ctrl/Meta+Enter are bound to other actions
 * by the composer; `isComposing` marks an IME confirmation, which also reports
 * Enter but is still text entry.
 * @param event - the keydown event to classify.
 */
export function isSubmitKeyEvent(event: {
  key?: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
}): boolean {
  return event.key === 'Enter'
    && event.shiftKey !== true
    && event.altKey !== true
    && event.ctrlKey !== true
    && event.metaKey !== true
    && event.isComposing !== true
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
  /**
   * The live session id, readable from effects that must not re-subscribe.
   *
   * `sessionId` arrives as a property and can be absent on the first render, but
   * the document-level submit detector installs once and would otherwise close
   * over whatever value that first render saw — leaving `api.claim` permanently
   * skipped.
   */
  const sessionIdRef = useRef<string | undefined>(sessionId)
  sessionIdRef.current = sessionId
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

  /**
   * Refresh the session's staged quotes from the host.
   *
   * The host is the SOLE authority on what is still staged: it reports a quote
   * only until its own `claim` fires on a real inbox insert. The client keeps no
   * local record of "already submitted" ids — that record was what turned a
   * misread draft-clear into a permanently hidden quote.
   */
  const refreshPending = (sid: string | undefined): void => {
    if (sid === undefined) return
    api.list(sid).then(
      (list) => setPending(current => (
        list.length === current.length
          && list.every((quote, index) => quote.id === current[index]?.id)
          ? current
          : list
      )),
      (error) => console.warn('[dsh-quote] list pending failed:', error),
    )
  }

  /**
   * Ask the host to mark the session's staged quotes as submitted.
   *
   * Called when the composer reports a SUBMIT, which is the only local signal
   * available. It is deliberately NOT the authority on what was sent: the host
   * decides that itself on `agent/inbox/inserted`, and this call only makes the
   * composer's own view agree a little sooner. A call that should not have
   * happened is therefore self-correcting — the host simply has nothing to claim.
   *
   * The card is NOT cleared here. Clearing is driven by the host's reply (see
   * `refreshPending`), because a client-side guess cannot tell a submit from a
   * deletion and getting it wrong hides a quote that is still going to be sent.
   */
  const claimStaged = (): void => {
    // Read the live id: this runs from a long-lived effect whose closure would
    // otherwise hold the (possibly absent) session id of the first render.
    const sid = sessionIdRef.current
    if (sid === undefined) return
    api.claim(sid).then(
      () => refreshPending(sid),
      (error) => console.warn('[dsh-quote] claim on send failed:', error),
    )
  }

  // Keep the rail in sync with the host queue (host fold consumes quotes on
  // send; no push channel exists, so a light poll clears it shortly after).
  useEffect(() => {
    if (sessionId === undefined) return undefined
    refreshPending(sessionId)
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

  // Ask the host to claim the staged quotes when the user submits.
  //
  // A SUBMIT is inferred from the keystroke that causes it, not from the draft
  // merely going empty. The earlier revision watched only "draft had text, draft
  // is now empty", which cannot tell a submit from the user DELETING their own
  // draft — both empty the editor. A deletion was therefore read as a send, and
  // because that path also recorded the quote ids as submitted, the card vanished
  // for good while the host still held the quote and injected it on the next real
  // message. The user saw no card and had no way to know a quote was still
  // pending. Pinning the trigger to Enter (and the send button) removes the
  // ambiguity at its source.
  //
  // This is still only a hint: `claim` is idempotent and the host owns the real
  // decision on `agent/inbox/inserted`. A spurious call finds nothing to claim,
  // and a missed one is corrected by the host's own claim.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    /** Whether a keyboard event is a composer submit rather than an insertion. */
    const isSubmitKey = (event: KeyboardEvent): boolean => isSubmitKeyEvent({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      isComposing: event.isComposing,
    })

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isSubmitKey(event)) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[contenteditable="true"][data-composer-input]') === null) return
      claimStaged()
    }

    // The send button submits without a key event. Detected by its own control
    // rather than by the draft emptying, for the same reason as above.
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest('button')
      if (button === null) return
      if (button.closest('[data-composer-card]') === null) return
      if (!/发送/.test(button.getAttribute('aria-label') ?? '')) return
      claimStaged()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      <QuoteRail quotes={pending} onRemove={removeQuote} />
    </>
  )
}

