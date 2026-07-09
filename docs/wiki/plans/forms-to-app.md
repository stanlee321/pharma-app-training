---
type: plan
updated: 2026-07-09
tags: [plan, master, forms, e2e, roadmap]
---

# Master Plan — Forms → App: Collect · Render · Export

**The vision in one sentence:** a clinician enters anaesthesia data once in the app; it
flows as structured **entities** to a **backend** and is persisted in a **database** as the
**system of record** — and a **filled PDF is a subproduct**, rendered on demand from that
stored data for continuity with the paper the clinic uses today.

**Data-first, not paper-first.** The `paper → parse → schema/entities` pipeline in
`notebooks/` is *provenance* — how we reverse-engineered the field model to bootstrap this,
**not** the runtime flow. The database is the durable asset; the PDF is one projection of it,
with room for future outputs (reports, analytics, exchange formats).

This is the umbrella plan. It sequences three companion plans into one build:

- [[field-inventory]] — **what data exists**: ~471 inputs by control type, the
  derived/computed outputs, and the `fill-pdf` mapping.
- [[proposed-screens]] — **the app surfaces**: ~11 screens rooted at an Encounter, plus
  shared components and prerequisite layers.
- [[rest-contract]] — **the backend**: a FastAPI + Postgres service exposing the entity
  model and a server-side PDF export.

Grounded in the nine-entity model
([entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)), the schema
contract ([schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md)), the four
schemas under [`notebooks/forms/schema/`](../../../notebooks/forms/schema/nota2.schema.json),
and the existing app + pipeline ([[architecture]], [[parsing]], [[screens]]). **Respects
the [[frontend-audit-2026-07-09]]** — its findings gate Phase 0 below.

---

## 1. The end-to-end flow

**We replace the manual filling of these forms — with no OCR anywhere.** The clinician
enters data in the app instead of writing on the sheet; we persist it; and **we render**
the filled PDF from that data. Nothing scans, reads, or OCRs a document at runtime.

**Product flow (data-first):**

```
  user ─▶ frontend (SwiftUI) ─▶ entities ─▶ app/API ─▶ backend (FastAPI) ─▶ db (Postgres)
   enters data once           shared contract                              │  system of record
                                                                ┌──────────┴───────────┐
                                                            filled PDF (subproduct)  future outputs
                                                            WE render it from data    (reports/analytics)
```

**Provenance (one-time bootstrap — not the product, not OCR):**

```
  paper form ─[vector-extract / vision-reconstruct, ONCE, in notebooks/]─▶ field schema (bbox) ─▶ ENTITY model
```

This is how we reverse-engineered the field model + the print-faithful bbox geometry that
lets us render the filled PDF ourselves. It ran once; the product never reads a document.

Three stages of the product flow, each mapped to a companion plan:

1. **Collect** — native SwiftUI capture of all nine entities into a case-scoped model.
   Reuse the pharma spine (`PatientProfile`, `ChartCanvas`, `DrugModel`/TCI); build six
   net-new clinical screens. → [[proposed-screens]].
2. **Persist** — the app sends entities over REST to the FastAPI backend, stored in
   Postgres as the **system of record**. The durable, queryable clinical data is the
   primary product. → [[rest-contract]].
3. **Project (subproducts)** — render outputs *from* the stored data. The first is the
   **filled PDF**: the `fill-pdf` pass draws each value into its field bbox over the
   print-faithful 1:1 clone — the same sheet, filled by us instead of by hand. Previewed
   and exported in-app; the same data enables later outputs.
   → [[field-inventory]] §4 + [[rest-contract]] §2.4.

The filled PDF is a *projection* of the record — the clinic keeps its familiar paper output
while the structured data becomes the durable asset.

---

## 2. The chain: entities → screens → REST → backend

One model powers all four forms. Each entity threads through the whole stack:

