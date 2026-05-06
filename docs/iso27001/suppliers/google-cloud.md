# Supplier Assessment — Google Cloud (GCP)

**ISO 27001 Reference:** Annex A controls A.5.19-A.5.22

| Field                | Value                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------- |
| Supplier             | Google Cloud (GCP)                                                                     |
| Parent company       | Google LLC (Alphabet Inc.)                                                             |
| Document Owner       | Aaron                                                                                  |
| Last Reviewed        | 2026-05-06                                                                             |
| Next Review          | 2027-05-06                                                                             |
| Classification       | Internal                                                                               |
| Risk Rating          | Medium                                                                                 |
| Services in scope    | Cloud Run, Cloud SQL for PostgreSQL, Secret Manager, Cloud Build, Cloud DNS, Cloud Monitoring, Cloud Logging, Artifact Registry |
| Data classification  | Restricted (production database + all platform data)                                   |
| Primary region       | australia-southeast1 (Sydney)                                                          |
| Failover region      | australia-southeast2 (Melbourne, backup)                                               |
| DPA status           | Accepted via Google Cloud Terms of Service (Data Processing Amendment)                 |
| ISO 27001 cert       | ISO/IEC 27001:2013 — all GCP infrastructure                                           |
| SOC 2 Type II        | Yes (all GCP services)                                                                 |

---

## 1. Service Description

CPA Platform uses the following GCP services in production:

| Service              | Purpose                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| Cloud Run            | Containerised API (Fastify) and web frontend (Next.js 15); auto-scales to zero; each service deployed via Artifact Registry image |
| Cloud SQL (Postgres 16) | Production managed PostgreSQL database with pgvector extension; Row-Level Security enforced at application layer |
| Secret Manager       | Centralised storage for all production secrets (database credentials, API keys, JWT secrets); no secrets in source code or environment variables at build time |
| Cloud Build          | CI/CD pipeline — builds container images from source, runs automated tests, pushes to Artifact Registry |
| Artifact Registry    | Container image registry for all production deployments; images tagged by `$BUILD_ID`  |
| Cloud DNS            | DNS hosting for production domain; managed zone with DNSSEC                            |
| Cloud Monitoring     | Uptime checks, alerting policies, SLO monitoring for Cloud Run and Cloud SQL            |
| Cloud Logging        | Centralised structured log aggregation; log sinks for compliance retention; Cloud Audit Logs capture admin and data-access events |

---

## 2. Data Processing

The following data categories are processed by GCP on behalf of CPA Platform:

| Data Category        | GCP Services Involved                    | Classification | Description                                                                 |
| -------------------- | ---------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| Production database  | Cloud SQL                                | Restricted     | All claimant records, R&DTI activities, eligible expenditures, project narratives, audit logs, prompt review records |
| Container runtime    | Cloud Run                                | Restricted     | All data flowing through the API and web frontend during request processing  |
| Secrets              | Secret Manager                           | Restricted     | All production credentials — database connection strings, JWT secrets, third-party API keys |
| Application logs     | Cloud Logging                            | Confidential   | Structured request logs; no customer PII in structured log fields by policy |
| Audit logs           | Cloud Logging (Cloud Audit Logs)         | Confidential   | Admin activity, data access, and system event logs for GCP resource operations |
| Build artefacts      | Cloud Build, Artifact Registry           | Internal       | Compiled container images, build logs; no customer data included            |

---

## 3. Security Certifications

GCP holds the following independent certifications relevant to CPA Platform:

| Certification                 | Scope                        | Notes                                                                           |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| ISO/IEC 27001:2013            | All GCP infrastructure       | Covers information security management system across all regions including australia-southeast1 |
| SOC 2 Type II                 | All GCP services             | Annual audit; covers security, availability, and confidentiality trust principles |
| ISO/IEC 27017:2015            | Cloud-specific security      | Code of practice for information security controls for cloud services            |
| ISO/IEC 27018:2019            | Cloud privacy                | Code of practice for protection of PII in public clouds                         |
| PCI DSS Level 1               | Selected GCP services        | Relevant if payment processing is in scope in future phases                      |
| IRAP (Australian)             | Selected GCP services        | GCP has IRAP PROTECTED assessment for selected services; account team to confirm scope for australia-southeast1 |

Reference: https://cloud.google.com/security/compliance

Note: Specific certification scope documents are maintained by Google and available via the GCP Console Compliance Reports Manager. Do not rely on this document for the authoritative certificate list — retrieve current certificates annually from the GCP Console.

---

## 4. Data Residency and Sovereignty

### 4.1 Region Configuration

| Region                    | Role                 | Services                                     |
| ------------------------- | -------------------- | -------------------------------------------- |
| australia-southeast1 (Sydney)   | Primary production   | Cloud Run, Cloud SQL (primary), Secret Manager, Cloud Build, Artifact Registry, Cloud DNS, Cloud Monitoring, Cloud Logging |
| australia-southeast2 (Melbourne) | Failover / backup   | Cloud SQL PITR backup replica only           |

All production data is stored and processed within Australia. No cross-region replication to non-Australian regions is configured.

### 4.2 Contractual Data Residency Commitment

Google's Data Processing Amendment (DPA), accepted as part of the Google Cloud Terms of Service, commits Google to:

- Processing customer data only in the regions specified by the customer in their service configuration
- Not transferring customer data outside those regions except as strictly required to provide the service
- Applying appropriate safeguards consistent with the Australian Privacy Act 1988

### 4.3 Australian Privacy Act 1988

GCP's DPA covers Australian Privacy Principles (APPs) compliance for data processed on behalf of CPA Platform. Australian Privacy Act 1988 obligations for cross-border disclosures (APP 8) are addressed by the contractual data residency commitment and GCP's regional isolation.

