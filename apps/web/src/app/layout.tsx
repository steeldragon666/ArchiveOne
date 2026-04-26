import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'CPA Platform',
  description: 'Australian R&D Tax Incentive consultant portal',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
