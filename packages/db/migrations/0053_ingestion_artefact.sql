CREATE TABLE ingestion_artefact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  subject_tenant_id uuid NOT NULL REFERENCES subject_tenant(id),
  source_filename text NOT NULL,
  source_mimetype text NOT NULL,
  source_sha256 text NOT NULL,
  parser_kind text NOT NULL,
  parser_version text NOT NULL,
  extracted_text text,
  extracted_structure jsonb,
  classified_evidence_kind text,
  classified_confidence numeric,
  uploaded_by uuid REFERENCES employee(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_tenant_id, source_sha256)
);

ALTER TABLE ingestion_artefact ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingestion_artefact
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
