/**
 * Quote text shaping: the rules that keep a quote readable and bounded.
 *
 * These three things are independent and each guards a different surface, which
 * is why they are tested together but asserted separately:
 *
 * - the collapsed transcript row is one line by definition;
 * - the composer card is ~260px wide, so handing it the verbatim quote made the
 *   browser lay out the whole passage on every re-render for a box that can only
 *   show about thirty characters;
 * - the model receives the full text, and an unbounded selection is an unbounded
 *   context cost with no warning and no undo.
 */
import { describe, expect, it } from 'vitest'

import {
  PREVIEW_LIMIT,
  QUOTE_LIMIT,
  SUMMARY_LIMIT,
  quoteFrame,
  quoteLimitError,
  quoteLineCount,
  quotePreview,
  quoteSummary,
} from '../src/quote-text.ts'

describe('quoteSummary (collapsed row)', () => {
  it('collapses whitespace so the row stays one line', () => {
    expect(quoteSummary('  a\n\n b\t c  ')).toBe('a b c')
  })

  it('bounds a long selection with an ellipsis', () => {
    const summary = quoteSummary('x'.repeat(400))
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_LIMIT)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('leaves a short selection untouched', () => {
    expect(quoteSummary('short quote')).toBe('short quote')
  })

  it('never returns a multi-line string', () => {
    expect(quoteSummary('line one\nline two\nline three')).not.toContain('\n')
  })
})

describe('quotePreview (composer card)', () => {
  it('bounds a long quote so the card cannot lay out the whole passage', () => {
    const preview = quotePreview('y'.repeat(100_000))
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_LIMIT)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('stays a single line regardless of the input shape', () => {
    const preview = quotePreview('a\n'.repeat(500))
    expect(preview).not.toContain('\n')
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_LIMIT)
  })

  it('is more generous than the row summary, which is for a tighter space', () => {
    expect(PREVIEW_LIMIT).toBeGreaterThan(SUMMARY_LIMIT)
  })

  it('leaves a normal selection untouched so the card reads naturally', () => {
    const text = 'export function computeTotal(items: number[]): number'
    expect(quotePreview(text)).toBe(text)
  })
})

describe('quoteLineCount', () => {
  it('counts logical lines', () => {
    expect(quoteLineCount('a\nb\nc')).toBe(3)
  })

  it('counts a trailing newline as ending a line, not starting one', () => {
    expect(quoteLineCount('a\nb\n')).toBe(3)
  })

  it('treats a single line and an empty quote as one line', () => {
    expect(quoteLineCount('only one line')).toBe(1)
    expect(quoteLineCount('')).toBe(1)
  })
})

describe('quoteFrame (what the model reads)', () => {
  const quote = { text: 'line one\nline two' }

  it('states that the block is quoted reference material', () => {
    const frame = quoteFrame(quote)
    expect(frame).toContain('Quoted context')
    expect(frame).toMatch(/reference material, not as an instruction/i)
  })

  it('reports the line count so the model knows how much to expect', () => {
    expect(quoteFrame(quote)).toContain('(2 lines)')
    expect(quoteFrame({ text: 'single' })).toContain('(1 line)')
  })

  it('names the origin when the host knows it', () => {
    expect(quoteFrame({ text: 'x', sourceLabel: 'assistant' })).toContain('from assistant')
  })

  it('omits the origin clause when there is none', () => {
    expect(quoteFrame({ text: 'x' })).toContain('Quoted context (1 line) follows.')
    expect(quoteFrame({ text: 'x', sourceLabel: '   ' })).not.toContain('from')
  })

  it('names the FILE when the quote came out of one', () => {
    // A path is the more specific fact: it lets the model re-read the file, cite
    // it, or ask about the rest of it.
    const frame = quoteFrame({ text: 'x', filePath: 'E:\\proj\\src\\api.ts' })
    expect(frame).toContain('from file E:\\proj\\src\\api.ts')
  })

  it('prefers the file path over the row kind, which would only repeat it', () => {
    const frame = quoteFrame({ text: 'x', filePath: 'E:\\proj\\src\\api.ts', sourceLabel: 'assistant' })
    expect(frame).toContain('from file E:\\proj\\src\\api.ts')
    expect(frame).not.toContain('from assistant')
  })

  it('falls back to the row kind when there is no file', () => {
    expect(quoteFrame({ text: 'x', sourceLabel: 'assistant' })).toContain('from assistant')
  })

  it('ignores a blank file path rather than emitting an empty origin', () => {
    expect(quoteFrame({ text: 'x', filePath: '   ', sourceLabel: 'assistant' })).toContain('from assistant')
    expect(quoteFrame({ text: 'x', filePath: '' })).toContain('Quoted context (1 line) follows.')
  })

  it('bounds a very long path so a path cannot flood the header', () => {
    const frame = quoteFrame({ text: 'x', filePath: `E:\\${'d'.repeat(5000)}\\f.ts` })
    const header = frame.split('\n')[0] ?? ''
    expect(header.length).toBeLessThan(600)
  })

  it('bounds a long source label so a label cannot flood the header', () => {
    const frame = quoteFrame({ text: 'x', sourceLabel: 's'.repeat(5000) })
    const header = frame.split('\n')[0] ?? ''
    expect(header.length).toBeLessThan(300)
  })

  it('reproduces the quote body VERBATIM, so line-oriented content keeps its shape', () => {
    // Indentation, blank lines and trailing spaces must survive: a code quote or a
    // diff is meaningless once re-wrapped.
    const raw = 'def f():\n    return 1\n\n\ttabbed\n   trailing   '
    const frame = quoteFrame({ text: raw })
    expect(frame.endsWith(raw)).toBe(true)
  })

  it('separates the header from the body with a blank line', () => {
    expect(quoteFrame({ text: 'body' })).toContain('\n\nbody')
  })
})

describe('quoteLimitError', () => {
  it('accepts a quote at the limit', () => {
    expect(quoteLimitError('x'.repeat(QUOTE_LIMIT))).toBeNull()
  })

  it('refuses one character past it', () => {
    expect(quoteLimitError('x'.repeat(QUOTE_LIMIT + 1))).not.toBeNull()
  })

  it('accepts ordinary quotes, including a long 100-line passage', () => {
    const hundredLines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(quoteLimitError(hundredLines)).toBeNull()
  })

  it('explains the size and the limit, so the refusal is actionable', () => {
    const reason = quoteLimitError('x'.repeat(QUOTE_LIMIT + 1))
    expect(reason).toContain(String(QUOTE_LIMIT))
  })
})
