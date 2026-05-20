import type { Metadata } from 'next';
import { SubmitClient } from './client';

export const metadata: Metadata = { title: 'Submit Claim' };

export default function SubmitPage() {
  return <SubmitClient />;
}
