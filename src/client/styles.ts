/**
 * dsh-quote client styles: injected once as a `<style data-plugin-css="dsh-quote">`
 * tag. Colors ride the dsh `--dsw-*` tokens so the affordance follows the
 * active theme. Attribute-scoped so nothing leaks into the rest of the GUI.
 * @module dsh-quote/client/styles
 */

const TAG_ID = 'dsh-quote'

const CSS = `
/* Floating 「添加到对话」offer button shown at the selection end. */
[data-dsh-quote-offer] {
  display: block;
}
[data-dsh-quote-offer] .dsh-quote-offer-button {
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  white-space: nowrap;
}
[data-dsh-quote-offer] .dsh-quote-offer-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* Pending-quote chips rendered INSIDE the composer input area.
   Compact horizontal chips (max width/height controlled, ellipsis on long
   text) so a queued quote reads as part of the input, not a raw block below. */
[data-dsh-quote-pending] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  max-height: 96px;
  overflow-y: auto;
  padding: 4px 10px;
}
[data-dsh-quote-pending] .dsh-quote-pending-label {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  white-space: nowrap;
  user-select: none;
}
[data-dsh-quote-pending] .dsh-quote-pending-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  height: 24px;
  padding: 0 4px 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, #3a3a3a);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.1));
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  overflow: hidden;
}
[data-dsh-quote-pending] .dsh-quote-pending-text {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-dsh-quote-pending] .dsh-quote-pending-item button {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
[data-dsh-quote-pending] .dsh-quote-pending-item button:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.2));
  color: var(--dsw-alias-label-primary);
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
