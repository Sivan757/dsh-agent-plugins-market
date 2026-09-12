import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['lib/**', 'client/**', 'node_modules/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    // dependency-cruiser cannot see Node builtin edges, so the two boundaries that depend on
    // them are enforced here: the domain records and the browser-safe contracts stay data only,
    // and the client bundle never reaches a Node API.
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
