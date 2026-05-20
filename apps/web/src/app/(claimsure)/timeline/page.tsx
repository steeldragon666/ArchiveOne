import type { Metadata } from 'next';
import { TimelineClient } from './client';

export const metadata: Metadata = { title: 'Evidence & Timeline' };

export default function TimelinePage() {
  return <TimelineClient />;
}
