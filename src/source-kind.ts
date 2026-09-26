/**
 * dsh-quote shared identity constants.
 *
 * This is a zero-dependency leaf so BOTH tsconfig programs can include it: the
 * host uses {@link PLUGIN_NAME} for its config row, and the client bundle must
 * not value-import a host module (client purity gate).
 *
 * There is deliberately no plugin-private message source kind here. Quotes are
 * delivered as ordinary user-role messages, because the GUI only renders user
 * bubbles and filters every other kind of injected context out of the transcript.
 * See ADR-0003.
 * @module dsh-quote/source-kind
 */

/** The host's cordis plugin identity (config tree row name). */
export const PLUGIN_NAME = 'dsh-quote'
