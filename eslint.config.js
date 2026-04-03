import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/', 'node_modules/', 'dashboard/dist/', 'dashboard/node_modules/', '*.js'],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript rules for backend
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  })),

  // TypeScript rules for dashboard
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['dashboard/src/**/*.ts', 'dashboard/src/**/*.tsx'],
  })),

  // Backend-specific overrides
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Dashboard-specific overrides with React hooks
  {
    files: ['dashboard/src/**/*.ts', 'dashboard/src/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Prettier must be last to disable conflicting rules
  prettier,
);
