'use client';
import { use } from 'react';
import { AppShell } from '@/components/app-shell';
import { EditUserForm } from '@/components/edit-user-form';
import { useUser } from '@/hooks/use-user';
import { useWhoami } from '@/hooks/use-whoami';

export default function EditUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return (
    <AppShell>
      <Inner userId={userId} />
    </AppShell>
  );
}

function Inner({ userId }: { userId: string }) {
  const whoami = useWhoami();
  const user = useUser(userId);

  if (whoami.data?.user.role !== 'admin') {
    return <p className="text-sm text-muted-foreground">Admin role required.</p>;
  }

  if (user.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (user.error || !user.data) {
    return <p className="text-sm text-destructive">Failed to load user.</p>;
  }

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Administration
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Edit firm member</h1>
      </header>
      <EditUserForm user={user.data} />
    </div>
  );
}
