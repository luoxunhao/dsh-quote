/**
 * dsh-quote client half: registers a session-scoped entry into the
 * `conversation.composer.dock` slot that hosts the select→quote affordance
 * (see quote-dock.tsx).
 *
 * The slot key lives in `@deepseek-ai/dsh-client-ui-conversation`; the entry's
 * session standard props carry `useChat` (chat) and `sessionId` (ui-session).
 * The client bundle cannot value-import those packages (client purity gate),
 * so registration reaches the runtime `slots` service through a structurally
 * declared context face — the same pattern the sibling plugins use.
 *
 * Registration is scoped per session via `ctx.slots.inject(slot, cb)`, which
 * the framework wires to the current session's seat so the entry component
 * receives that session's standard props. Failure policy: registration problems
 * are logged, never thrown — an external plugin must not take the GUI down.
 * @module dsh-quote/client/index
 */

import { QuoteDock } from './quote-dock.tsx'

/** The composer-dock slot key (declared by the conversation plugin). */
const COMPOSER_DOCK_SLOT = 'conversation.composer.dock'

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

/**
 * Client plugin body.
 * @param ctx - the client cordis context (slots).
 */
export function apply(ctx: ClientContext): void {
  if (claimed) return
  claimed = true
  ctx.effect(() => () => { claimed = false }, 'dsh-quote: apply claim')

  try {
    // Scope the registration into the composer.dock slot for the active session.
    ctx.slots.inject(COMPOSER_DOCK_SLOT, () => ctx.slots.register(
      { name: COMPOSER_DOCK_SLOT, id: 'quote', order: 0 },
      QuoteDock,
    ))
  } catch (error) {
    console.error('[dsh-quote] composer.dock registration failed:', error)
  }
}
