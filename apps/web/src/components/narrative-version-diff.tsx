'use client';

/**
 * P7 Theme C Task C.3 — Narrative version diff component.
 *
 * Displays narrative draft versions side-by-side or sequentially with
 * forensic metadata (first_recorded_at) visible on each version card.
 * The full diff/comparison functionality lands in C.5; this initial
 * version establishes the component with forensic metadata display.
 */

export interface NarrativeVersionEntry {
  id: string;
  version: number;
  generation_kind: string;
  content_hash: string;
  created_at: string;
}

/** Truncate a hex hash to 8 chars for readability. */
export function truncateVersionHash(hash: string): string {
  return hash.length > 8 ? hash.slice(0, 8) : hash;
}

export function NarrativeVersionDiff({ versions }: { versions: NarrativeVersionEntry[] }) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="narrative-diff-empty">
        No narrative versions available.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="narrative-version-diff">
      {versions.map((v) => (
        <div
          key={v.id}
          className="rounded border border-border bg-card px-3 py-2 text-sm"
          data-testid={`narrative-version-${v.version}`}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-medium">v{v.version}</span>
            <span className="text-xs text-muted-foreground">{v.generation_kind}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {truncateVersionHash(v.content_hash)}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground" data-testid="first-recorded-at">
            First recorded: {new Date(v.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
