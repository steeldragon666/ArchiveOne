'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'consultant' | 'viewer';
  isDefault: boolean;
  addedAt: string;
}

export function UsersTable({ users }: { users: UserRow[] }) {
  if (users.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 p-8 text-center text-slate-500">
        No firm members yet. Click "Add user" to invite the first one.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Default</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell>
              <div className="font-medium">{u.email}</div>
              {u.displayName && <div className="text-xs text-slate-400">{u.displayName}</div>}
            </TableCell>
            <TableCell>{u.role}</TableCell>
            <TableCell>{u.isDefault ? 'Yes' : 'No'}</TableCell>
            <TableCell className="text-xs text-slate-500">
              {new Date(u.addedAt).toLocaleDateString()}
            </TableCell>
            <TableCell className="text-right">
              <Button asChild size="sm" variant="outline">
                <Link href={`/users/${u.id}`}>Edit</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
