/**
 * Flat config, deliberately small.
 *
 * This is a module going into somebody else's repository, which will have its
 * own lint rules. Enforcing a house style here would mean every integrator
 * either adopts ours or fights it, so this checks only the things that are
 * bugs rather than preferences: unused code, unsafe `any` creeping past the
 * places it is deliberate, and floating promises.
 */
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'examples/**'] },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // A leading underscore marks a binding kept for its position in a
      // signature, which is not the same thing as a mistake.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
);
