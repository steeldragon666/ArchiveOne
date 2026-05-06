import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Response types (local mirrors — @cpa/db is not imported by apps/web)
// ---------------------------------------------------------------------------

export interface FormCompletenessResponse {
  complete: boolean;
  checks: {
    knowledge_search: {
      complete: boolean;
      missing_activity_ids: string[];
    };
    beneficial_ownership: {
      complete: boolean;
      count: number;
    };
    forecast: {
      complete: boolean;
      missing_offsets: number[];
    };
    facilities: {
      complete: boolean;
      count: number;
    };
    narratives: {
      complete: boolean;
      warnings: {
        activity_id: string;
        field: string;
        current_length: number;
        min_required: number;
        max_allowed: number;
      }[];
    };
  };
}

export interface BeneficialOwnershipRow {
  id: string;
  tenant_id: string;
  subject_tenant_id: string;
  fy_label: string;
  owner_kind: 'individual' | 'entity' | 'foreign_entity' | 'associate';
  owner_name: string;
  owner_country: string | null;
  /** postgres-js returns numeric columns as strings — use Number() for arithmetic */
  ownership_pct: string;
  is_associate: boolean;
  is_foreign_related: boolean;
  ta_2023_4_flag: boolean | null;
  ta_2023_5_flag: boolean | null;
  first_recorded_at: string;
  created_at: string;
}

export interface BeneficialOwnershipInput {
  subject_tenant_id: string;
  fy_label: string;
  owner_kind: 'individual' | 'entity' | 'foreign_entity' | 'associate';
  owner_name: string;
  owner_country?: string;
  ownership_pct: number;
  is_associate: boolean;
  is_foreign_related: boolean;
}

export interface KnowledgeSearchInput {
  subject_tenant_id: string;
  activity_id: string;
  search_date: string;
  search_query: string;
  sources_consulted: string[];
  finding_summary: string;
}

export interface KnowledgeSearchRow {
  id: string;
  subject_tenant_id: string;
  activity_id: string;
  search_date: string;
  search_query: string;
  sources_consulted: string[];
  finding_summary: string;
  first_recorded_at: string;
}

export interface FacilityInput {
  subject_tenant_id: string;
  fy_label: string;
  facility_name: string;
  address: string;
  is_owned: boolean;
  used_for_activity_ids: string[];
}

export interface FacilityRow {
  id: string;
  subject_tenant_id: string;
  fy_label: string;
  facility_name: string;
  address: string;
  is_owned: boolean;
  used_for_activity_ids: string[];
  first_recorded_at: string;
}

export interface ForecastInput {
  subject_tenant_id: string;
  base_fy_label: string;
  forecast_year_offset: 1 | 2 | 3;
  projected_spend_aud: number;
  projected_headcount: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface ForecastRow {
  id: string;
  subject_tenant_id: string;
  base_fy_label: string;
  forecast_year_offset: 1 | 2 | 3;
  /** postgres-js returns numeric columns as strings — use Number() for arithmetic */
  projected_spend_aud: string;
  projected_headcount: number;
  confidence: 'low' | 'medium' | 'high';
  first_recorded_at: string;
}

export interface MultiEntityScanInput {
  subject_tenant_id: string;
}

export interface AtRiskSummaryResponse {
  subject_tenant_id: string;
  fy_label: string;
  total_claimed: number;
  total_at_risk: number;
  activities: {
    activity_id: string;
    title: string;
    claimed_amount: number;
    at_risk_amount: number;
    clawback_4yr: number;
  }[];
}

// ---------------------------------------------------------------------------
// Typed fetch helpers
// ---------------------------------------------------------------------------

export function getFormCompleteness(subject: string, fy: string) {
  return apiFetch<FormCompletenessResponse>(`/v1/compliance/form-completeness/${subject}/${fy}`);
}

export function getBeneficialOwnership(subject: string, fy: string) {
  return apiFetch<{ rows: BeneficialOwnershipRow[] }>(
    `/v1/compliance/beneficial-ownership/${subject}/${fy}`,
  );
}

export function postBeneficialOwnership(input: BeneficialOwnershipInput) {
  return apiFetch<BeneficialOwnershipRow>('/v1/compliance/beneficial-ownership', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getKnowledgeSearchRecords(subject: string, fy: string) {
  return apiFetch<{ rows: KnowledgeSearchRow[] }>(
    `/v1/compliance/knowledge-search/${subject}/${fy}`,
  );
}

export function postKnowledgeSearch(input: KnowledgeSearchInput) {
  return apiFetch<KnowledgeSearchRow>('/v1/compliance/knowledge-search', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getFacilities(subject: string, fy: string) {
  return apiFetch<{ rows: FacilityRow[] }>(`/v1/compliance/facilities/${subject}/${fy}`);
}

export function postFacility(input: FacilityInput) {
  return apiFetch<FacilityRow>('/v1/compliance/facilities', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getForecasts(subject: string, fy: string) {
  return apiFetch<{ rows: ForecastRow[] }>(`/v1/compliance/forecast/${subject}/${fy}`);
}

export function postForecast(input: ForecastInput) {
  return apiFetch<ForecastRow>('/v1/compliance/forecast', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function postMultiEntityScan(input: MultiEntityScanInput) {
  return apiFetch<{ status: string; message: string }>('/v1/compliance/multi-entity-scan', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getAtRiskSummary(subject: string, fy: string) {
  return apiFetch<AtRiskSummaryResponse>(`/v1/compliance/at-risk-summary/${subject}/${fy}`);
}
