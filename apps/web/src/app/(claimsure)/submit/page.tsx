import { redirect } from 'next/navigation';

// Legacy System B route. Submission lives in the per-claim wizard
// at `/claims/:id` (step 5 — Generate / submit).
export default function SubmitPage() {
  redirect('/pipeline');
}
