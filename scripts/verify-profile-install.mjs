/**
 * Install-plane gate: pack this plugin as a tarball, install it into a throwaway
 * pnpm project configured like a DSH profile (`nodeLinker: hoisted`,
 * `autoInstallPeers: false`), then fail when the install materializes a second
 * instance of a package the DSH host already ships.
 *
 * Why the tarball and not a `link:` install: a `link:` install only places a
 * symlink, so pnpm never hoists dependencies next to the plugin and bare imports
 * fall back to the host's own tree. A `file:<tgz>` install — the shape the desktop
 * launcher seeds — resolves the same imports to a profile-local copy instead.
 * The two install modes therefore produce different module identities, and a
 * plugin that is fine under one can break every conversation under the other:
 * the host reads plugin contributions through Symbols and classes, and a
 * duplicated package's Symbols are never `===` to the host's.
 *
 * The throwaway project is removed on every exit path; no real profile is touched.
 * @module scripts/verify-profile-install
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Unscoped packages the DSH host ships and shares with plugins at runtime. */
const HOST_OWNED_PACKAGES = new Set(['cordis', 'react', 'react-dom'])

/** The repository root this script validates. */
function projectRoot() {
  return join(import.meta.dirname, '..')
}

/**
 * Run a command and return its stdout.
 * @param command - the executable or `.cmd` shim name.
 * @param args - argv for the command.
 * @param cwd - working directory for the command.
 * @param quiet - suppress stdout on success.
 * @returns stdout of the command.
 */
function run(command, args, cwd, quiet = false) {
  const argv = args.map(a => (/\s/.test(a) ? `"${a}"` : a))
  const result = process.platform === 'win32'
    ? spawnSync(`${command} ${argv.join(' ')}`, { cwd, encoding: 'utf8', shell: true, maxBuffer: 32 << 20 })
    : spawnSync(command, argv, { cwd, encoding: 'utf8', maxBuffer: 32 << 20 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`${command} ${argv.join(' ')} failed with status ${result.status}`)
  }
  if (!quiet) process.stdout.write(result.stdout ?? '')
  return result.stdout ?? ''
}

/**
 * Every package name present under one `node_modules` root, scoped entries flattened.
 * @param modulesDir - a `node_modules` directory, which may be absent.
 * @returns the package names installed there.
 */
function installedNames(modulesDir) {
  if (!existsSync(modulesDir)) return new Set()
  const names = new Set()
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (!entry.name.startsWith('@')) {
      names.add(entry.name)
      continue
    }
    for (const scoped of readdirSync(join(modulesDir, entry.name), { withFileTypes: true })) {
      if (!scoped.name.startsWith('.')) names.add(`${entry.name}/${scoped.name}`)
    }
  }
  return names
}

/** The host runtime's package root, the reference tree for single-instance checks. */
function hostModulesRoot() {
  const override = process.env.DSH_HOST_MODULES
  if (override !== undefined && override !== '') return override
  const root = join(run('npm', ['root', '-g'], projectRoot(), true).trim(), '@deepseek-ai', 'dsh')
  if (!existsSync(root)) {
    throw new Error('Cannot locate the global @deepseek-ai/dsh host tree; install it or set DSH_HOST_MODULES.')
  }
  return join(root, 'node_modules')
}

function main() {
  const root = projectRoot()
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const hostRoot = hostModulesRoot()
  const hostDeepSeek = installedNames(join(hostRoot, '@deepseek-ai'))

  /**
   * Whether a package name is one the host already ships.
   * @param name - an installed package name.
   */
  const isHostOwned = name =>
    HOST_OWNED_PACKAGES.has(name) || (name.startsWith('@deepseek-ai/') && hostDeepSeek.has(name.slice('@deepseek-ai/'.length)))

  const work = join(tmpdir(), `dsh-quote-install-check-${process.pid}`)
  const profileDir = join(work, 'profile')
  const packDir = join(work, 'pack')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(packDir, { recursive: true })

  try {
    // Verify the bytes a profile actually installs, not the sources that produced
    // them: a stale lib/ would otherwise let this gate pass on an old bundle.
    run('pnpm', ['build'], root, true)

    const packed = run('pnpm', ['pack', '--pack-destination', packDir], root, true).trim().split(/\r?\n/).at(-1) ?? ''
    const tarballPath = join(packDir, packed.replace(/^.*[\\/]/, ''))
    if (!existsSync(tarballPath)) throw new Error(`pnpm pack produced no tarball in ${packDir}`)

    writeFileSync(
      join(profileDir, 'package.json'),
      `${JSON.stringify({ name: 'dsh-profile-lab', private: true, dependencies: { [pkg.name]: `file:${tarballPath}` } }, null, 2)}\n`,
    )
    writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    run('pnpm', ['install', '--ignore-scripts'], profileDir, true)

    const profileModules = join(profileDir, 'node_modules')
    const candidates = new Set(installedNames(profileModules))
    for (const name of installedNames(join(profileModules, pkg.name, 'node_modules'))) candidates.add(name)

    const duplicated = [...candidates].filter(name => name !== pkg.name && isHostOwned(name)).sort()
    if (duplicated.length > 0) {
      process.stderr.write(
        `\nInstalling ${pkg.name} as a tarball materializes a second instance of host-owned packages:\n` +
          `${duplicated.map(name => `  - ${name}\n`).join('')}\n` +
          `The host reads plugin contributions through Symbols and classes from its own copy, so a\n` +
          `second instance silently breaks every conversation mid-turn. Keep host-shipped packages on\n` +
          `peerDependencies; only a package this plugin spawns as its own process belongs in\n` +
          `dependencies.\n`,
      )
      process.exitCode = 1
      return
    }
    process.stdout.write(`OK: installing ${pkg.name} as a tarball materializes no second instance of a host-owned package.\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main()
