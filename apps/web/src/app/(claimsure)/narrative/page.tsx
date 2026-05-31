import { redirect } from 'next/navigation';

// Legacy System B route. Narrative drafting now lives inside the per-claim
// wizard at `/claims/:id` (step 4).
export default function NarrativePage() {
  redirect('/pipeline');
}
