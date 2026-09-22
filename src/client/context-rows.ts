/**
 * dsh-quote transcript row marker: identifies the collapsed injected-context
 * rows this plugin produced so the card stylesheet can reach them.
 *
 * A logged non-user message becomes a `context` Chat node, and the host renders
 * it with one generic disclosure row for every producer. While collapsed that
 * row carries no attribute naming its producer — `data-context-form` lives on
 * the body, which mounts only when the row expands — and the durable message id
 * is a random UUID the producer cannot choose. The one collapsed-visible fact is
 * the producer text the host renders into `[data-context-source]`, which is the
 * plugin name: a stable identifier, not localized copy. So the plugin marks its
 * own rows from that text and styles the marked rows as cards.
 *
 * Marking is additive: the host keeps rendering the row, its disclosure
 * behaviour, and its expanded body.
 * @module dsh-quote/client/context-rows
 */

import { PLUGIN_NAME } from '../quote-fold.ts'

/** Injected-context Chat row, as emitted by the host's node seat. */
const CONTEXT_ROW_SELECTOR = '[data-chat-flow-kind="context"]'
/** Producer name cell, present while the row is collapsed. */
const SOURCE_SELECTOR = '[data-context-source]'
/** Attribute the card stylesheet keys on. */
export const QUOTE_ROW_MARK = 'data-dsh-quote-context'

/** Add or remove the mark on one context row according to its producer text. */
function applyMark(row: Element): boolean {
  const source = row.querySelector(SOURCE_SELECTOR)
  const producer = source?.textContent?.trim()
  const mine = producer === PLUGIN_NAME
  if (mine) row.setAttribute(QUOTE_ROW_MARK, '')
  else row.removeAttribute(QUOTE_ROW_MARK)
  return mine
}

/**
 * Mark every injected-context row under `root` that this plugin produced, and
 * clear the mark from the ones it did not.
 * @param root - subtree to scan; a context row passed as the root is scanned too.
 * @returns how many rows end up marked.
 */
export function markQuoteContextRows(root: ParentNode): number {
  let marked = 0
  if (root instanceof Element && root.matches(CONTEXT_ROW_SELECTOR) && applyMark(root)) marked += 1
  for (const row of root.querySelectorAll(CONTEXT_ROW_SELECTOR)) {
    if (applyMark(row)) marked += 1
  }
  return marked
}

/**
 * Mark the rows already on screen and keep marking rows as the transcript adds
 * them. Context rows are immutable once logged, so newly added nodes are the
 * only place one can appear; existing rows are never rescanned.
 * @param target - the subtree to observe, normally `document.body`.
 * @returns a disposer that disconnects the observer.
 */
export function attachQuoteContextRowMarker(target: HTMLElement | Document): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  markQuoteContextRows(target)
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue
        const row = added.matches(CONTEXT_ROW_SELECTOR) ? added : added.closest(CONTEXT_ROW_SELECTOR)
        if (row !== null) applyMark(row)
        if (added !== row) markQuoteContextRows(added)
      }
    }
  })
  observer.observe(target, { childList: true, subtree: true })
  return () => observer.disconnect()
}
