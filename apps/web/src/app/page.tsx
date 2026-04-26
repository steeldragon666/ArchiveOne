'use client';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { TenantSwitcher } from '@/components/tenant-switcher';
import { Button } from '@/components/ui/button';
import { useWhoami } from '@/hooks/use-whoami';

export default function Dashboard() {
  return (
    <AuthGuard>
      <DashboardInner />
    </AuthGuard>
  );
}

function DashboardInner() {
  const { data } = useWhoami();
  if (!data) return null;

  const activeTenant = data.availableTenants.find((t) => t.tenantId === data.user.tenantId);

  return (
    <main className="container mx-auto py-8 px-4">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">CPA Platform</h1>
        <div className="flex gap-3 items-center">
          <TenantSwitcher tenants={data.availableTenants} activeTenantId={data.user.tenantId} />
          <SignoutButton />
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold mb-2">Welcome, {data.user.email}</h2>
          {activeTenant ? (
            <p className="text-slate-600">
              Active firm: <strong>{activeTenant.name}</strong> · Role: {activeTenant.role}
            </p>
          ) : (
            <p className="text-slate-600">No active firm — contact your firm admin to be added.</p>
          )}
        </div>

        {data.user.role === 'admin' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Admin actions</h2>
            <Button asChild variant="outline">
              <Link href="/users">Manage firm members</Link>
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

function SignoutButton() {
  const handleSignout = () => {
    void fetch('/v1/auth/signout', {
      method: 'POST',
      credentials: 'include',
    }).then(() => {
      window.location.href = '/login';
    });
  };
  return (
    <Button type="button" variant="ghost" onClick={handleSignout}>
      Sign out
    </Button>
  );
}
