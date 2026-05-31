import { z } from 'zod';
import { Iso8601, Uuid } from './primitives.js';

/**
 * Per-employee R&D % allocation per TR 2021/5. Migration 0097.
 *
 * `activity_id` is OPTIONAL — NULL means "applies across all R&D
 * activities in this claim". The schema-level UNIQUE on
 * (employee_id, claim_id, activity_id) means a single (employee,claim)
 * pair can have at most one claim-wide row and any number of per-activity
 * rows; the mutually-exclusive rule ("either one OR the other, not both")
 * is enforced in the application layer (route handler) because Postgres
 * can't express partial UNIQUE with a NULL-distinct mode that fits this
 * pattern cleanly.
 */
export const EmployeeRdAllocation = z.object({
  id: Uuid,
  tenant_id: Uuid,
  claim_id: Uuid,
  employee_id: Uuid,
  activity_id: Uuid.nullable(),
  rd_percentage: z.number().int().min(0).max(100),
  basis_note: z.string().max(2000).nullable(),
  created_at: Iso8601,
  created_by_user_id: Uuid,
  updated_at: Iso8601,
});
export type EmployeeRdAllocation = z.infer<typeof EmployeeRdAllocation>;

/** POST /v1/claims/:claim_id/employee-rd-allocations body. */
export const CreateEmployeeRdAllocationBody = z.object({
  employee_id: Uuid,
  activity_id: Uuid.nullable().optional(),
  rd_percentage: z.number().int().min(0).max(100),
  basis_note: z.string().max(2000).nullable().optional(),
});
export type CreateEmployeeRdAllocationBody = z.infer<typeof CreateEmployeeRdAllocationBody>;
