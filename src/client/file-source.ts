/**
 * dsh-quote sidebar file provenance: recovering the file a selection came from.
 *
 * The right sidebar renders an open file with two DOM facts that together name
 * it, and both were confirmed by measurement against a real `dsh web`:
 *
 *   div.dhJKeW_preview[data-textpreview-url] =
 *     "dsh-resource://file/session/<sessionId>/README.md"   <- workspace-relative
 *   span.dhJKeW_path[title] = "E:\\project\\dsh\\dsh-quote\\README.md"  <- absolute
 *
 * They sit in the SAME container, but the path span is a SIBLING of the element
 * carrying the address rather than an ancestor of the selected text — so a walk
 * that only climbs from the selection cannot see it. The resolution therefore
 * finds the addressed container first and then looks for the absolute path
 * inside that container's own subtree.
 *
 * Everything is structural and read-only: the plugin consumes attributes the
 * sidebar already publishes and never imports the sidebar package (client purity
 * gate).
 * @module dsh-quote/client/file-source
 */

/** The attribute carrying a preview's `dsh-resource://` address. */
const ADDRESS_ATTR = 'data-textpreview-url'

/** The selector form of {@link ADDRESS_ATTR}, for `closest`. */
const ADDRESS_SELECTOR = `[${ADDRESS_ATTR}]`

/** A Windows drive-absolute path, e.g. `E:\dir\file.ts`. */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/

/** A POSIX absolute path, e.g. `/home/me/file.ts`. */
const POSIX_ABSOLUTE = /^\//

/**
 * Whether a string is an absolute filesystem path.
 *
 * The sidebar puts the path in a `title`, which is also used for ordinary
 * tooltips, so the shape has to be checked rather than assumed.
 * @param value - the candidate string.
 */
export function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)
}

/**
 * Parse the file path out of a `dsh-resource://file/session/<sessionId>/<path>` address.
 *
 * Only session-scoped file addresses carry a path that resolves against a
 * workspace; anything else yields null rather than a half-understood value.
 * @param address - the raw attribute value.
 * @returns the workspace-relative path, or null.
 */
export function relativePathFromAddress(address: string): string | null {
  const prefix = 'dsh-resource://file/session/'
  if (!address.startsWith(prefix)) return null
  const rest = address.slice(prefix.length)
  // `<sessionId>/<path…>`: the session id is the first segment.
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const path = rest.slice(slash + 1)
  if (path === '') return null
  try {
    return decodeURIComponent(path)
  } catch {
    // A malformed escape is not worth failing the capture over; take it raw.
    return path
  }
}

/** The file provenance a sidebar selection resolves to. */
export interface FileSource {
  /** Absolute filesystem path, as the sidebar publishes it. */
  readonly path: string
  /** Workspace-relative path from the resource address, when parseable. */
  readonly relativePath?: string
}

/**
 * The container the anchor's addressed subtree sits in, or null.
 * @param anchorNode - the selection's anchor.
 */
function addressedContainer(anchorNode: Node): Element | null {
  const el = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
  if (el === null) return null
  return el.closest(ADDRESS_SELECTOR)
}

/**
 * Find the absolute path the addressed container names.
 *
 * The path lives in a `title` inside the container's own subtree, so this scans
 * that subtree rather than climbing past it — climbing would eventually reach the
 * tab shell and could match an unrelated file. The first absolute-looking title
 * wins, and a container with none yields null so the quote simply has no file
 * provenance instead of a wrong one.
 * @param container - the element carrying the resource address.
 */
function absolutePathIn(container: Element): string | null {
  const own = container.getAttribute('title')
  if (own !== null && isAbsolutePath(own)) return own
  for (const el of container.querySelectorAll('[title]')) {
    const title = el.getAttribute('title') ?? ''
    if (isAbsolutePath(title)) return title
  }
  return null
}

/**
 * Resolve the file a selection was made in, when it was made in the sidebar.
 *
 * Returns undefined for a selection anywhere else (the chat transcript, the
 * composer, another panel), which is what keeps the chat path unchanged.
 * @param anchorNode - the selection's anchor node.
 * @returns the file's provenance, or undefined when the selection is not in an
 *   addressed sidebar preview.
 */
export function fileSourceFromAnchor(anchorNode: Node | null): FileSource | undefined {
  if (!(anchorNode instanceof Node)) return undefined
  const container = addressedContainer(anchorNode)
  if (container === null) return undefined
  const path = absolutePathIn(container)
  if (path === null) return undefined
  const address = container.getAttribute(ADDRESS_ATTR) ?? ''
  const relativePath = relativePathFromAddress(address)
  return relativePath === null ? { path } : { path, relativePath }
}