| Entity ([model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)) | Card. | Screen ([[proposed-screens]]) | REST resource ([[rest-contract]]) | App anchor / status |
|---|---|---|---|---|
| [anesthesia-case](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md) | root | N2 Encounter Hub | `POST/GET/PATCH /cases` | **new** (nothing case-scoped today) |
| [patient](../../../notebooks/docs/parsing-wiki/entities/patient.md) | 1 | 3′ Patient Data (extend) | `GET/PUT /cases/{id}/patient` | **reuse** `PatientProfile` + `StepperRow` |
| [preanesthetic-assessment](../../../notebooks/docs/parsing-wiki/entities/preanesthetic-assessment.md) | 1 | N3 Preanesthetic | `GET/PUT …/preanesthetic-assessment` | **new** |
| [anesthetic-technique](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md) | 1 | N4a/b/c (split) | `GET/PUT …/anesthetic-technique` | **new** (~185 fields, split 3 ways) |
| [transanesthetic-record](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md) | 1 | N5 Monitoring | `GET/PUT …/transanesthetic-record` | **reuse** `ChartCanvas` |
| [drug-administration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md) | many | N6 Drug Ledger | `GET/POST …/drugs`, item CRUD | **reuse** `DrugModel` + TCI |
| [fluid-balance](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md) | 1 | N7 Fluid Balance | `GET/PUT …/fluid-balance` | **new** (85-cell hourly grid) |
| [recovery-score](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md) | 1×tp | N8 Recovery (Aldrete) | `GET/PUT …/recovery-score` | **new** (6×6 score grid) |
| [newborn-record](../../../notebooks/docs/parsing-wiki/entities/newborn-record.md) | 0..n | N9 Newborn (sheet) | `GET/POST …/newborns`, item CRUD | **new** (obstetric only) |

**The gap in one line:** the app owns the **PK spine** — 3 of 9 entities (Patient,
TransanestheticRecord, DrugAdministration) — but **computes** where the forms **record**,
persists nothing, and has no PDF/schema layer. The other **6 entities are entirely new**,
and **two whole architectural layers are missing**: the reverse `fill-pdf` export and any
REST/persistence. See [[field-inventory]] for the field-level detail.

**Where the boundary sits.** [[rest-contract]] puts the network seam at the entity layer:
the app ships only *payloads + REST calls*, renders forms dynamically from server-served
field metadata (`GET /forms/{id}/schema`), and asks the server to render filled PDFs
(`POST /cases/{id}/export/{form_id}`). All bbox geometry, schema knowledge, ReportLab, and
derivation math stay server-side — the app never touches a coordinate.

---

## 3. Phased roadmap (what to build first)

Ordered by dependency and by de-risking. Each phase is shippable and unblocks the next.

### Phase 0 — Stabilise the PK spine (prerequisite, per the audit)

Before the pharma spine is reused as an anchor for clinical capture, close the
[[frontend-audit-2026-07-09]] blockers that would otherwise propagate into the new build:

- **Fix the safety-critical Schnider V3 10× bug** (`MockPKEngine.swift:69`,
  `v3 = 23800 → 238000`) and **add the PK regression test suite** — the app currently has
  **zero tests**, which is why the error went uncaught. The engine is what recommends TCI
  doses that will fill the drug-table cells ([[field-inventory]] §3), so correctness here
  is load-bearing for the export.
- Fix the **playback Task leak** and **serialise simulation re-runs** — N5 reuses
  `SimulationView`/`ChartCanvas`, so its lifecycle bugs would be inherited.
- These are cheap and independent of the forms work; do them first.

### Phase 1 — Backend foundation (read-only, no DB)

- Scaffold the FastAPI clean-architecture rings ([[rest-contract]] §1);
  `domain/entities.py` + `derivations.py` (Aldrete totals, fluid balances, IMC/peso
  ideal/VSC) straight from the entity docs.
- `FileSchemaProvider` + `GET /forms` + `GET /forms/{id}/schema`, enriched with
  `ui_control` + `entity` hints. **This unblocks the app's dynamic renderer first** — no
  database needed yet.

### Phase 2 — Persistence + Case CRUD

- Postgres + SQLAlchemy + Alembic baseline; `cases` root + singleton child tables +
  `drug_administrations` / `newborn_records` collections; deep sparse blobs (nota2
  254-field technique, Aldrete 5×6, fluid 17×5, vitals series) as `JSONB` keyed by schema
  field `id` ([[rest-contract]] §1).
