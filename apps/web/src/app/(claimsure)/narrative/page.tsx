import type { Metadata } from 'next';
import { NarrativeClient } from './client';

export const metadata: Metadata = { title: 'Narrative' };

export default function NarrativePage() {
  return <NarrativeClient />;
}
