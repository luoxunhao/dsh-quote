/**
 * dsh-quote shared identity constants.
 *
 * This is a zero-dependency leaf so BOTH tsconfig programs can include it: the
 * host stamps {@link QUOTE_CONTEXT_KIND} onto the injected message and the client
 * definition matches on the same string. The client bundle must not value-import
 * a host module (client purity gate), so the constant lives here rather than on
 * either half.
 *
 * Why a private kind rather than the ordinary `user` kind: `ui-chat`'s
 * `messageDefinition` claims EVERY append-surface `user/message` event, so a
 * message carrying `kind: 'user'` always projects to a user bubble. A private
 * kind projects to a `context` node instead, which this plugin's own Conversation
 * definition intercepts and republishes as its own visible `quote` node. See
 * `docs/adr/0004-quote-as-injected-row.md`.
 * @module dsh-quote/source-kind
 */

/** The host's cordis plugin identity (config tree row name). */
export const PLUGIN_NAME = 'dsh-quote'

/**
 * Durable `source.kind` stamped on the message a pending quote injects.
 *
 * This is the join between the two halves: the host writes it into the session
 * log (so the quote keeps a durable, identifiable attribution) and the client
 * definition matches on it to build the visible quote row.
 */
export const QUOTE_CONTEXT_KIND = 'quote-context'
