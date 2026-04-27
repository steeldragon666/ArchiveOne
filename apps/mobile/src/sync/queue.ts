import { getDb } from '../db/client.js';

/**
 * mobile_event_queue row in TS shape.
 *
 * SQLite stores `payload` as a JSON string (TEXT). Callers serialise
 * before enqueue and parse on read — keeps the sync dispatcher generic
 * across kinds without forcing a discriminated union at the table level.
 */
export type QueueKind = 'event' | 'media_artefact' | 'time_entry' | 'signing_response';
export type QueueStatus = 'queued' | 'syncing' | 'synced' | 'failed';

export type QueueRow = {
  local_id: string;
  kind: QueueKind;
  payload: string; // JSON
  created_at: number;
  status: QueueStatus;
  remote_id: string | null;
  retry_count: number;
  last_error: string | null;
};

export type EnqueueArgs = {
  local_id: string;
  kind: QueueKind;
  /** Already-stringified JSON. Caller decides the shape. */
  payload: string;
};

/** Insert a new row at status='queued'. */
export async function enqueue(args: EnqueueArgs): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO mobile_event_queue
       (local_id, kind, payload, created_at, status, retry_count)
     VALUES (?, ?, ?, ?, 'queued', 0)`,
    args.local_id,
    args.kind,
    args.payload,
    Date.now(),
  );
}

/**
 * Pull the next row eligible for sync — oldest queued or previously
 * failed-but-still-retriable. Returns null when the queue is drained.
 */
export async function nextQueued(): Promise<QueueRow | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<QueueRow>(
    `SELECT local_id, kind, payload, created_at, status, remote_id, retry_count, last_error
       FROM mobile_event_queue
      WHERE status IN ('queued', 'failed')
      ORDER BY created_at ASC
      LIMIT 1`,
  );
  return row ?? null;
}

/** Mark a row in-flight. Caller must call markSynced or markFailed after. */
export async function markSyncing(local_id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE mobile_event_queue SET status = 'syncing' WHERE local_id = ?`,
    local_id,
  );
}

/** Terminal-success: row stays for audit but won't be re-tried. */
export async function markSynced(local_id: string, remote_id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE mobile_event_queue
       SET status = 'synced', remote_id = ?, last_error = NULL
     WHERE local_id = ?`,
    remote_id,
    local_id,
  );
}

/**
 * Bump retry_count + record last_error. Status flips back to 'failed'
 * so nextQueued() picks it up again on the next drain pass (subject to
 * the worker's max-attempts cap).
 */
export async function markFailed(local_id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE mobile_event_queue
       SET status = 'failed',
           retry_count = retry_count + 1,
           last_error = ?
     WHERE local_id = ?`,
    error,
    local_id,
  );
}

/** Used by the F16 indicator + Swimlane-B UI to show queue depth. */
export async function countPending(): Promise<number> {
  const db = await getDb();
  const result = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM mobile_event_queue WHERE status IN ('queued', 'failed', 'syncing')`,
  );
  return result?.n ?? 0;
}
