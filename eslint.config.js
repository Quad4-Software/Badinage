import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  {
    ignores: [
      'dist/',
      'node_modules/',
      'src/lib/i18n/',
      'docker/',
      'packages/*/dist/',
      'packages/*/docs/',
      'coverage/',
      'reports/',
      '.stryker-tmp/',
      '.svelte-check/'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...svelte.configs.recommended,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {},
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte']
      }
    }
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  // architecture boundaries, enforced mechanically:
  // core/ stays framework-free (runnable in tests and workers)
  {
    files: ['src/lib/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['svelte', 'svelte/*', 'bits-ui', 'runed'],
              message: 'core/ must stay framework-free'
            },
            {
              group: ['$lib/ui', '$lib/ui/*', '$lib/state', '$lib/state/*'],
              message: 'dependencies point inward only: core may not import ui/ or state/'
            }
          ]
        }
      ]
    }
  },
  // state/ never touches DOM or storage globals directly
  {
    files: ['src/lib/state/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/ui', '$lib/ui/*'],
              message: 'state/ may not import ui/'
            }
          ]
        }
      ],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'state/ must stay DOM-free' },
        { name: 'window', message: 'state/ must stay DOM-free' },
        { name: 'localStorage', message: 'go through core/storage instead' },
        { name: 'sessionStorage', message: 'go through core/storage/session instead' },
        { name: 'indexedDB', message: 'go through core/storage/idb instead' }
      ]
    }
  },
  // ui/ reaches core/ only through state/; type-only imports (which
  // erase at compile time) stay allowed
  {
    files: ['src/lib/ui/**/*.ts', 'src/lib/ui/**/*.svelte', 'src/lib/ui/**/*.svelte.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/core', '$lib/core/*'],
              allowTypeImports: true,
              message: 'ui/ calls core/ through state/ stores; type imports are exempt'
            }
          ]
        }
      ]
    }
  },
  // the omemo package is standalone: no app imports allowed
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['$lib/*'],
              message: 'packages/ must not import app code'
            }
          ]
        }
      ]
    }
  },
  // package test files: allow the assertion style interop vectors need
  {
    files: ['packages/*/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'preserve-caught-error': 'off'
    }
  }
])
