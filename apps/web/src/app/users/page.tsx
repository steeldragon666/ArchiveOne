'use client';
import Link from 'next/link';
import { AuthGuard } from '@/components/auth-guard';
import { Button } from '@/components/ui/button';
import { UsersTable } from '@/components/users-table';
import { useUsers } from '@/hooks/use-users';
import { useWhoami } from '@/hooks/use-whoami';

export default function UsersPage() {
  return (
    <AuthGuard>
      <Inner />
    </AuthGuard>
  );
}

function Inner() {
  const whoami = useWhoami();
  const users = useUsers();

  if (whoami.data?.user.role !== 'admin') {
    return (
      <main className="container mx-auto py-8 px-4">
        <p className="text-slate-500">Admin role required to manage firm members.</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Firm members</h1>
        <Button asChild>
          <Link href="/users/new">Add user</Link>
        </Button>
      </div>

      {users.isLoading && <p className="text-slate-500">Loading…</p>}
      {users.error && <p className="text-red-500">Failed to load users. Refresh to retry.</p>}
      {users.data && <UsersTable users={users.data} />}
    </main>
  );
}
