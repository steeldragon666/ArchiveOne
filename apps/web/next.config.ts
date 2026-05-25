import path from 'node:path';
import type { NextConfig } from 'next';

function resolveApiUrl(): string {
  const envVar = process.env.API_URL;
  if (envVar && envVar !== '') return envVar;
  if (process.env.NODE_ENV === 'production') return 'http://api:3000';
  return 'http://localhost:3000';
}

const API_URL = resolveApiUrl();
// eslint-disable-next-line no-console
console.log('[next.config] API_URL rewrite target:', API_URL);

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  async rewrites() {
    return [
      {
        source: '/v1/:path*',
        destination: `${API_URL}/v1/:path*`,
      },
    ];
  },
  reactStrictMode: true,
};

export default nextConfig;
