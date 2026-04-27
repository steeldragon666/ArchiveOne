'use client';
import { use } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { EditUserForm } from '@/components/edit-user-form';
import { useUser } from '@/hooks/use-user';
import { useWhoami } from '@/hooks/use-whoami';

export default function EditUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return (
    <AuthGuard>
      <Inner userId={userId} />
    </AuthGuard>
  );
}

function Inner({ userId }: { userId: string }) {
  const whoami = useWhoami();
  const user = useUser(userId);

  if (whoami.data?.user.role !== 'admin') {
    return (
      <main className="container mx-auto py-8 px-4">
        <p className="text-slate-500">Admin role required.</p>
      </main>
    );
  }

  if (user.isLoading) {
    return (
      <main className="container mx-auto py-8 px-4">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }
  if (user.error || !user.data) {
    return (
      <main className="container mx-auto py-8 px-4">
        <p className="text-red-500">Failed to load user.</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-6">Edit firm member</h1>
      <EditUserForm user={user.data} />
    </main>
  );
}
