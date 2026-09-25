/**
 * dsh-quote shared source identity: the durable attribution both halves of the
 * plugin agree on.
 *
 * This is a zero-dependency leaf so BOTH tsconfig programs can include it: the
 * host declares it as the injected message's `source.kind` (augmenting the
 * runtime's `MessageSourceMap` in `quote-context.ts`), and the client reads the
 * same string back off the host's sent-quote record. Pulling the constant out of
 * the host module keeps the client bundle free of the `@deepseek-ai/dsh-llm`
 * value imports that would fail the purity gate.
 *
 * The harness has no shared catch-all `plugin` source kind — each producer
 * declares its own. This string is the durable attribution on the injected
 * message; the transcript never shows it (see below).
 * @module dsh-quote/source-kind
 */

/**
 * Durable `source.kind` for the context message a pending quote injects.
 *
 * Note this string is attribution, NOT a transcript handle: the shipped GUI
 * hides every ordinary injected-context row, so nothing in the transcript can
 * be keyed on it. See `docs/adr/0002-quote-visibility.md`.
 */
export const QUOTE_CONTEXT_KIND = 'quote-context'

/** The host's cordis plugin identity (config tree row name). */
export const PLUGIN_NAME = 'dsh-quote'
