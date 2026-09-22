/**
 * Dependency-face gate: the host-shipped packages this plugin imports at runtime
 * must be peerDependencies, never dependencies.
 *
 * A DSH profile is a standalone pnpm project with a hoisted linker, and the host's
 * own packages sit in a tree the plugin can never reach by walking upwards. So a
 * host package declared as a dependency is installed a second time inside the
 * profile, and the plugin's bare import binds to that copy. The host then reads
 * the plugin's contributions through Symbols and classes from its own instance,
 * which never compare equal across the two copies — every conversation dies
 * mid-turn while the profile itself boots fine. `link:` installs hide this
 * because they materialize nothing; `file:<tgz>` installs hit it.
 * See scripts/verify-profile-install.mjs for the install-plane half of this gate.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

/** Package names the DSH host ships and shares with plugins at runtime. */
const HOST_OWNED = new Set(['@deepseek-ai/cordis', 'cordis', 'react', 'react-dom'])

interface PackageJson {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson

/**
 * Whether a package is one the host runtime already provides to plugins.
 * @param name - the package name to classify.
 */
function isHostOwned(name: string): boolean {
  return HOST_OWNED.has(name) || name.startsWith('@deepseek-ai/')
}

/** Every source file below a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && statSync(path).isFile()) files.push(path)
  }
  return files
}

/**
 * The bare package specifiers a source file imports as values (type-only imports
 * are erased at build time and never reach the resolver).
 * @param path - a source file.
 */
function runtimeImports(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  const imports: string[] = []
  for (const match of text.matchAll(/import\s+(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!
    if (!specifier.startsWith('.') && !specifier.startsWith('node:')) imports.push(specifier)
  }
  for (const match of text.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!
    if (!specifier.startsWith('.') && !specifier.startsWith('node:')) imports.push(specifier)
  }
  return [...new Set(imports)]
}

const runtimeHostImports = [...new Set(sourceFiles(join(root, 'src')).flatMap(runtimeImports))]
  .filter(isHostOwned)
  .sort()

describe('dependency face', () => {
  it('declares no host-owned package as a dependency', () => {
    const offenders = Object.keys(pkg.dependencies ?? {}).filter(isHostOwned).sort()
    expect(
      offenders,
      `host-owned packages in "dependencies" get a second instance installed into the profile:\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('declares every runtime host import as a peer', () => {
    const peers = new Set(Object.keys(pkg.peerDependencies ?? {}))
    const unpeered = runtimeHostImports.filter(name => !peers.has(name))
    expect(
      unpeered,
      `imported at runtime from the host but not declared as a peer: ${unpeered.join(', ')}`,
    ).toEqual([])
  })
})
