import type { ChoreographyChangedFile, ContractTestResult } from '@cpa/integrations/github-app';

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

/**
 * Factory that returns a {@link ContractTestRunner}. Production wiring
 * calls this once at startup in `apps/api/src/server.ts`; the returned
 * closure captures repoRoot and config so each invocation only needs
 * the per-request change set.
 *
 * Implementation lands in Task 4 of the issue #27 plan.
 */
export function buildContractTestRunner(_opts: BuildContractTestRunnerOptions): ContractTestRunner {
  return () => {
    return Promise.reject(
      new Error('contract-test-runner: not yet implemented (Task 4 of issue #27 plan)'),
    );
  };
}
