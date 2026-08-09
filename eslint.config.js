import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node JS that never goes through TypeScript, so the Node globals
    // have to be declared: infra/ is deployed straight to Cloud Functions, and
    // packages/db is the migration runner (ADR-10 — .sql files and a .mjs
    // script, deliberately no build step).
    files: ['infra/**/*.js', 'packages/db/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
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
