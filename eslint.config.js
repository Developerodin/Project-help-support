import globals from 'globals';

export default [
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // A missing import is a runtime ReferenceError, so no-undef is worth gating on
  // even where the noisier style rules are not — and .jsx was previously unlinted.
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.vitest },
    },
    rules: {
      'no-undef': 'error',
    },
  },
  { ignores: ['node_modules/', 'coverage/', '**/.next/', '**/.next-prod/', '**/dist/', 'graphify-out/'] },
];
