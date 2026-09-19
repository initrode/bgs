import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // public/index.js is stray, unused debris — not wired into index.html.
    // src/providers/_template.mjs is a copy-paste skeleton (README: files
    // starting with "_" are never loaded), so its placeholder args are unused
    // by design.
    ignores: ['node_modules/**', 'data/**', 'coverage/**', 'public/index.js', 'src/providers/_template.mjs'],
  },
  js.configs.recommended,
  {
    files: ['server.mjs', 'src/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // safeSegment()'s regex intentionally matches an NBSP/high-codepoint
      // range as literal data, not source formatting.
      'no-irregular-whitespace': ['error', { skipRegExps: true }],
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
