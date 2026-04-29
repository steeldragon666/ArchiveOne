import { test } from 'node:test';

/**
 * The activity detail page is a React component composing AuthGuard +
 * useQuery + ActivityEditor. apps/web has no jsdom in its node:test
 * runner, so the page-level interaction (load, render, save flow,
 * toast) is exercised end-to-end via Playwright in T-A10.
 *
 * Pure-function logic in the editor (the diff helper) is unit-tested
 * in `_components/activity-editor.test.tsx`. This file is kept as a
 * marker so the plan's "page + component + test" trio is visible in
 * the tree, but it intentionally contains no DOM-level assertions.
 */
test.todo('activity detail page: full DOM coverage in T-A10 Playwright e2e');
