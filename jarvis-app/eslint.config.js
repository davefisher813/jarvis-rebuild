// LAW GATE (hotfix 2026-08-15): rules-of-hooks, as a build gate.
//
// Why this exists: TodayFlow shipped with two effects BELOW an early loading
// return. tsc cannot see hook order, tests rendered nothing loading-gated, and
// the result was React #310 crashing the entire app behind the error boundary
// on every real load. This config runs ONE rule at error level so that exact
// class of bug can never ship again. It is intentionally minimal: not a style
// linter, a correctness gate. Runs in CI/gates via `npm run lint`.
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps stays off: the codebase manages deps deliberately
      // (documented eslint-disable comments mark the intentional spots).
    },
  },
];
