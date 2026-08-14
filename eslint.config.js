import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['lib', 'dist', 'coverage', 'node_modules', 'examples', 'assets'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
)
