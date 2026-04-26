'use client';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSwitchTenant } from '@/hooks/use-switch-tenant';

interface TenantSummary {
  tenantId: string;
  name: string;
  slug: string;
  role: 'admin' | 'consultant' | 'viewer';
  isDefault: boolean;
}

interface Props {
  tenants: TenantSummary[];
  activeTenantId: string | null;
}

export function TenantSwitcher({ tenants, activeTenantId }: Props) {
  const switchTenant = useSwitchTenant();
  const active = tenants.find((t) => t.tenantId === activeTenantId);

  if (tenants.length === 0) {
    return <div className="text-sm text-slate-500">No firms</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={switchTenant.isPending}>
          {active?.name ?? 'Select firm'}
          <ChevronsUpDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {tenants.map((t) => (
          <DropdownMenuItem
            key={t.tenantId}
            onClick={() => switchTenant.mutate(t.tenantId)}
            className="cursor-pointer"
          >
            {t.tenantId === activeTenantId ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <span className="mr-2 inline-block w-4" />
            )}
            <span className="flex-1">{t.name}</span>
            <span className="text-xs text-slate-400 ml-2">{t.role}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
