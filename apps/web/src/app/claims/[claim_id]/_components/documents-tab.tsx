'use client';

/**
 * Documents tab — links to the three claim-deliverable PDFs.
 *
 * Placeholder for C4 — eventually shows download links for:
 *   1. R&D Activity statement (C7 narrative bundle).
 *   2. Expenditure schedule (C8).
 *   3. Cover letter / submission package (C9).
 *
 * Each PDF is generated server-side from the claim's data via Swimlane
 * F's PDF rendering pipeline and stored against the claim. Until those
 * land we just communicate intent.
 */
export function DocumentsTab({ claimId: _claimId }: { claimId: string }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">Documents coming in C7-C9.</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {/* TODO(C7-C9): three PDF download links — R&D Activity statement (C7),
            Expenditure schedule (C8), Cover letter / submission package (C9). */}
        Pending C7 (Activity statement), C8 (Expenditure schedule), C9 (Cover letter).
      </p>
    </div>
  );
}
