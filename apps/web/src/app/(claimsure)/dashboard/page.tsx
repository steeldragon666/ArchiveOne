import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * /dashboard — legacy Claimsure-shell home. The (claimsure) route group
 * + components/claimsure/* are retired System B; the live consultant
 * dashboard is the System A workspace at `/consultant`. This page now
 * server-redirects so old bookmarks + tests continue to land somewhere
 * useful instead of rendering hardcoded fixture data.
 */
export default function DashboardPage() {
  redirect('/consultant');
}