- `Case` aggregate CRUD + nested sub-resource routers ([[rest-contract]] §2.2–2.3).

### Phase 3 — App: persistence bridge + re-root navigation

- Add the **case store** and **schema runtime bridge** (the two app-side prerequisite
  layers from [[proposed-screens]] §6). `AppState` today holds one in-memory live
  simulation; it must become case-scoped.
- Re-root nav at an **Encounter**: N1 Encounter List (repurpose the dead *"Saved
  Simulations"* button the audit flags as an empty closure) → N2 Encounter Hub collecting
  the `AnesthesiaCase` root. The current drug-first flow becomes a **tool inside** an
  encounter.
- Extend **3′ Patient Data** to the full identity + somatometría block, reusing
  `PatientProfile`/`StepperRow`.

### Phase 4 — Clinical capture screens (the six new entities)

- Build the shared components once — `CheckboxGroupRow` + `CheckboxValueRow` (48% of
  fields are toggle-based), `ScoreGridWidget`, `HourlyFluidGrid`, `EditableDrugTable`
  ([[proposed-screens]] §5).
- Screens: **N3** Preanesthetic, **N4a/b/c** Technique (split by the schema's
  `major_sections`), **N7** Fluid Balance (85-cell grid + auto-balance), **N8** Recovery
  (Aldrete auto-sum), **N9** Newborn. Reuse **N5** Monitoring (`ChartCanvas`) and **N6**
  Drug Ledger (`DrugModel` + TCI recommended dose).
- Each wired per the [[screens]] add-a-screen checklist (`Route` case → `RootView` branch
  → view → `DesignSystem` styling).

### Phase 5 — The payoff: `fill-pdf` export

- Build the `ReportLabRenderer` adapter wrapping
  [`regen.py`](../../../notebooks/forms/regen.py) /
  [`imss_gen.py`](../../../notebooks/forms/imss_gen.py) **plus the new `fill-pdf` value
  pass** — the one genuinely new piece of rendering code, keyed by `field.type` + bbox
  ([[field-inventory]] §4).
- `POST /cases/{id}/export/{form_id}` → `application/pdf`; in-app **N10 Review & Export**
  (PDFKit preview + Share).
- `derive_service` stamps the computed read-only cells (Aldrete totals, fluid balances,
  biometrics, optional TCI dose) before rendering.

**Critical-path summary:** Phase 0 (audit fixes) and Phase 1 (schema endpoint) can run in
parallel; Phase 1 → 2 → 3 is the persistence spine; Phase 4 is the bulk of the UI work;
Phase 5 is the round-trip payoff and depends on everything upstream being persisted.

---

## 4. Risks & open questions

- **Two absent layers, 0% built** — `fill-pdf` export and REST/persistence. Both are
  designed (bboxes exist, DTOs specified) but unwritten; they dominate the effort.
- **Engine correctness gates the drug ledger** — do not surface TCI recommendations in N6
  until Phase 0 lands the Schnider V3 fix + tests ([[frontend-audit-2026-07-09]] finding 1).
- **Async vs sync export**, **auth/tenancy**, and **where TCI dosing is computed**
  (in-service vs the Swift/Rust engine) are open in [[rest-contract]] §6.
- **Reclassify-in-UI, not in schema** — the ~6 date/time, ~4 signature, and IMSS numeric
  lab fields are typed `text`; override in the `ui_control` layer only, keeping the schema
  as the fidelity source of truth ([[field-inventory]] §1–§2).

---

## Sources

- Companion plans: [[field-inventory]], [[proposed-screens]], [[rest-contract]].
- Wiki: [[architecture]], [[parsing]], [[screens]], [[models]], [[pk-engine-math]],
  [[simulation-screen]]; audit [[frontend-audit-2026-07-09]].
- Notebooks: [entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md),
  [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md), the four schemas
  under [`notebooks/forms/schema/`](../../../notebooks/forms/schema/nota2.schema.json), and
  the renderers [`regen.py`](../../../notebooks/forms/regen.py) /
  [`imss_gen.py`](../../../notebooks/forms/imss_gen.py).
</content>
