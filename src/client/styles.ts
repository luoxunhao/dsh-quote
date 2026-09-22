/**
 * dsh-quote client styles: injected once as a `<style data-plugin-css="dsh-quote">`
 * tag. Colors ride the dsh `--dsw-*` tokens so the affordance follows the
 * active theme. Attribute-scoped so nothing leaks into the rest of the GUI.
 *
 * The pending-quote rail is contributed to `conversation.input.overlay`, whose
 * anchor is a zero-height absolutely positioned box at the top of the composer
 * card. The rail therefore positions itself against that anchor and opens up
 * room in the card with a `:has()` guard, so the draft text is pushed below the
 * cards instead of being covered by them.
 *
 * The transcript card restyles a host-rendered injected-context row. It is
 * reached only through the `data-dsh-quote-context` mark that
 * `context-rows.ts` applies, and through the host's stable `data-*` attributes.
 * @module dsh-quote/client/styles
 */

const TAG_ID = 'dsh-quote'

/** Chip height, mirrored by the composer card's top padding below. */
const CARD_HEIGHT = 44
/** Gap between the card's top edge and the rail, and between the rail and the text. */
const RAIL_INSET = 8
/** Horizontal inset matching the composer's own text padding. */
const RAIL_SIDE_INSET = 14
/** Width cap for a transcript quote card. */
const TRANSCRIPT_CARD_MAX_WIDTH = 420
/** Edge of the transcript card's producer glyph tile. */
const TRANSCRIPT_TILE = 28

const CSS = `
/* Selection menu: one pill holding 「复制文本」 and 「添加到对话」. */
[data-dsh-quote-offer] {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.4;
  box-shadow: var(--dsw-elevation-soft, 0 4px 14px rgba(0, 0, 0, 0.22));
  white-space: nowrap;
  transform: translate(-50%, -100%);
}
[data-dsh-quote-offer][data-placement="below"] {
  transform: translate(-50%, 0);
}
[data-dsh-quote-offer] .dsh-quote-offer-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  cursor: pointer;
}
[data-dsh-quote-offer] .dsh-quote-offer-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-quote-offer] .dsh-quote-offer-sep {
  flex: none;
  width: 1px;
  height: 16px;
  background: var(--dsw-alias-border-l2, #3a3a3a);
}
[data-dsh-quote-offer] .dsh-quote-glyph {
  flex: none;
}

/* Pending-quote rail pinned to the top of the composer card. */
[data-dsh-quote-rail] {
  position: absolute;
  top: ${RAIL_INSET}px;
  left: ${RAIL_SIDE_INSET}px;
  right: ${RAIL_SIDE_INSET}px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
[data-dsh-quote-rail]::-webkit-scrollbar {
  display: none;
}
/* Room for the rail, only while the rail is actually mounted. */
[data-composer-card]:has([data-dsh-quote-rail]) {
  padding-top: ${RAIL_INSET + CARD_HEIGHT + RAIL_INSET}px;
}

/* One quote as an attachment card: glyph, quote, source row. */
[data-dsh-quote-rail] .dsh-quote-card {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 260px;
  height: ${CARD_HEIGHT}px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 10px;
  background: var(--dsw-alias-bg-base);
  overflow: hidden;
}
[data-dsh-quote-rail] .dsh-quote-card-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.14));
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-quote-rail] .dsh-quote-card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
[data-dsh-quote-rail] .dsh-quote-card-title {
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-quote-rail] .dsh-quote-card-sub {
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-quote-rail] .dsh-quote-card-remove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}
[data-dsh-quote-rail] .dsh-quote-card:hover .dsh-quote-card-remove,
[data-dsh-quote-rail] .dsh-quote-card-remove:focus-visible {
  opacity: 1;
}
[data-dsh-quote-rail] .dsh-quote-card-remove:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.2));
  color: var(--dsw-alias-label-primary);
}

/* This plugin's injected-context row in the transcript, as a card.
   The host renders every producer's logged context through one generic
   disclosure row that names its producer only in text, so context-rows.ts
   marks our own rows and this block reaches them through that mark. Selectors
   stay on the host's stable data attributes; its hashed CSS-module class names
   are never referenced. The row keeps its own disclosure behaviour, so the
   chevron is dropped for the card shape and expanding still shows the full
   quote in the host's notice body. */
[data-dsh-quote-context] > [data-slot="conversation.chat.node"] > div {
  box-sizing: border-box;
  max-width: ${TRANSCRIPT_CARD_MAX_WIDTH}px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  padding: 8px 10px;
}
[data-dsh-quote-context] [data-disclosure-row] {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
  row-gap: 1px;
}
[data-dsh-quote-context] [data-disclosure-row] > span:first-child {
  grid-row: 1 / span 2;
  grid-column: 1;
  width: ${TRANSCRIPT_TILE}px;
  height: ${TRANSCRIPT_TILE}px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.14));
  color: var(--dsw-alias-label-secondary);
}
[data-dsh-quote-context] [data-disclosure-row] > span:first-child > svg {
  display: none;
}
[data-dsh-quote-context] [data-disclosure-row] > span:nth-child(n+2):not([data-context-source]):not([data-context-summary]) {
  display: none;
}
[data-dsh-quote-context] [data-context-summary] {
  grid-row: 1;
  grid-column: 2;
  display: block;
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-quote-context] [data-context-source] {
  grid-row: 2;
  grid-column: 2;
  display: block;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
}
`

/** Inject the styles once; a repeated call is a no-op. */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[data-plugin-css="${TAG_ID}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.pluginCss = TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  return () => {
    tag.remove()
  }
}
