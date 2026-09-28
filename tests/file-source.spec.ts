/**
 * @vitest-environment jsdom
 * Sidebar file provenance: recovering the file a selection came from.
 *
 * Grounded in what a real `dsh web` publishes (verified in Chrome, then pinned
 * here):
 *
 *   <div data-textpreview-url="dsh-resource://file/session/<sid>/README.md">
 *     <span class="…_path" title="E:\project\dsh\dsh-quote\README.md">…</span>
 *     <div class="…_preview">… selectable file text …</div>
 *   </div>
 *
 * The absolute path is a SIBLING of the addressed element, not an ancestor of the
 * selected text, so a naive climb from the selection finds nothing. These tests
 * pin the container-first resolution that actually works.
 */
import { describe, expect, it } from 'vitest'

import {
  fileSourceFromAnchor,
  isAbsolutePath,
  relativePathFromAddress,
} from '../src/client/file-source.ts'

const SID = 'session-921e950f-bd51-41c9-a059-88310f82adf3'
const ABS = 'E:\\project\\dsh\\dsh-quote\\README.md'
const ADDR = `dsh-resource://file/session/${SID}/README.md`

/**
 * Build the sidebar preview shape: an addressed container holding BOTH a
 * path-bearing span and the selectable text.
 * @param options - what to include, for the negative cases.
 */
function preview(options: { address?: string | null; title?: string | null } = {}): {
  container: HTMLElement
  textNode: Node
} {
  const container = document.createElement('div')
  if (options.address !== null) container.setAttribute('data-textpreview-url', options.address ?? ADDR)
  if (options.title !== null) {
    const pathSpan = document.createElement('span')
    pathSpan.setAttribute('title', options.title ?? ABS)
    pathSpan.textContent = options.title ?? ABS
    container.appendChild(pathSpan)
  }
  const body = document.createElement('div')
  body.textContent = 'the selectable file text'
  container.appendChild(body)
  document.body.appendChild(container)
  const textNode = body.firstChild as Node
  return { container, textNode }
}

describe('isAbsolutePath', () => {
  it('accepts a Windows drive path', () => {
    expect(isAbsolutePath('E:\\project\\dsh\\dsh-quote\\README.md')).toBe(true)
    expect(isAbsolutePath('C:/Users/me/file.ts')).toBe(true)
  })

  it('accepts a POSIX absolute path', () => {
    expect(isAbsolutePath('/home/me/file.ts')).toBe(true)
  })

  it('rejects relative paths and ordinary tooltips', () => {
    // The sidebar uses `title` for plain hover text too, so the shape must be
    // checked rather than trusted.
    expect(isAbsolutePath('README.md')).toBe(false)
    expect(isAbsolutePath('docs/README.md')).toBe(false)
    expect(isAbsolutePath('移除引用')).toBe(false)
    expect(isAbsolutePath('')).toBe(false)
  })
})

describe('relativePathFromAddress', () => {
  it('extracts the workspace-relative path', () => {
    expect(relativePathFromAddress(ADDR)).toBe('README.md')
    expect(relativePathFromAddress(`dsh-resource://file/session/${SID}/src/client/api.ts`))
      .toBe('src/client/api.ts')
  })

  it('decodes escaped characters', () => {
    expect(relativePathFromAddress(`dsh-resource://file/session/${SID}/a%20b/c.ts`))
      .toBe('a b/c.ts')
  })

  it('returns null for a non-file address or a malformed one', () => {
    expect(relativePathFromAddress('dsh-resource://terminal/session/x')).toBeNull()
    expect(relativePathFromAddress(`dsh-resource://file/session/${SID}`)).toBeNull()
    expect(relativePathFromAddress(`dsh-resource://file/session/${SID}/`)).toBeNull()
    expect(relativePathFromAddress('')).toBeNull()
  })
})

describe('fileSourceFromAnchor', () => {
  it('resolves the absolute path from a selection inside a sidebar preview', () => {
    const { textNode } = preview()
    expect(fileSourceFromAnchor(textNode)).toEqual({ path: ABS, relativePath: 'README.md' })
  })

  it('resolves from an element anchor as well as a text node', () => {
    const { container } = preview()
    expect(fileSourceFromAnchor(container)?.path).toBe(ABS)
  })

  it('returns undefined for a selection outside any addressed preview', () => {
    // This is what keeps the chat transcript and every other panel unaffected.
    const outside = document.createElement('div')
    outside.textContent = 'ordinary page text'
    document.body.appendChild(outside)
    expect(fileSourceFromAnchor(outside.firstChild)).toBeUndefined()
  })

  it('returns undefined when the container has no absolute path to give', () => {
    // A preview we cannot name must yield NO provenance rather than a wrong one.
    const { textNode } = preview({ title: null })
    expect(fileSourceFromAnchor(textNode)).toBeUndefined()
  })

  it('ignores a non-absolute title so ordinary tooltips cannot be mistaken for paths', () => {
    const { textNode } = preview({ title: '移除引用' })
    expect(fileSourceFromAnchor(textNode)).toBeUndefined()
  })

  it('works without a parseable address, keeping the absolute path alone', () => {
    const { textNode } = preview({ address: 'dsh-resource://unknown/x' })
    expect(fileSourceFromAnchor(textNode)).toEqual({ path: ABS })
  })

  it('returns undefined for a null anchor', () => {
    expect(fileSourceFromAnchor(null)).toBeUndefined()
  })

  it('does not reach past its own container for a path', () => {
    // Climbing to the tab shell could match an unrelated file; the path must come
    // from this preview's own subtree.
    const outer = document.createElement('div')
    const sibling = document.createElement('span')
    sibling.setAttribute('title', 'E:\\other\\unrelated.ts')
    outer.appendChild(sibling)
    const container = document.createElement('div')
    container.setAttribute('data-textpreview-url', ADDR)
    const body = document.createElement('div')
    body.textContent = 'text'
    container.appendChild(body)
    outer.appendChild(container)
    document.body.appendChild(outer)
    expect(fileSourceFromAnchor(body.firstChild)).toBeUndefined()
  })
})
