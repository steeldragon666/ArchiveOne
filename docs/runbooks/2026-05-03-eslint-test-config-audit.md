# ESLint test-file lint cleanup — debug + audit report

**Date:** 2026-05-03
**Triggered by:** P6 retro skeleton item — "apps/api lint cleanup (191 errors)"
**Outcome:** the "191 errors" claim was stale. **Real count: 2347 errors monorepo-wide.** All in test files. All from one missing config piece. **Fix is 11 small JSON edits, not a 2347-line code rewrite.**

---

## Phase 1: Gather data

```
$ pnpm --filter @cpa/api lint
✖ 1976 problems (1976 errors, 0 warnings)
```

Per-package counts:

| Package              | Lint errors |
| -------------------- | ----------- |
| `@cpa/api`           | **1976**    |
| `@cpa/integrations`  | 248         |
| `@cpa/agents`        | 79          |
| `@cpa/auth`          | 44          |
| `@cpa/db`            | 0           |
| `@cpa/schemas`       | 0           |
| `@cpa/audit-score`   | 0           |
| `@cpa/observability` | 0           |
| `@cpa/documents`     | 0           |
| **Total**            | **2347**    |

By rule (apps/api, representative):

| Rule                                                | Count | %   |
| --------------------------------------------------- | ----- | --- |
| `@typescript-eslint/no-unsafe-call`                 | 1102  | 56% |
| `@typescript-eslint/no-unsafe-member-access`        | 551   | 28% |
| `@typescript-eslint/no-unsafe-assignment`           | 260   | 13% |
| `@typescript-eslint/no-unsafe-return`               | 41    | 2%  |
| `@typescript-eslint/no-redundant-type-constituents` | 10    | <1% |
| Other                                               | 12    | <1% |

By file type:

| File type                          | Errors          |
| ---------------------------------- | --------------- |
| `*.test.ts` (49 files)             | **1976 (100%)** |
| Production code (`*.ts`, non-test) | 0               |

Top 5 offending files (apps/api):

| File                                            | Errors |
| ----------------------------------------------- | ------ |
| `src/routes/narrative.test.ts`                  | 193    |
| `src/jobs/expenditure-classify.test.ts`         | 93     |
| `src/jobs/activity-register-synthesize.test.ts` | 79     |
| `src/routes/mapping-rules.test.ts`              | 78     |
| `src/routes/activities.test.ts`                 | 78     |

## Phase 2: Categorize / hypothesize

**77% (1514 of 1976)** of errors carry the literal phrase `could not be resolved` or `cannot be resolved`:

```
Unsafe use of a template tag whose type could not be resolved
Unsafe call of a type that could not be resolved
Unsafe member access .id on a type that cannot be resolved
```

