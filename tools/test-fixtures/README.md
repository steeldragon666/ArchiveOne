# Test-case fixtures

Ten distinct scenarios that together exercise every upload pipeline and
the major event-chain kinds the platform supports. The `seed-test-cases`
script loads them into the local Postgres so you can drive the consultant
portal, wizard, expenditure mapping, and narrative views against real
rows without manually composing claims.

```
pnpm exec tsx --env-file=../../.env tools/scripts/seed-test-cases.ts
```

The script is idempotent — it deletes any prior run's data (scoped to the
`c0test*` UUID namespace) before reseeding. Postgres must be up at port
5433 (`pnpm db:up`) and migrations applied (`pnpm db:migrate`).

## What gets created

One firm tenant, one consultant user, one subject_tenant (the claimant
company), one project, one claim, and two activities (CORE + SUPPORTING).
All ten cases attach to that one claim so the consultant workspace shows
them as a single book of evidence.

## The ten cases

Each fixture file documents the upload that the platform would have
received from a real user. The seed script reads the file, then writes
the equivalent post-upload state: an event-chain row (with classification
metadata where appropriate), or an `expenditure` row plus chain events,
or both.

| #   | Fixture                        | Models the upload of                                                                               | Exercises                                                                                                                         |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 01  | `01-hypothesis.txt`            | Pasted hypothesis text (consultant capture)                                                        | `HYPOTHESIS` event kind                                                                                                           |
| 02  | `02-observation.txt`           | Pasted lab observation (consultant capture)                                                        | `OBSERVATION` event kind                                                                                                          |
| 03  | `03-time-log.txt`              | Pasted daily time log entry                                                                        | `TIME_LOG` event kind                                                                                                             |
| 04  | `04-whiteboard-photo.json`     | Image upload (whiteboard.jpg)                                                                      | `EVIDENCE_UPLOADED` with image metadata + EXIF                                                                                    |
| 05  | `05-lab-notebook.json`         | PDF upload (lab-notebook-p47.pdf)                                                                  | `EVIDENCE_UPLOADED` with extracted PDF text                                                                                       |
| 06  | `06-narrative-draft.json`      | DOCX upload (narrative-vant7.docx)                                                                 | `EVIDENCE_UPLOADED` with mammoth-extracted activities + invoices                                                                  |
| 07  | `07-calculations.json`         | XLSX upload (quench-calcs.xlsx)                                                                    | `EVIDENCE_UPLOADED` with sheet-by-sheet extracted text                                                                            |
| 08  | `08-xero-invoice.json`         | Xero invoice sync (Bluescope Labs $11,750)                                                         | `EXPENDITURE_INGESTED` + `EXPENDITURE_MAPPED` chain                                                                               |
| 09  | `09-voice-transcript.json`     | Voice-note upload (.m4a) with auto-transcript                                                      | `EVIDENCE_UPLOADED` with audio metadata + transcript                                                                              |
| 10  | `10-multi-activity-claim.json` | Full FY26 claim seed: 5 expenditures, 3 activities, mixed evidence, apportionment, narrative draft | All of: `EXPENDITURE_INGESTED`, `EXPENDITURE_MAPPED`, `EXPENDITURE_APPORTIONED`, `ACTIVITY_REGISTER_DRAFTED`, `NARRATIVE_DRAFTED` |

After seeding, hit the consultant portal at `/claims/<claim_id>` to see
the evidence stream, expenditure mapping table, and narrative draft pane
populated. The claim ID is printed at the end of the script.

## Note on file binaries

These fixtures carry the **extracted content** that the client-side
parser (mammoth / pdfjs / xlsx / sharp) would have produced. Actual
binary files are not bundled — the test cases verify the data path
through the chain, projection, and views, not the parser itself. To
test the parser path end-to-end, upload a real file via the evidence
vault UI; the platform stores the same `extracted_content` shape.
