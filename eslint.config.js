import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /**
     * The hooks rules, on the frontend only — the six services have no React
     * in them. These are not style: the class of bug they catch is an effect
     * closing over a stale value, or one that re-runs on every render because
     * a dependency is recreated each time. Both are silent at runtime, and the
     * session page runs a WebSocket, a Yjs document and an editor out of a
     * single effect, which is exactly where that goes wrong.
     *
     * Wired by hand rather than through the plugin's preset: its
     * `recommended-latest` is still shaped for eslintrc (`plugins` as an
     * array) and would not load in flat config, and its v7 preset turns on a
     * dozen newer rules beyond the two this is here for.
     */
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', self: 'readonly' },
    },
  },
  {
    // Plain Node JS that never goes through TypeScript, so the Node globals
    // have to be declared: packages/db is the migration runner (ADR-10 — .sql
    // files and a .mjs script, deliberately no build step).
    files: ['packages/db/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    // The k6 load script, which is neither Node nor a browser: k6 runs its own
    // JS runtime, providing `__ENV` and the timer globals but no `process` and
    // no `require`. The bundle it actually executes is built into load/dist,
    // which the ignore list above already covers.
    files: ['load/**/*.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