The remaining 462 are downstream cascades on `error type` values (ESLint can't tell what the type IS, so any operation on it is flagged).

**Hypothesis:** the test-file ESLint config can't resolve types from cross-package imports.

## Phase 3: Root cause

### The eslint config's test-file override

`eslint.config.mjs` lines 35–54:

```js
{
  files: ['**/*.test.{ts,tsx,mts,cts}'],
  languageOptions: {
    parserOptions: {
      projectService: false,
      project: ['**/tsconfig.test.json'],   // ← LEGACY PROJECT GLOB
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: { '@typescript-eslint/no-floating-promises': 'off' },
},
```

Test files are routed through `tsconfig.test.json` instead of the projectService default. Reasonable rationale (the main `tsconfig.json` excludes test files and the projectService would refuse to lint them).

### The smoking gun: test tsconfigs have NO `references`

Every `apps/<x>/tsconfig.json` and `packages/<x>/tsconfig.json` has a `references` array listing its workspace dependencies. **`tsconfig.test.json` files have NONE.** Example:

`apps/api/tsconfig.json`:

```json
"references": [
  { "path": "../../packages/schemas" },
  { "path": "../../packages/db" },
  { "path": "../../packages/agents" },
  // ... 6 more
]
```

`apps/api/tsconfig.test.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "rootDir": "./src" },
  "include": ["src/**/*.test.ts"]
  // NO references — and references are NOT inherited via `extends`
}
```

When typescript-eslint resolves types via `tsconfig.test.json`, it has no idea where `@cpa/db`, `@cpa/agents`, etc. live. Every cross-package import resolves to **error type**. The `recommendedTypeChecked` rule family then produces `no-unsafe-*` for every operation on those values.

`tsc --build` typecheck succeeds because it walks the references graph differently — it builds dependents first and the type-info-emit means importers find their declarations on disk. ESLint's project mode does NOT walk references the same way.

### Why packages with 0 errors are clean

| Package              | Lint errors | Reason                                                                           |
| -------------------- | ----------- | -------------------------------------------------------------------------------- |
| `@cpa/db`            | 0           | Test files only import from itself + `node:` builtins — no cross-package imports |
| `@cpa/schemas`       | 0           | Same — schemas is a leaf in the dep graph                                        |
| `@cpa/audit-score`   | 0           | Tests don't import from `@cpa/db`                                                |
| `@cpa/observability` | 0           | No cross-package test imports                                                    |
| `@cpa/documents`     | 0           | Tests are pure (no DB / no schemas)                                              |

**Rule:** packages whose test files have ANY cross-package import lose type resolution → produce errors. Packages whose tests are self-contained are fine.

`@cpa/api` is the worst because every route test imports from `@cpa/db`, `@cpa/schemas`, `@cpa/auth`, `@cpa/agents`, etc.

## Proposed fix

### Option A (recommended): add `references` to each test tsconfig

Mirror the corresponding non-test tsconfig's references. Specifically:

| Test tsconfig                               | Add references                            |
| ------------------------------------------- | ----------------------------------------- |
| `apps/api/tsconfig.test.json`               | All 9 packages api references             |
| `apps/web/tsconfig.test.json`               | (check `apps/web/tsconfig.json`)          |
| `packages/agents/tsconfig.test.json`        | `../db`, `../observability`, `../schemas` |
| `packages/auth/tsconfig.test.json`          | `../db`, `../schemas`                     |
| `packages/audit-score/tsconfig.test.json`   | `../db`                                   |
| `packages/db/tsconfig.test.json`            | `../schemas`                              |
| `packages/integrations/tsconfig.test.json`  | `../db`, `../observability`, `../schemas` |
| `packages/documents/tsconfig.test.json`     | (check)                                   |
| `packages/observability/tsconfig.test.json` | (none)                                    |
| `packages/schemas/tsconfig.test.json`       | (leaf — none)                             |
| `tools/scripts/tsconfig.test.json`          | (check)                                   |

**Effort:** ~30 min (11 JSON edits + verify lint clean).
**Risk:** very low — these are config-only. The references are exactly what `tsc --build` already uses successfully.
**Effect:** drops error count from 2347 → expected ~0 (or a small residual of genuine type-safety issues that are currently masked by the error-type cascade — those would be real bugs worth fixing one-by-one).

### Option B: revert to `projectService: true` for test files

Try removing the override, relying on the projectService to find tsconfig.test.json via `allowDefaultProject`. Risk: projectService may refuse files that aren't in the closest tsconfig.json's includes — would need to add a allowDefaultProject pattern, which has its own issues.

Less surgical than Option A. Skip unless Option A turns out not to fix the problem.

### Option C: scope-disable the `no-unsafe-*` family for test files

```js
files: ['**/*.test.{ts,tsx,mts,cts}'],
rules: {
  '@typescript-eslint/no-unsafe-call': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/no-unsafe-return': 'off',
  '@typescript-eslint/no-unsafe-argument': 'off',
}
```

Trades type-safety for clean lint. **Don't do this** — production-shaped bugs in test fixtures (e.g., a `payload.proposed_id` typo) would slip through. Option A keeps the rules' value and fixes the underlying resolution failure.

## Proposed validation plan

1. Pick `apps/api/tsconfig.test.json` first (highest error count). Add the 9 references mirroring `apps/api/tsconfig.json`.
2. Run `pnpm --filter @cpa/api lint`. Expect: drop from 1976 → near-zero.
3. If errors remain, sample 5 to determine if they're (a) genuine type-safety issues now visible, or (b) a different unresolved-type class.
4. Repeat for `@cpa/integrations` (248 → near-zero).
5. Repeat for `@cpa/agents` (79 → near-zero).
6. Repeat for `@cpa/auth` (44 → near-zero).
7. Verify no production-package regressions: `pnpm -r typecheck` clean (no schema/dep change should affect this — sanity check).
8. Open PR: `fix(*): add references to test tsconfigs so eslint can resolve cross-package types`.

## Estimated outcome

If Option A works (~95% likely):

- Error count: 2347 → 0–50 (residual genuine issues)
- Files changed: ~5 test tsconfig.json (whichever ones lacked references)
- LOC delta: ~25 net lines added (a few `{ "path": "..." }` per file)
- Risk: very low (config-only)

If Option A reveals genuine type-safety gaps masked by the resolution failure:

- Triage the residual errors. They're now visible only because resolution works again.
- Most likely shape: postgres-js result rows typed as `unknown` or `Record<string, unknown>` — fix one-by-one with explicit `<RowType>` generics on `sql<T[]>\`...\`` calls. ~5–20 sites.

## Update needed in the P6 retro skeleton

`docs/retros/2026-05-DD-p6-retro.md` open follow-ups currently lists:

> apps/api lint cleanup (191 pre-existing `no-unsafe-*` warnings)

Replace with:

> apps/api + 3 other packages lint cleanup (~2347 errors total). Root-caused 2026-05-03: test tsconfigs lack `references`. Fix is ~5 JSON edits, not a code rewrite. See `docs/runbooks/2026-05-03-eslint-test-config-audit.md`.

## Why this matters beyond cleaning up CI noise

1. **CI noise hides real signal.** When 2347 lint errors are noise, a 2348th genuine error is invisible. Fixing the resolution issue makes the rules useful again.
2. **Test type-safety matters.** The `no-unsafe-*` rules catch real bugs (e.g., a typo in `payload.field_name` that would silently return undefined and fail the test for the wrong reason). With resolution broken, those rules effectively don't run on test code.
3. **Future contributors will hit this immediately.** A new test file → 30+ lint errors that don't reproduce locally if they use a different tsconfig path. Frustrating UX.

The fix is small. The leverage is large. Recommended for a separate PR.
