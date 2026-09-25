/**
 * Sandbox-compatible test runner for dsh-quote.
 *
 * Why this exists: under the DSH file sandbox, programs cannot open named pipes,
 * so `child_process` with piped stdio fails with `EPERM`. Two things in the
 * normal `pnpm test` path trip over that:
 *
 *   1. Vite bundles `vitest.config.ts` by shelling out (`spawn EPERM`), so the TS
 *      config never loads.
 *   2. Vitest's default `forks` pool uses `child_process.fork`, which is denied
 *      (`spawn EPERM`), so no test file ever runs.
 *
 * This wrapper avoids both: it passes a plain `.mjs` config (no bundling step)
 * and runs the suite in-process on a single worker. It is a sandbox workaround
 * only — on an unrestricted machine `pnpm test` is still the right command, and
 * CI should keep using it.
 *
 * Usage: node scripts/test-sandbox.mjs [extra vitest args]
 * @module scripts/test-sandbox
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const args = [
  join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  '--config',
  join(root, 'vitest.sandbox.config.mjs'),
  ...process.argv.slice(2),
]

// stdio: 'inherit' is required — the sandbox rejects piped stdio.
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
