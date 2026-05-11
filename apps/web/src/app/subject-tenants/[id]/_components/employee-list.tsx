'use client';
import { useQuery } from '@tanstack/react-query';
import { listEmployees } from '../_lib/mutations';
import { DeactivateEmployeeButton } from './deactivate-employee-button';
import { EditEmployeeButton } from './edit-employee-button';

interface Props {
  subjectTenantId: string;
}

/**
 * Employee list with edit + deactivate controls (Phase 4B).
 *
 * Fetches GET /v1/employees?subject_tenant_id=... and renders each active
 * employee as a row with inline Edit and Deactivate buttons. Deactivated
 * employees are hidden (the API returns only active employees by default).
 */
export function EmployeeList({ subjectTenantId }: Props) {
  const employees = useQuery({
    queryKey: ['employees', subjectTenantId],
    queryFn: () => listEmployees(subjectTenantId),
  });

  if (employees.isPending) {
    return <p className="text-sm text-muted-foreground">Loading employees…</p>;
  }
  if (employees.error) {
    return (
      <p className="text-sm text-destructive">
        Failed to load employees:{' '}
        {employees.error instanceof Error ? employees.error.message : 'Unknown error'}
      </p>
    );
  }

  const list = employees.data ?? [];

  if (list.length === 0) {
    return (
      <div className="rounded border-2 border-dashed border-border bg-transparent p-6 space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          No employees yet
        </p>
        <p className="text-sm text-muted-foreground">
          Use &ldquo;Add employee&rdquo; to invite the first team member.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {list.map((emp) => (
        <li
          key={emp.id}
          className="flex flex-wrap items-center gap-3 rounded border border-border bg-card px-4 py-3 text-sm"
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{emp.name}</p>
            <p className="text-muted-foreground truncate">{emp.email}</p>
            {emp.job_title ? (
              <p className="text-xs text-muted-foreground truncate">{emp.job_title}</p>
            ) : null}
          </div>
          {emp.deactivated_at !== null ? (
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Deactivated
            </span>
          ) : (
            <div className="flex items-center gap-1 shrink-0">
              <EditEmployeeButton employee={emp} subjectTenantId={subjectTenantId} />
              <DeactivateEmployeeButton employee={emp} subjectTenantId={subjectTenantId} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