---

## 5. Risk Assessment

| Factor                 | Assessment | Rationale                                                                                      |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Data sensitivity       | Restricted | Production database and all platform data; highest sensitivity tier                            |
| Service criticality    | Critical   | No immediate alternative; all compute, database, secrets, and CI/CD run on GCP                |
| Certification coverage | Strong     | ISO 27001 + SOC 2 Type II + ISO 27017/27018; independent annual audits                        |
| Data residency         | Australia  | australia-southeast1 locked; DPA contractual commitment                                        |
| Incident history       | None       | No known GCP incidents affecting CPA Platform (service not yet live as of 2026-05-06)          |

**Overall Risk Rating: Medium**

Rationale for Medium (downgraded from initial High): The initial register used "High" as a placeholder for an unnamed hosting provider. GCP's verified ISO 27001 and SOC 2 Type II certifications, combined with contractual Australian data residency, reduce the residual risk to Medium. Criticality remains high (no alternative), but likelihood is reduced by GCP's certified security controls. Medium rating is appropriate under the CPA Platform risk rating criteria.

### 5.1 Likelihood

**Low** — GCP infrastructure is highly reliable with documented SLAs. The shared responsibility model means GCP is responsible for infrastructure security; CPA Platform is responsible for application-level controls (RLS, IAM scoping, secret rotation).

### 5.2 Impact

**Critical** — All production data resides on GCP. A significant availability or confidentiality incident would affect all claimants and all R&DTI claim data. RTO is measured in hours (Cloud SQL failover + Cloud Run re-deploy).

### 5.3 Mitigations

| Control                        | Implementation                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Data residency                 | All resources deployed in australia-southeast1; no non-AU regions configured                   |
| Encryption at rest             | AES-256 by GCP default on Cloud SQL and Secret Manager; no additional key management required at current scale |
| Encryption in transit          | TLS 1.3 for all Cloud Run ingress; Cloud SQL connections use SSL enforced at instance level     |
| Row-Level Security             | RLS enforced at application layer via `app.current_tenant_id` GUC; applies regardless of GCP administrative access |
| PITR — Cloud SQL               | Point-in-time recovery enabled with 7-day retention; daily backups to australia-southeast2     |
| Restore drills                 | Restore procedures documented and executed via `tools/gcp/cloudsql-restore-drill.sh`           |
| Secret management              | All secrets in Secret Manager; no secrets in source code, container images, or build logs       |
| Least-privilege IAM            | `cpa-deploy` service account holds only required roles; principle of least privilege applied    |
| Cloud Audit Logs               | Admin Activity and Data Access logs enabled; exported to long-term log sink                    |
| Vulnerability management       | Cloud Run images rebuilt and redeployed on each `main` push; base image pinned to latest stable |

---

## 6. Contractual Agreements

| Agreement                              | Status                             | Notes                                                    |
| -------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| Google Cloud Customer Agreement        | Accepted by account owner          | Governing agreement for all GCP services                 |
| Google Cloud Data Processing Amendment | Accepted 2026-05-06                | DPA covering all data processed by GCP on CPA Platform's behalf |
| Google Cloud Terms of Service          | Accepted                           | Incorporated by reference into Customer Agreement        |

**Action required:** Obtain signed DPA confirmation PDF from Google Cloud Console and store at:

```
docs/iso27001/suppliers/evidence/google-cloud-dpa-2026.pdf
```

This evidence file is required for ISO 27001 audit. It is to be retrieved post-initial-setup from the GCP Console under **IAM & Admin → Organization Policies → Data Processing Amendment**.

---

## 7. Incident History

| Date | Incident | Impact on CPA Platform | Resolution |
| ---- | -------- | ---------------------- | ---------- |
| —    | No incidents recorded | Service not yet live as of 2026-05-06 | —         |

GCP publishes real-time and historical status at https://status.cloud.google.com

CPA Platform subscribes to the GCP Status RSS feed for `australia-southeast1`. Any GCP-declared incident affecting services in scope triggers a supplier review per section 6 of the Supplier Risk Register.

---

## 8. Annual Review Checklist

The following checks are performed at each annual review (next: 2027-05-06):

- [ ] Retrieve current ISO 27001 certificate from GCP Console Compliance Reports Manager; confirm scope includes australia-southeast1
- [ ] Retrieve current SOC 2 Type II report; review any exceptions relevant to CPA Platform services
- [ ] Confirm data residency settings: verify no non-AU regions are configured in GCP project
- [ ] Review IAM bindings for `cpa-deploy` service account; remove any roles granted beyond minimum required
- [ ] Review Cloud Audit Log export policy; confirm log sink is active and retention meets requirements
- [ ] Verify Google Cloud DPA is still current with Google's latest published version
- [ ] Run Cloud SQL restore drill via `tools/gcp/cloudsql-restore-drill.sh`; document RTO achieved
- [ ] Review GCP pricing and contract terms for any changes that affect data processing obligations
- [ ] Update this document with review findings and increment Next Review date

---

## 9. References

- Supplier Risk Register: `docs/iso27001/suppliers/supplier-register.md`
- Classification scheme: `docs/iso27001/asset-management/classification-scheme.md`
- Risk assessment methodology: `docs/iso27001/03-risk-assessment-methodology.md`
- GCP security compliance: https://cloud.google.com/security/compliance
- GCP status: https://status.cloud.google.com
- Google Cloud DPA evidence: `docs/iso27001/suppliers/evidence/google-cloud-dpa-2026.pdf` (to be obtained post-setup)
