import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,

  // The load-bearing line. tsup externalises everything listed in
  // `dependencies` by default, and @deepcs/shared resolves through a pnpm
  // symlink into a store that does not exist inside the runtime image — so
  // externalising it produces an image that dies on its first import. Bundling
  // workspace packages inlines that code instead.
  noExternal: [/^@deepcs\//],
});
