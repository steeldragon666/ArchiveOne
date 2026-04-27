import * as Network from 'expo-network';
import {
  nextQueued,
  markSyncing,
  markSynced,
  markFailed,
  type QueueRow,
} from './queue.js';

/**
 * Per-row dispatcher contract.
 *
 * Returns `{ remote_id }` on success or `{ error }` on failure. The
 * worker handles retry bookkeeping; the dispatcher is a pure mapping
 * from queue row → API call. Real implementations land in Swimlane A
 * (one fn per kind: event, media_artefact, time_entry, signing).
 */
export type DispatchResult = { remote_id?: string; error?: string };
export type Dispatcher = (row: QueueRow) => Promise<DispatchResult>;

/**
 * Retry policy — exponential backoff capped at 5 attempts.
 *
 * Index = retry_count BEFORE this attempt:
 *   0 → first try (no wait)
 *   1 → 1s wait
 *   2 → 2s
 *   3 → 4s
 *   4 → 8s
 *   5+ → give up (worker stops re-trying this row; it stays at
 *        status='failed' for the user to manually retry / inspect).
 */
const BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000];
export const MAX_ATTEMPTS = 5;

function backoffFor(retryCount: number): number {
  return BACKOFF_MS[retryCount] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
}

async function sleep(ms: number): Promise<void> {
  if (ms === 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/**
 * Drain the queue serially.
 *
 * - Quits early if offline; the F16 indicator already tells the user
 *   so silent failure here is fine.
 * - Hands each row to the dispatcher with `Idempotency-Key: local_id`
 *   semantics enforced by the dispatcher (it sees row.local_id).
 *   Server-side dedup is the safety net for double-sends.
 * - Stops on the first row that hits MAX_ATTEMPTS — deliberately
 *   conservative; one stuck row doesn't block the rest in the next
 *   drain pass because nextQueued orders by created_at and the stuck
 *   row's status remains 'failed' between passes (we DON'T mark it
 *   syncing twice in one pass).
 *
 * Returns the count of rows successfully synced this pass; the F16
 * indicator can use this for a "synced N events" toast later.
 */
export async function drainQueue(dispatch: Dispatcher): Promise<number> {
  if (!(await isOnline())) return 0;

  let synced = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const row = await nextQueued();
    if (!row) break;

    if (row.retry_count >= MAX_ATTEMPTS) {
      // Don't loop forever on a poison row; leave it for manual retry
      break;
    }

    await sleep(backoffFor(row.retry_count));
    await markSyncing(row.local_id);

    try {
      const result = await dispatch(row);
      if (result.remote_id) {
        await markSynced(row.local_id, result.remote_id);
        synced += 1;
      } else {
        await markFailed(row.local_id, result.error ?? 'unknown dispatch error');
        break; // back off — try again on next drain pass
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markFailed(row.local_id, msg);
      break;
    }
  }
  return synced;
}
