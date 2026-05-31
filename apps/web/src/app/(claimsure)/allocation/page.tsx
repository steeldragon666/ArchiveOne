import { redirect } from 'next/navigation';

// Legacy System B route. Real claim allocation lives in the per-claim
// wizard at `/claims/:id` (step 4 — Apportionment). Pipeline is the
// closest top-level landing.
export default function AllocationPage() {
  redirect('/pipeline');
}
