// One-shot: mint an 8h session JWT for Aaron so I can paste it into the
// browser's cookie store and keep working. Uses the same `signSession`
// the API verifies against on each request.
import { signSession } from '@cpa/auth';

const token = await signSession(
  {
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'aaron@carbonproject.com.au',
    primaryIdp: 'microsoft',
    activeTenantId: '00000000-0000-0000-0000-000000000010',
    activeRole: 'admin',
    availableTenants: [{ tenantId: '00000000-0000-0000-0000-000000000010', role: 'admin' }],
  },
  process.env.SESSION_JWT_SECRET ?? 'dev-only-local-secret-do-not-use-in-prod-1234567890abcdef',
  { ttlSeconds: 8 * 3600 },
);

console.log(token);
