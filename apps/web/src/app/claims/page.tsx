import { redirect } from 'next/navigation';

/**
 * /claims — Claims tab (top-tab nav).
 *
 * Server-redirects to /pipeline, which already has the filter bar,
 * kanban/table toggle, and "Start a new claim" CTA. A previous client-
 * side useEffect→router.replace caused a flash + double navigation;
 * doing it server-side avoids any HTML being sent before the redirect.
 */
export default function ClaimsListPage() {
  redirect('/pipeline');
}
