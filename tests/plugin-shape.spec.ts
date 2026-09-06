/**
 * dsh-quote plugin export shape: host and client halves expose the cordis
 * loader shape (name / inject / apply), and the plugin identity agrees across
 * its sources (package name, host `name`, and the injected-message tag).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import * as plugin from '../src/index.ts'
import * as clientPlugin from '../src/client/index.tsx'
import { PLUGIN_NAME } from '../src/quote-fold.ts'

/** The package name from package.json (the module table id / patch `name`). */
function packageName(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { name: string }
  return pkg.name
}

describe('dsh-quote host plugin shape', () => {
  it('exposes the loader plugin shape', () => {
    expect(plugin.name).toBe('dsh-quote')
    expect(plugin.inject).toContain('webServer')
    expect(typeof plugin.apply).toBe('function')
  })
})

describe('dsh-quote client plugin shape', () => {
  it('exposes the client loader shape', () => {
    expect(clientPlugin.inject).toContain('slots')
    expect(typeof clientPlugin.apply).toBe('function')
  })
})

describe('plugin identity agreement', () => {
  it('host name, injected-message tag, and package name agree', () => {
    // The client-modules loader keys the bundle on the PACKAGE name; the host
    // cordis row and the injected-message plugin tag must all line up or the
    // plugin never activates / its injections are not attributable.
    expect(plugin.name).toBe(packageName())
    expect(PLUGIN_NAME).toBe(packageName())
  })
})
