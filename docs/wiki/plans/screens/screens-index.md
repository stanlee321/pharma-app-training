---
type: index
updated: 2026-07-10
tags: [index, screens, build-spec]
---
# Screen Build Specs — Index

This folder holds the **per-screen frontend build contracts** (plan-derived): for each
screen, what to reuse, what to build, the entities/DTOs it captures, and the REST
endpoints it calls. It complements [[proposed-screens]] (the screen set), [[rest-contract]]
(the backend surface), and [[ux-components]] (the shared widgets). For the cross-screen
component list, endpoint check, CaseStore surface, prerequisite layers and build order,
see the rollup: [[screen-build-rollup]].

**Status (2026-07-10): all 14 screens are BUILT (Phase A + B) and the frontend compiles + links**
against the in-memory `MockCaseStore` (commits `9945a93`, `6ef5b11`). The readiness column below
reflects the *original* plan-derived analysis; the CaseStore blocker is now resolved (mock), so
remaining work is backend / Phase-0 / fill-pdf, not the screens themselves.

Rows are ordered by the **build sequence** from [[screen-build-rollup]] §5 (dependency-safe).

| # | Screen | Entities | # endpoints | Readiness |
|---|---|---|---|---|
| 0 | [[login\|Login (mock)]] | — (mock auth; sets author, ADR-3) | 0 | **near-ready** (no CaseStore) |
| 1 | [[encounter-list\|N1 — Encounter List]] | AnesthesiaCase (read-all) | 3 | blocked — CaseStore + `GET`/`POST /cases` |
| 2 | [[encounter-hub\|N2 — Encounter Hub]] | AnesthesiaCase (root envelope) | 2 | blocked — CaseStore |
| 3 | [[patient-data\|3′ — Patient Data]] | Patient | 2 | blocked — CaseStore + N1/N2 |
| 4 | [[preanesthetic-assessment\|N3 — Preanesthetic Assessment]] | PreanestheticAssessment | 2 | **near-ready** |
| 5 | [[technique-general\|N4a — Technique · General]] | AnestheticTechnique + DrugAdministration | 3 | blocked — CaseStore + schema bridge |
| 6 | [[technique-neuraxial\|N4b — Technique · Neuraxial]] | AnestheticTechnique | 2 | blocked — CaseStore + schema bridge |
| 7 | [[technique-peripheral\|N4c — Technique · Peripheral Block]] | AnestheticTechnique | 2 | blocked — CaseStore + technique model/components |
| 8 | [[transanesthetic-monitoring\|N5 — Transanesthetic Monitoring]] | TransanestheticRecord | 2 | blocked — CaseStore + Encounter root |
| 9 | [[drug-ledger\|N6 — Drug Ledger]] | DrugAdministration (many) | 4 | blocked — CaseStore (TCI half ready) |
| 10 | [[fluid-balance\|N7 — Fluid Balance]] | FluidBalance (+ Patient, Drug read) | 2 | blocked — CaseStore + grid components + derive hooks |
| 11 | [[recovery-aldrete\|N8 — Recovery (Aldrete)]] | RecoveryScore | 2 | blocked — CaseStore + Encounter root |
| 12 | [[newborn-record\|N9 — Newborn Record]] | NewbornRecord (0..n) | 4 | blocked — CaseStore |
| 13 | [[review-export\|N10 — Review & Export]] | CaseAggregate (read-all, 9 entities) | 2 | blocked — fill-pdf + [[field-crosswalk]] |

**Tally:** of 14 screens (incl. the [[login|mock login]] gate), **2 near-ready** ([[login]],
[[preanesthetic-assessment]]), 12 blocked — dominant blocker is the persistence/CaseStore port
(ADR-2).

→ See [[screen-build-rollup]] for the prerequisite layers and the full dependency-ordered
build order.
