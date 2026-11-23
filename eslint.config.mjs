import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // The e2e host harness is a plain Node script like scripts/*.mjs; the typed
    // rules need a TypeScript program that a .mjs file does not have.
    ignores: ['lib/**', 'client/**', 'node_modules/**', 'e2e/host.mjs']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['index.ts', 'packages/**/*.ts', 'packages/**/*.tsx', 'e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      parserOptions: {
        // Type-aware rules need to know which program a file belongs to. The
        // three projects are distinguished by where the file lives: server code,
        // client code, and the Playwright suite that drives both.
        project: ['./tsconfig.json', './tsconfig.client.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // An async implementation of a declared async seam returns its value
      // directly — a port, a provider or a mock. Demanding an `await` inside it
      // would only add a round trip, so every site this rule reports is the
      // shape it was written to have.
      '@typescript-eslint/require-await': 'off'
    }
  },
  {
    // dependency-cruiser cannot see Node builtin edges, so the boundaries that
    // depend on them are enforced here: the domain records and the browser-safe
    // contracts stay data only, and the client bundle never reaches a Node API.
    files: ['packages/market-contracts/src/**/*.ts', 'packages/market-ui/src/**/*.ts', 'packages/market-ui/src/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:**'],
              message: 'Node APIs belong in src/runtime/ or src/application/; this layer stays portable.'
            }
          ]
        }
      ]
    }
  }
)
