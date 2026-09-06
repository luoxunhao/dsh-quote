/**
 * dsh-quote client structural faces for the session-scope slot entry props.
 *
 * The slot framework injects a rich standard-props kit into every session-scope
 * entry (sessionId/useSession/useChat/useConversation/useInput/useWorkspaces…
 *). This plugin only reads `useChat` (to resolve an assistant node from a
 * right-click) and `sessionId` (to address the host HTTP API). Upstream type
 * merges live across several @deepseek-ai packages and are not all visible to
 * this bundle, so we restate the consumed slices structurally — the same
 * structural-mirror pattern dsh-codex-project uses — rather than depend on a
 * fragile composed type.
 * @module dsh-quote/client/slot-props
 */

/** A selector hook over an observable snapshot (dsh-client-store shape). */
export type SelectorHook<T> = {
  <S>(selector: (snapshot: T) => S): S
  (): T
}

/** The chat-snapshot node store we resolve by node key. */
export interface ChatNodeStoreLike {
  get(key: string): unknown
}

/** The chat snapshot shape the dock reads (nodes store). */
export interface ChatSnapshotLike {
  nodes: ChatNodeStoreLike
}

/** The session-standard props slice dsh-quote's composer.dock entry consumes. */
export interface SessionStandardProps {
  /** Selector hook over the live ChatSnapshot of the current session. */
  useChat: SelectorHook<ChatSnapshotLike>
}

/** The global-standard props slice (unused; declared for completeness). */
export interface GlobalStandardProps {
  // No members consumed by dsh-quote today.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  [key: string]: unknown
}
