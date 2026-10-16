import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      'tools/**/*.{mjs,ts}',
      'samples/**/*.mjs',
      '*.config.{js,ts}',
      'apps/*/*.config.ts',
      'apps/*/e2e/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
  },
);
