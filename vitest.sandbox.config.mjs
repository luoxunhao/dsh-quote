/**
 * Sandbox-only Vitest config, used by `scripts/test-sandbox.mjs`.
 *
 * Mirrors `vitest.config.ts`, but is plain `.mjs` so Vite loads it directly
 * instead of bundling it (that bundling step shells out and fails with
 * `spawn EPERM` under the DSH file sandbox). It also runs in-process on a single
 * worker, because the default `forks` pool cannot spawn children there.
 *
 * Keep the `test.include` / `environment` / `resolve.dedupe` values in sync with
 * `vitest.config.ts` — that file remains the source of truth.
 * @module vitest.sandbox.config
 */
export default {
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    environment: 'node',
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    server: {
      deps: {
        inline: [/@deepseek-ai\/dsh-client-ui-primitives/],
      },
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
}
