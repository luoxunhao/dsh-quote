/**
 * dsh-quote client half: registers a session-scoped entry into the
 * `conversation.input.dock` slot that hosts the select→quote affordance and the
 * pending-quote chips INSIDE the composer input area (see quote-dock.tsx).
 *
 * `conversation.input.dock` is a session-scoped slot rendered inside the input
 * zone (owner InputZone), so the quote chips appear within the composer rather
 * than as a raw strip below it. The entry also attaches document-level
 * selection listeners (for the floating 「添加到对话」button) — a session-mounted
 * dock is a stable anchor for those. The bundle cannot value-import the
 * conversation package (client purity gate), so registration reaches the
 * runtime `slots` service through a structural context face.
 *
 * Failure policy: registration/style problems are logged, never thrown — an
 * external plugin must not take the GUI down.
 * @module dsh-quote/client/index
 */

import { QuoteDock } from './quote-dock.tsx'
import { injectStyles } from './styles.ts'

/** The slot key rendered inside the composer input zone. */
const INPUT_DOCK_SLOT = 'conversation.input.dock'

/** Registration options for a list slot (subset the dock needs). */
export interface SlotRegisterOptions {
  /** The slot key to contribute into. */
  name: string
  /** The cell id within the slot (must be unique for a list slot). */
  id: string
  /** Optional render order (ascending, defaults to 0). */
  order?: number
}

/** The structural client context face this plugin consumes (slots service). */
export interface ClientContext {
  slots: {
    /** Register an entry into a slot; returns the disposer. */
    register(options: SlotRegisterOptions, component: unknown): () => void
    /** Scope a registration callback into a slot (session seat wiring). */
    inject(slot: string, callback: () => () => void): void
  }
  effect(callback: () => void | (() => void), name?: string): void
}

/** Apply claim: a duplicated client injection must not mount a second entry. */
let claimed = false

/** Services required before mounting (the slots service). */
export const inject = ['slots']

/** Plugin identity for the client module table. */
export const name = 'dsh-quote'

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots).
 */
export function apply(ctx: ClientContext): void {
  if (claimed) return
  claimed = true
  ctx.effect(() => () => { claimed = false }, 'dsh-quote: apply claim')

  try { ctx.effect(injectStyles, 'dsh-quote: styles') } catch (error) {
    console.error('[dsh-quote] style injection failed:', error)
  }

  try {
    // Scope the registration into the input.dock slot for the active session,
    // so the quote chips render inside the composer input area.
    ctx.slots.inject(INPUT_DOCK_SLOT, () => ctx.slots.register(
      { name: INPUT_DOCK_SLOT, id: 'quote', order: 0 },
      QuoteDock,
    ))
  } catch (error) {
    console.error(`[dsh-quote] ${INPUT_DOCK_SLOT} registration failed:`, error)
  }
}
