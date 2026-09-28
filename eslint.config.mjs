import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['lib/**', 'client/**', 'node_modules/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Type-aware rules need to know which program a file belongs to. The four
        // projects are listed most-specific-last so a file that appears in two of
        // them resolves to the shipped one rather than the test one.
        project: ['./tsconfig.json', './tsconfig.client.json', './tsconfig.test.json', './tsconfig.test.client.json'],
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
    files: ['src/model/**/*.ts', 'src/contracts/**/*.ts', 'src/client/**/*.ts', 'src/client/**/*.tsx'],
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
