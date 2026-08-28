import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Scoped to the frontend: the hooks rules are the load-bearing part — the
// document page and editor deliberately omit dependencies in a handful of
// effects (each carries an eslint-disable with its reasoning), and this
// config is what keeps every OTHER dependency list honest.
export default tseslint.config(
  {
    files: ['app/frontend/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      // The rest of the react-hooks v7 preset (refs, set-state-in-effect, …)
      // is React-Compiler preparation that rejects this codebase's
      // deliberate render-time ref mirrors; adopt those rules with the
      // compiler, not before.
      // tsc (noUnusedLocals/noUnusedParameters) already enforces this with
      // project-aware accuracy.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
)
