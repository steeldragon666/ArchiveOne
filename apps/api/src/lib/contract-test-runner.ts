import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import type { ChoreographyChangedFile, ContractTestResult } from '@cpa/integrations/github-app';

const execFileAsync = promisify(execFile);

/**
 * Extended change-file shape that includes the proposed new content.
 * The runner materializes these into the worktree before running tests.
 */
export interface ChoreographyChangedFileWithContent extends ChoreographyChangedFile {
  newContent?: string;
}

/**
 * Contract-test runner signature. Takes the proposed change set, a pnpm
 * workspace filter, and a test-name-pattern. Returns the subprocess
 * result including exit code, stdout, stderr, and whether a timeout fired.
 */
export type ContractTestRunner = (
  changeSet: ChoreographyChangedFileWithContent[],
  packageFilter: string,
  testPattern: string,
) => Promise<ContractTestResult>;

export interface BuildContractTestRunnerOptions {
  /** Repo root for the `git worktree add` command. */
  repoRoot: string;
  /** Defaults to 'origin/main'. */
  baseRef?: string;
  /** Hard cap on the pnpm subprocess. Defaults to 5 minutes. */
  timeoutMs?: number;
  /** Logger for structured info/warn lines. Defaults to a no-op. */
  logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
  };
  /** DI seam — defaults to 'pnpm'. Tests can pass a stub script. */
  pnpmCommand?: string;
}

const noopLogger = { info: () => {}, warn: () => {} };

/**
 * Factory that returns a {@link ContractTestRunner}. Production wiring
 * calls this once at startup in `apps/api/src/server.ts`; the returned
 * closure captures repoRoot and config so each invocation only needs
 * the per-request change set.
 */
export function buildContractTestRunner(opts: BuildContractTestRunnerOptions): ContractTestRunner {
  const baseRef = opts.baseRef ?? 'origin/main';
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const pnpmCommand = opts.pnpmCommand ?? 'pnpm';
  const logger = opts.logger ?? noopLogger;

  return async (changeSet, packageFilter, testPattern) => {
    const startedAt = Date.now();
    const dir = await mkdtemp(join(tmpdir(), 'cpa-eval-'));

    try {
      // 1. Create worktree at baseRef (detached so no branch conflict).
      await execFileAsync('git', ['worktree', 'add', '--detach', dir, baseRef], {
        cwd: opts.repoRoot,
      });

      // 2. Apply changeSet.
      for (const f of changeSet) {
        const filePath = join(dir, f.path);
        if (f.change_kind === 'delete') {
          await rm(filePath, { force: true });
        } else {
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, f.newContent ?? '');
        }
      }

      // 3. Spawn pnpm subprocess.
      const result = await runPnpmSubprocess({
        pnpmCommand,
        cwd: dir,
        packageFilter,
        testPattern,
        timeoutMs,
      });

      logger.info('contract-test-runner: completed', {
        exitCode: result.exitCode,
        latencyMs: Date.now() - startedAt,
        timedOut: result.timedOut,
        stdoutBytes: Buffer.byteLength(result.stdout),
        stderrBytes: Buffer.byteLength(result.stderr),
      });

      return result;
    } finally {
      // 4. Cleanup — best-effort, never throws.
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', dir], {
          cwd: opts.repoRoot,
        });
      } catch (err) {
        logger.warn('contract-test-runner: worktree-remove failed', {
          error: (err as Error).message,
        });
      }
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (err) {
        logger.warn('contract-test-runner: rm failed', {
          error: (err as Error).message,
        });
      }
    }
  };
}

/**
 * Spawn the pnpm test subprocess, capturing stdout/stderr and enforcing
 * a timeout via SIGKILL. Returns a structured result.
 */
async function runPnpmSubprocess(args: {
  pnpmCommand: string;
  cwd: string;
  packageFilter: string;
  testPattern: string;
  timeoutMs: number;
}): Promise<ContractTestResult & { timedOut: boolean }> {
  const pnpmArgs = [
    '--filter',
    args.packageFilter,
    'test',
    '--',
    '--test-name-pattern',
    args.testPattern,
  ];

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(args.pnpmCommand, pnpmArgs, {
      cwd: args.cwd,
      env: process.env,
      // On Windows, .cmd/.bat files (including pnpm) require shell: true.
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, args.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 1_000_000) stdout = stdout.slice(0, 1_000_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 1_000_000) stderr = stderr.slice(0, 1_000_000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          stdout,
          stderr,
          exitCode: timedOut ? -1 : typeof code === 'number' ? code : -1,
          timedOut,
        });
      }
    });
  });
}
