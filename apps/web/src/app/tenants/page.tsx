'use client';
import { AppShell } from '@/components/app-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useWhoami } from '@/hooks/use-whoami';

export default function TenantsPage() {
  return (
    <AppShell>
      <Inner />
    </AppShell>
  );
}

function Inner() {
  const { data } = useWhoami();
  if (!data) return null;

  const activeId = data.user.tenantId;

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Administration
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">My firms</h1>
        <p className="text-muted-foreground max-w-2xl">
          Every firm you have access to. Switch firms from the header dropdown.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl font-medium">Memberships</CardTitle>
        </CardHeader>
        <CardContent>
          {data.availableTenants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No firm memberships yet. Ask your firm admin to add you.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firm</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.availableTenants.map((t) => (
                  <TableRow key={t.tenantId}>
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                    </TableCell>
                    <TableCell>{t.role}</TableCell>
                    <TableCell>{t.isDefault ? 'Yes' : 'No'}</TableCell>
                    <TableCell>
                      {t.tenantId === activeId ? (
                        <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
                          Active
                        </span>
                      ) : (
                        ''
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-sm text-muted-foreground mt-4">
            To switch firms, use the dropdown in the dashboard header.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
