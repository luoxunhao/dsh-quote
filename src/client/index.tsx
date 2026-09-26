/**
 * dsh-quote client half: registers a session-scoped entry into the
 * `conversation.input.overlay` slot that hosts the select→quote menu and the
 * pending-quote cards INSIDE the composer card (see quote-dock.tsx).
 *
 * `conversation.input.overlay` is a session-scoped list slot rendered inside the
 * resident composer card's own attachment area, so the quote cards appear above
 * the draft text the way a pasted image does. `conversation.input.dock` is not
 * that: it renders full-width entries *above* the composer card. The card's
 * attachment slot is a single slot already taken by the host's image rail. The
 * entry also attaches document-level selection listeners (for the floating
 * selection menu) — a session-mounted overlay is a stable anchor for those. The
 * bundle cannot value-import the conversation package (client purity gate), so
 * registration reaches the runtime `slots` service through a structural context
 * face.
 *
 * Failure policy: registration/style problems are logged, never thrown — an
 * external plugin must not take the GUI down.
 * @module dsh-quote/client/index
 */

import { QuoteDock } from './quote-dock.tsx'
import { createQuoteDefinition, QUOTE_NODE_KIND } from './quote-row.ts'
import { QuoteRowView } from './quote-row-view.tsx'
import { injectStyles } from './styles.ts'
import { QUOTE_CONTEXT_KIND } from '../source-kind.ts'

/** The slot key rendered inside the resident composer card. */
const INPUT_OVERLAY_SLOT = 'conversation.input.overlay'

/** The keyed seat that renders one Chat node kind. */
const CHAT_NODE_SLOT = 'conversation.chat.node'

/** Registration options for a slot (subset the dock and the row need). */
export interface SlotRegisterOptions {
  /** The slot key to contribute into. */
  name: string
  /** The cell id within the slot (list slots only). */
  id?: string
  /** The node kind this renderer claims (keyed slots only). */
  key?: string
  /** Optional render order (ascending, defaults to 0). */
  order?: number
}

/** The structural client context face this plugin consumes. */
export interface ClientContext {
  slots: {
    /** Register an entry into a slot; returns the disposer. */
    register(options: SlotRegisterOptions, component: unknown): () => void
    /** Scope a registration callback into a slot (session seat wiring). */
    inject(slot: string, callback: () => () => void): void
  }
  /**
   * Target-neutral Conversation registries. Reached structurally for the same
   * reason as `slots`: the client bundle may not value-import the conversation
   * package (purity gate), so the definition is registered through the runtime
   * service instead.
   */
  uiConversation?: {
    events?: {
      /** Claim one event type for this plugin's own node kind. */
      register(definition: unknown): () => void
    }
  }
  effect(callback: () => void | (() => void), name?: string): void
}

/** Apply claim: a duplicated client injection must not mount a second entry. */
let claimed = false

/**
 * Services required before mounting.
 *
 * `uiConversation` is declared so the definition can be registered at all; a
 * host that does not provide it leaves the quote unrendered rather than crashing
 * (see the guarded block in {@link apply}).
 */
export const inject = ['slots', 'uiConversation']

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
    // Scope the registration into the input.overlay slot for the active session,
    // so the quote cards render inside the composer card.
    ctx.slots.inject(INPUT_OVERLAY_SLOT, () => ctx.slots.register(
      { name: INPUT_OVERLAY_SLOT, id: 'quote', order: 0 },
      QuoteDock,
    ))
  } catch (error) {
    console.error(`[dsh-quote] ${INPUT_OVERLAY_SLOT} registration failed:`, error)
  }

  // Claim this plugin's injected messages away from the default `context`
  // classification and republish them as a visible `quote` node, then render that
  // kind through our own seat. Both steps are optional: if the host does not
  // expose the registry or the seat, the quote still reaches the model and we
  // simply lose the row (ADR-0004).
  try {
    const events = ctx.uiConversation?.events
    if (events === undefined) {
      console.warn('[dsh-quote] uiConversation.events unavailable; quote rows will not render')
    } else {
      ctx.effect(() => events.register(createQuoteDefinition(QUOTE_CONTEXT_KIND)), 'dsh-quote: quote row')
    }
  } catch (error) {
    console.error('[dsh-quote] quote definition registration failed:', error)
  }

  try {
    ctx.slots.inject(CHAT_NODE_SLOT, () => ctx.slots.register(
      { name: CHAT_NODE_SLOT, key: QUOTE_NODE_KIND },
      QuoteRowView,
    ))
  } catch (error) {
    console.error(`[dsh-quote] ${CHAT_NODE_SLOT} registration failed:`, error)
  }
}
