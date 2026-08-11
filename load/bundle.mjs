import { build } from 'esbuild';

/**
 * k6 runs its own JavaScript runtime, not Node: it resolves relative paths and
 * URLs but not `node_modules`, so an `import * as Y from 'yjs'` has to be
 * bundled in before k6 ever sees the script. This is the step that does it.
 *
 *   node bundle.mjs        writes dist/collab.bundle.js
 *
 * `k6/*` stays external because those modules exist only inside k6 and are
 * resolved at run time.
 */
await build({
  entryPoints: ['collab.js'],
  outfile: 'dist/collab.bundle.js',
  bundle: true,
  format: 'esm',
  // The browser condition, so lib0 picks its `globalThis.crypto` implementation
  // rather than the Node one that imports `node:crypto` — a module k6 has no
  // way to provide.
  platform: 'browser',
  target: 'es2020',
  external: ['k6', 'k6/*'],
});
