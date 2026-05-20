import type { Metadata } from 'next';
import { AllocationClient } from './client';

export const metadata: Metadata = { title: 'Activity Allocation' };

export default function AllocationPage() {
  return <AllocationClient />;
}
