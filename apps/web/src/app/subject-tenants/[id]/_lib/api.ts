import type { Claim, Employee, Event as ApiEvent } from '@cpa/schemas';
import { apiFetch } from '@/lib/api';

// =====================================================================
// Claim create
// =====================================================================

/**
 * POST /v1/claims body. Mirrors {@link CreateClaimBody} in
 * packages/schemas/src/claim.ts. `tenant_id` is derived from the session
 * server-side — clients never send it.
 *
 * `fiscal_year` follows Australian convention: 2025 = FY ending June 2025.
 * `stage` defaults to 'engagement' server-side; omit unless seeding a
 * mid-pipeline claim (e.g. migrating a prior-year submission).
 */
export interface CreateClaimInput {
  subject_tenant_id: string;
  fiscal_year: number;
  stage?: string;
  ausindustry_reference?: string;
}

/**
 * POST /v1/claims. Returns the created claim row.
 *
 * Response shape: `{ claim: Claim }` — unwrapped to the inner Claim so
 * callers can write `const created = await createClaim(input)` (mirrors
 * createSubjectTenant in ../../../subject-tenants/_lib/api.ts).
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (subject_tenant_id not in firm)
 *   - 409 → ConflictError (duplicate fiscal_year for this subject_tenant)
 */
export async function createClaim(input: CreateClaimInput): Promise<Claim> {
  const body = await apiFetch<{ claim: Claim }>('/v1/claims', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.claim;
}

// =====================================================================
// Employee create
// =====================================================================

/**
 * POST /v1/employees body. Mirrors {@link createEmployeeBody} in
 * packages/schemas/src/employee.ts. `tenant_id` is derived from the session
 * server-side — clients never send it.
 */
export interface CreateEmployeeInput {
  subject_tenant_id: string;
  email: string;
  name: string;
  job_title?: string;
  payroll_external_id?: string;
  payroll_provider?: string;
}

/**
 * POST /v1/employees. Returns the created employee row.
 *
 * Response shape: `{ employee: Employee }` — unwrapped to the inner Employee.
 *
 * Typed errors from apiFetch:
 *   - 403 → ForbiddenError (viewer role)
 *   - 404 → NotFoundError (subject_tenant_id not in firm)
 *   - 409 → ConflictError (email already exists under this subject_tenant)
 */
export async function createEmployee(input: CreateEmployeeInput): Promise<Employee> {
  const body = await apiFetch<{ employee: Employee }>('/v1/employees', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return body.employee;
}

// =====================================================================
// Evidence upload (metadata-only via POST /v1/events)
// =====================================================================

/**
 * Input for {@link uploadEvidence}.
 *
 * API flow — metadata-only upload via POST /v1/events:
 *
 * The binary upload pipeline (POST /v1/media/presigned-upload →
 * PUT to S3 → POST /v1/media/finalize) requires a mobile JWT
 * (`requireMobileSession`). There is no consultant-session binary
 * upload endpoint in v1. The consultant upload path therefore
 * records chain-of-custody metadata — filename, MIME type, byte
 * size, and SHA-256 content hash — as a structured `raw_text`
 * event via `POST /v1/events` (`requireSession`). The classifier
 * tags it as `SUPPORTING` (the catch-all evidence kind for
 * supplementary material that doesn't fit a more specific kind).
 *
 * Chain-of-custody guarantee: the client-computed SHA-256 hex
 * digest is embedded in the event's immutable `raw_text` field.
 * An auditor can verify the file hasn't been substituted by
 * re-hashing the current blob and comparing to the chain value.
 *
 * When the real S3/consultant-upload route ships (post v1),
 * this function can be upgraded to the three-step presigned
 * flow without changing the call sites — the same query
 * invalidations and error handling apply.
 *
 * TODO(post-v1): swap this to POST /v1/media/presigned-upload →
 * PUT → POST /v1/media/finalize once a consultant-session upload
 * endpoint is available. Track alongside the mobile upload route
 * refactor in apps/api/src/routes/media.ts.
 */
export interface UploadEvidenceInput {
  subject_tenant_id: string;
  file: File;
  sha256: string;
  description?: string;
  captured_at?: string;
  /** Plain text extracted client-side from the file body (optional). */
  extracted_text?: string;
}

/**
 * POST /v1/events — metadata-only evidence upload.
 *
 * Formats file metadata as a structured `raw_text` string so the
 * classifier can tag it correctly (→ SUPPORTING) and the event
 * feed renders a meaningful summary. Returns the created event.
 *
 * Typed errors from apiFetch (same surface as createClaim):
 *   - 403 → ForbiddenError (viewer role cannot post events)
 *   - 409 → ConflictError (duplicate idempotency key — same hash
 *            submitted twice; the caller surfaces this as "already
 *            uploaded")
 *   - 404 → NotFoundError (subject_tenant_id not in firm)
 */
export async function uploadEvidence(input: UploadEvidenceInput): Promise<ApiEvent> {
  const sizeKb = (input.file.size / 1024).toFixed(1);
  const lines: string[] = [
    `[FILE UPLOAD] ${input.file.name}`,
    `Type: ${input.file.type || 'application/octet-stream'}`,
    `Size: ${sizeKb} KB`,
    `SHA-256: ${input.sha256}`,
  ];
  if (input.description) {
    lines.push(`Description: ${input.description}`);
  }
  // Append extracted text so the classifier reads actual document content
  // rather than just the filename. This is the primary mechanism that lets
  // the AI classifier produce "HYPOTHESIS 0.87" instead of "DESIGN 0.65 —
  // without access to file contents…". The text was extracted client-side
  // before the SHA-256 step (mammoth/pdfjs/xlsx) and is included verbatim.
  if (input.extracted_text && input.extracted_text.length > 0) {
    lines.push(`Extracted-Text:\n${input.extracted_text}`);
  }
  const raw_text = lines.join('\n');

  const payload: {
    subject_tenant_id: string;
    raw_text: string;
    captured_at?: string;
  } = { subject_tenant_id: input.subject_tenant_id, raw_text };
  if (input.captured_at) {
    payload.captured_at = input.captured_at;
  }

  const body = await apiFetch<{ event: ApiEvent }>('/v1/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return body.event;
}
