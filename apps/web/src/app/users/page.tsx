'use client';
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { UsersTable } from '@/components/users-table';
import { useUsers } from '@/hooks/use-users';
import { useWhoami } from '@/hooks/use-whoami';

export default function UsersPage() {
  return (
    <AppShell>
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const whoami = useWhoami();
  const users = useUsers();

  if (whoami.data?.user.role !== 'admin') {
    return (
      <div className="space-y-8">
        <header className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Administration
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Firm members</h1>
        </header>
        <EmptyState
          icon="users"
          title="Admin access required"
          description="Admin role required to manage firm members. Contact your firm administrator."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Administration
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Firm members</h1>
          <p className="text-muted-foreground max-w-2xl">
            Consultants and viewers with access to the active firm. Admins can invite teammates and
            adjust roles.
          </p>
        </div>
        <Button asChild>
          <Link href="/users/new">Add user</Link>
        </Button>
      </header>

      {users.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {users.error && (
        <p className="text-sm text-destructive">Failed to load users. Refresh to retry.</p>
      )}
      {users.data && users.data.length === 0 && (
        <EmptyState
          icon="users"
          title="No teammates yet"
          description="You're the only person with access to this firm. Invite a colleague to get started."
          action={{ label: 'Add the first user', href: '/users/new' }}
        />
      )}
      {users.data && users.data.length > 0 && <UsersTable users={users.data} />}
    </div>
  );
}
