-- P7 Theme D Task D.13 Phase 5C — RIF connector URL fixups.
--
-- Two sources had stale URLs that returned HTTP 404:
--
--   1. ISA Findings
--      Old: https://www.industry.gov.au/science-technology-and-innovation/research-and-development-tax-incentive
--      New: https://www.industry.gov.au/science-technology-and-innovation/industry-innovation/research-and-development-tax-incentive
--      Reason: industry.gov.au restructured its Science/Technology section.
--
--   2. RSM AU R&DTI
--      Old: https://www.rsm.global/australia/insights/tax-insights/feed
--      New: https://www.rsm.global/australia/rss.xml
--      Reason: RSM removed the category-scoped feed; the site-wide RSS at
--              /australia/rss.xml is the only live feed. The industry_rss
--              connector already performs keyword filtering at event-insertion
--              time, so the broader feed is acceptable.
--
-- No sources are disabled — both URLs resolve with HTTP 200.

--> statement-breakpoint

UPDATE "regulatory_source"
SET "source_url" = 'https://www.industry.gov.au/science-technology-and-innovation/industry-innovation/research-and-development-tax-incentive'
WHERE "source_name" = 'ISA Findings';

UPDATE "regulatory_source"
SET "source_url" = 'https://www.rsm.global/australia/rss.xml'
WHERE "source_name" = 'RSM AU R&DTI';
