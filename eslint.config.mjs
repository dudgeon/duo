// ESLint flat config for Duo (TS + React renderer + Electron main/core).
//
// History: `npm run lint` (`eslint .`) had been silently non-functional —
// `eslint` was never a declared devDependency and no config existed, so the
// "lint" gate did nothing (flagged in docs/prd/enh-191-multi-window.md
// Appendix C and discovered during ENH-191 Phase H). This restores a REAL,
// runnable gate.
//
// Version pin: this worktree runs Node 18.17.0, which is below ESLint 9's
// floor (^18.18) and ESLint 10's (which calls the Node 20.12+ API
// `util.styleText` and hard-crashes on 18.x). So we pin ESLint 8.57 +
// typescript-eslint 7 — the last line that runs on Node 18.17. Flat config
// is opt-in on ESLint 8 via `ESLINT_USE_FLAT_CONFIG=true` (set in the npm
// "lint" script). When Node is bumped to >= 20.12, drop the env var and
// move to ESLint 9/10 — this flat config carries over unchanged.
//
// Posture: deliberately lenient to start. The existing ~241-file codebase
// predates any linting, so rules that would flood it are 'warn' (visible,
// non-blocking) or 'off'. `eslint .` exits non-zero only on ERRORS, so this
// keeps the gate GREEN while surfacing issues as warnings. Promote
// warn -> error incrementally as the codebase is cleaned.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // ── Global ignores (generated / vendored / out-of-tree) ──────────────
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'coverage/**',
      '.claude/worktrees/**', // sibling worktrees (mirrors vitest.config.ts)
      'cli/duo',              // tracked esbuild bundle (generated, minified)
      '**/*.min.js',
    ],
  },

  // ── Base + TypeScript recommended (non-type-aware: fast, no tsconfig) ─
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Repo-wide tuning ─────────────────────────────────────────────────
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx,mts,cts}'],
    rules: {
      // TypeScript already provides undefined-symbol checking; the base
      // rule misfires on TS/DOM/node globals (typescript-eslint's own
      // guidance is to disable it on TS projects).
      'no-undef': 'off',

      // High-volume / low-signal in a pre-lint codebase — keep visible as
      // warnings or disable. Tighten over time.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-types': 'warn',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'off',
      'no-regex-spaces': 'warn',
      'no-misleading-character-class': 'warn',
      'no-extra-semi': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-fallthrough': 'warn',
      'prefer-const': 'warn',
    },
  },

  // ── React renderer — hooks linting ───────────────────────────────────
  // Registers the react-hooks plugin so the renderer's existing inline
  // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments
  // resolve to a real rule (without the plugin they were "rule not found"
  // errors). rules-of-hooks stays an error (real bugs); exhaustive-deps is
  // a warning to start.
  {
    files: ['renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
