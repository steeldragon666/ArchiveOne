import type { Metadata } from 'next';
import { DashboardClient } from './client';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * /dashboard — the Claimsure shell home. DashboardClient internally
 * wraps its body in AuthGuard so anonymous users land on the approved-
 * signup flow instead of seeing placeholder fixture data (task #66).
 */
export default function DashboardPage() {
  return <DashboardClient />;
}
