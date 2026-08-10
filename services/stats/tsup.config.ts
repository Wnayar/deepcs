import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entrypoints: `index` drains the log and exits, `server` answers reads.
  // Both ship in one image, started with different commands. See server.ts.
  entry: ['src/index.ts', 'src/server.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@deepcs\//],
});
