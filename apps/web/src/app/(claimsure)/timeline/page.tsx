import { redirect } from 'next/navigation';

// Legacy System B route. Evidence + timeline live inside the per-claim
// detail view at `/claims/:id?tab=evidence` / `?tab=timeline`.
export default function TimelinePage() {
  redirect('/pipeline');
}
