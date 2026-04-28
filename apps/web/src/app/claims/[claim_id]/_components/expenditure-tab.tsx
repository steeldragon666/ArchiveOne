'use client';

/**
 * Expenditure tab — mapping UI for tying expenditure rows to activities.
 *
 * Placeholder for C4 — full UI lands in C5. The mapping flow walks the
 * consultant through the `expenditure` and `expenditure_mapping_rule`
 * tables (see packages/schemas/src/expenditure*.ts) so an activity can
 * roll up an apportioned cost figure.
 */
export function ExpenditureTab({ claimId: _claimId }: { claimId: string }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">Expenditure mapping coming in C5.</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {/* TODO(C5): wire to expenditure mapping UI (rows ↔ activity allocation rules). */}
        Pending C5: Expenditure mapping.
      </p>
    </div>
  );
}
