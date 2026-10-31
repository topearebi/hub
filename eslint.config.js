import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config enforcing the AGENTS.md negative constraints:
 *  - no `any` types
 *  - no `innerHTML` / `outerHTML` (XSS)
 *  - no UI framework imports (zero framework bloat)
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'innerHTML is forbidden (XSS risk). Use textContent or createElement.',
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message: 'outerHTML is forbidden (XSS risk).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'No UI frameworks allowed (AGENTS.md).' },
            { name: 'react-dom', message: 'No UI frameworks allowed (AGENTS.md).' },
            { name: 'vue', message: 'No UI frameworks allowed (AGENTS.md).' },
            { name: 'svelte', message: 'No UI frameworks allowed (AGENTS.md).' },
            { name: 'preact', message: 'No UI frameworks allowed (AGENTS.md).' },
          ],
        },
      ],
    },
  },
  {
    // Service worker runs in a worker global scope, not the DOM.
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  prettier,
);
