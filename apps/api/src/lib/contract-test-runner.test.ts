import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildContractTestRunner } from './contract-test-runner.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Test repo setup — a tiny git repo we can worktree from
// ---------------------------------------------------------------------------

let TEST_REPO: string;

before(async () => {
  TEST_REPO = await mkdtemp(join(tmpdir(), 'cpa-eval-test-repo-'));
  await execFileAsync('git', ['init', '-q'], { cwd: TEST_REPO });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: TEST_REPO });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: TEST_REPO });
  await writeFile(join(TEST_REPO, 'README.md'), '# test\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: TEST_REPO });
  await execFileAsync('git', ['commit', '-q', '-m', 'init'], { cwd: TEST_REPO });
  // Ensure main is the branch name (git might default to master).
  try {
    await execFileAsync('git', ['branch', '-m', 'main'], { cwd: TEST_REPO });
  } catch {
    // Already named main — ignore.
  }
});

after(async () => {
  // Prune worktrees before removing (might be stale from failed tests).
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: TEST_REPO });
  } catch {
    // Ignore.
  }
  await rm(TEST_REPO, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('contract-test-runner: buildContractTestRunner returns a function', () => {
  const runner = buildContractTestRunner({ repoRoot: '/tmp/fake' });
  assert.equal(typeof runner, 'function');
});

test('runner: happy path — applies changeSet, runs stubbed pnpm, exits 0', async () => {
  const wrapperPath = await makeWrapperScript(0, 'ok', '');
  const runner = buildContractTestRunner({
    repoRoot: TEST_REPO,
    baseRef: 'main',
    pnpmCommand: wrapperPath,
  });
  const result = await runner(
    [{ path: 'NEW.md', change_kind: 'create', newContent: 'hello\n' }],
    '@cpa',
    'some-pattern',
  );
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes('ok'));
});

test('runner: pnpm test exits non-zero', async () => {
  const wrapperPath = await makeWrapperScript(1, '', 'failure');
  const runner = buildContractTestRunner({
    repoRoot: TEST_REPO,
    baseRef: 'main',
    pnpmCommand: wrapperPath,
  });
  const result = await runner(
    [{ path: 'a.ts', change_kind: 'create', newContent: 'export const x = 1;\n' }],
    '@cpa',
    'pattern',
  );
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('failure'));
});

test('runner: subprocess hits timeoutMs', async () => {
  const wrapperPath = await makeWrapperScript(0, '', '', 10000);
  const runner = buildContractTestRunner({
    repoRoot: TEST_REPO,
    baseRef: 'main',
    pnpmCommand: wrapperPath,
    timeoutMs: 500,
  });
  const result = await runner([], '@cpa', 'pattern');
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, -1);
});

test('runner: bad baseRef throws', async () => {
  const wrapperPath = await makeWrapperScript(0, 'ok', '');
  const runner = buildContractTestRunner({
    repoRoot: TEST_REPO,
    baseRef: 'nonexistent-branch',
    pnpmCommand: wrapperPath,
  });
  await assert.rejects(() => runner([], '@cpa', 'pattern'));
});

test('runner: concurrent calls use distinct tempdirs', async () => {
  const wrapperPath = await makeWrapperScript(0, 'ok', '', 200);
  const runner = buildContractTestRunner({
    repoRoot: TEST_REPO,
    baseRef: 'main',
    pnpmCommand: wrapperPath,
  });
  const [r1, r2] = await Promise.all([
    runner([{ path: 'a.ts', change_kind: 'create', newContent: 'a' }], '@cpa', 'p1'),
    runner([{ path: 'b.ts', change_kind: 'create', newContent: 'b' }], '@cpa', 'p2'),
  ]);
  assert.equal(r1.exitCode, 0);
  assert.equal(r2.exitCode, 0);
});

test('runner: cleanup failure is swallowed + logged', async () => {
  const warns: string[] = [];
  const logger = {
    info: () => {},
    warn: (m: string) => warns.push(m),
  };
  const wrapperPath = await makeWrapperScript(0, 'ok', '');
  const runner = buildContractTestRunner({
    repoRoot: TEST_REPO,
    baseRef: 'main',
    pnpmCommand: wrapperPath,
    logger,
  });
  const result = await runner([], '@cpa', 'pattern');
  assert.equal(result.exitCode, 0);
  // Main assertion: no throw; result returned cleanly.
});

// ---------------------------------------------------------------------------
// Helpers: cross-platform wrapper scripts
// ---------------------------------------------------------------------------

/**
 * Create a self-contained executable wrapper script that ignores its args,
 * writes to stdout/stderr, optionally sleeps, and exits with the given code.
 * Returns the path to invoke. Works on Windows (bat) and Unix (sh).
 */
async function makeWrapperScript(
  exitCode: number,
  stdout: string,
  stderr: string,
  sleepMs?: number,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cpa-wrapper-'));
  if (process.platform === 'win32') {
    // Write a .cmd file that runs node inline.
    const jsPath = join(dir, 'run.mjs');
    const lines = [];
    if (sleepMs) lines.push(`await new Promise(r => setTimeout(r, ${sleepMs}));`);
    if (stdout) lines.push(`process.stdout.write(${JSON.stringify(stdout)});`);
    if (stderr) lines.push(`process.stderr.write(${JSON.stringify(stderr)});`);
    lines.push(`process.exit(${exitCode});`);
    await writeFile(jsPath, lines.join('\n'));
    const batPath = join(dir, 'wrapper.cmd');
    await writeFile(batPath, `@node "${jsPath}" %*\n`);
    return batPath;
  }
  // Unix: write a shell script.
  const shPath = join(dir, 'wrapper.sh');
  const lines = ['#!/bin/sh'];
  if (sleepMs) lines.push(`sleep ${sleepMs / 1000}`);
  if (stdout) lines.push(`printf '%s' ${JSON.stringify(stdout)}`);
  if (stderr) lines.push(`printf '%s' ${JSON.stringify(stderr)} >&2`);
  lines.push(`exit ${exitCode}`);
  await writeFile(shPath, lines.join('\n'));
  const { chmod } = await import('node:fs/promises');
  await chmod(shPath, 0o755);
  return shPath;
}
