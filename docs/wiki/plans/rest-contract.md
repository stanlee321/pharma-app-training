---
type: plan
updated: 2026-07-09
tags: [plan, backend, rest, fastapi]
---

# Plan — REST Contract & Backend Architecture (notebooks pipeline → FastAPI)

**Status: proposal.** This is a design, not an implementation. It promotes the Python
forms pipeline in `notebooks/forms/**` from notebook scripts into a **FastAPI service**
the SwiftUI app consumes over REST. The frontend owns only *payloads + REST calls*: it
binds entity DTOs to `Codable` structs and asks the server to render filled PDFs. All PDF
geometry, schema knowledge, and derivation math stay server-side.

> **Note ([[decisions]] ADR-1):** the app uses **native hand-built screens**
> ([[proposed-screens]]/[[ux-ui]]) — it does **not** render forms dynamically. The served
> schema metadata below is a *server-side* concern (export + validation); a screen may fetch
> a section's field *list* to avoid hand-coding hundreds of toggles, but the app is not a
> generic form engine.

Grounded in the parsed schema contract
([../../../notebooks/docs/parsing-wiki/schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md)),
the synthesized domain model
([../../../notebooks/docs/parsing-wiki/entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)),
and the four emitted schemas under `../../../notebooks/forms/schema/`. See also the
app-side counterparts in [[architecture]], [[parsing]], [[models]], and [[screens]].

---

## 0. The seam this creates

Today the round-trip is: paper → parse → `*.schema.json` (fields/tables/charts, each with
a point **bbox**) → app collects entity instances → *draw values into bboxes over the 1:1
clone* to regenerate the filled PDF. The fill step is designed but not built (`fill-pdf`,
planned — [../../../notebooks/docs/parsing-wiki/entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)).
This plan puts a network boundary at the entity layer:

```
  SwiftUI app  ──REST(JSON)──►  FastAPI  ──►  domain entities  ──►  Postgres
   (payloads +                    │
    Codable)     ◄──application/pdf──┘  bind entities onto schema bboxes,
                                        run regen.py / imss_gen.py + fill layer
```

The app never ships bboxes, ReportLab, or schema files. It POSTs entity JSON and GETs
field-definition metadata + rendered PDFs.

---

## 1. Clean-architecture layers

Four rings, dependencies point **inward only** (api → application → domain; infrastructure
implements ports the inner rings declare). The `domain` ring is the entity catalog from
[../../../notebooks/docs/parsing-wiki/entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)
expressed as framework-free Python; it imports nothing from FastAPI, SQLAlchemy, or
ReportLab.

```
backend/
  pyproject.toml
  alembic.ini
  alembic/
    env.py
    versions/                      # one migration per schema change
  app/
    main.py                        # FastAPI factory, mounts api/v1 router, wires DI
    core/
      config.py                    # Settings: DATABASE_URL, SCHEMA_DIR, NOTEBOOKS_DIR
      db.py                        # SQLAlchemy engine, SessionLocal, get_db dependency

    domain/                        # RING 1 — pure, no framework imports
      entities.py                  # AnesthesiaCase (root), Patient, PreanestheticAssessment,
                                   #   AnestheticTechnique, TransanestheticRecord,
                                   #   DrugAdministration, FluidBalance, RecoveryScore,
                                   #   NewbornRecord  (mirror entities/*.md)
      value_objects.py             # Quantity{value,unit}; enums Sexo, TipoAdmision,
                                   #   ASA(I..V), RAQ(1..5), Via, Modality, ScoreCell(0|1|2)
      derivations.py               # PURE math: aldrete_total(), fluid_balance(),
                                   #   imc(), peso_ideal(), vsc()  (the "Derived" rows)

    application/                   # RING 2 — use-cases, orchestration
      ports.py                     # Protocols the domain needs: CaseRepository,
                                   #   FormRenderer, SchemaProvider  (interfaces only)
      dto.py                       # Pydantic request/response models = THE PAYLOADS
      services/
        case_service.py            # aggregate CRUD; loads/saves the Case + children
        derive_service.py          # runs derivations.py, stamps computed read-only fields
        export_service.py          # bind entities → schema bboxes → FormRenderer → PDF
        schema_service.py          # serve field-definition metadata; validate payloads

    infrastructure/                # RING 3 — adapters implementing the ports
      db/
        models.py                  # SQLAlchemy ORM tables (Postgres)
        repositories.py            # SqlCaseRepository implements CaseRepository
      render/
        renderer.py                # ReportLabRenderer implements FormRenderer:
                                   #   wraps regen.regenerate() / imss_gen.render_pdf()
                                   #   + the NEW fill-pdf value layer (keyed by field.type+bbox)
      schema/
        provider.py                # FileSchemaProvider: loads forms/schema/*.json,
                                   #   enriches with ui_control + entity hints, caches

    api/                           # RING 4 — HTTP (FastAPI)
      deps.py                      # DI: get_case_service, get_export_service, ...
      v1/
        router.py                  # APIRouter aggregator, prefix /api/v1
        cases.py                   # Case aggregate + nested sub-resource routers
        forms.py                   # /forms, /forms/{form_id}/schema
        export.py                  # /cases/{id}/export/{form_id}
```

**Why this shape.**
- `domain` owns the nine entities and the *derivation math* the docs flag as computed
  (Aldrete totals 0–10, fluid `Balance parcial/total`, `Gasto urinario`, `IMC`,
  `Peso ideal`, `VSC`) — see
  [../../../notebooks/docs/parsing-wiki/entities/recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md)
  and
  [../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md).
  These are never accepted from the client; the server computes them.
- `application` declares a `FormRenderer` **port**; `infrastructure/render/renderer.py`
  is the only place that imports the notebook code
  ([../../../notebooks/forms/regen.py](../../../notebooks/forms/regen.py),
  [../../../notebooks/forms/imss_gen.py](../../../notebooks/forms/imss_gen.py),
  [../../../notebooks/forms/pdfsrc.py](../../../notebooks/forms/pdfsrc.py)). The notebook
  scripts move behind an adapter instead of being called directly from HTTP handlers.
- `infrastructure/schema/provider.py` is the only place that reads the raw
  `forms/schema/*.json`. Everything above sees enriched, validated metadata.

**Persistence (Postgres + SQLAlchemy + Alembic).** One row per case in `cases`; one row
per singleton child (`patients`, `preanesthetic_assessments`, `anesthetic_techniques`,
`transanesthetic_records`, `fluid_balances`, `recovery_scores`) FK'd to `cases.id`;
collection children (`drug_administrations`, `newborn_records`) are many-per-case tables.
The deeply nested / sparse structured blobs — the nota2 254-field technique flatten, the
Aldrete 5×6 score map, the fluid 17×5 matrix, the vitals time-series — are stored as
`JSONB` columns keyed by schema field `id` (stable slugs like `propofol_42`,
`aldrete_actividadm_c0`). This keeps the relational surface small while preserving the
exact `id`s the fill layer needs. Alembic migrations version every table.

---

## 2. Resource model + endpoints

**Base path** `/api/v1`. **Aggregate root = `Case`**; every entity in
[../../../notebooks/docs/parsing-wiki/entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)
is a nested sub-resource under a case. Singletons (1-per-case) use `GET`/`PUT` (idempotent
upsert). Collections (many-per-case) use full CRUD with item ids.

### 2.1 Form metadata (static, schema-driven)

| Method & path | Purpose | Backed by |
|---|---|---|
| `GET /forms` | list the 4 form ids + titles | schema provider |
| `GET /forms/{form_id}/schema` | field-definition metadata for dynamic rendering + validation | `forms/schema/{…}.json` |

`form_id` ∈ `nota_postanestesica`, `registro_transanestesico`,
`imss_valoracion_preanestesica`, `imss_registro_anestesia` (exact ids emitted by the
schemas). Detail in §4.

### 2.2 Case aggregate (root CRUD)

| Method & path | Purpose |
|---|---|
| `POST /cases` | create an empty case, returns `id` |
| `GET /cases` | list (paged; summary projection) |
| `GET /cases/{id}` | full aggregate — case + all populated children + computed fields |
| `PATCH /cases/{id}` | update root envelope fields (fecha, dx, ASA, firmas…) |
| `DELETE /cases/{id}` | delete case + cascade children |

### 2.3 Nested sub-resources (one router per entity)

| Cardinality | Entity | Endpoints |
|---|---|---|
| 1 per case | Patient | `GET`/`PUT /cases/{id}/patient` |
| 1 per case | PreanestheticAssessment | `GET`/`PUT /cases/{id}/preanesthetic-assessment` |
| 1 per case | AnestheticTechnique | `GET`/`PUT /cases/{id}/anesthetic-technique` |
| 1 per case | TransanestheticRecord | `GET`/`PUT /cases/{id}/transanesthetic-record` |
| 1 per case | FluidBalance | `GET`/`PUT /cases/{id}/fluid-balance` |
| 1 per case | RecoveryScore | `GET`/`PUT /cases/{id}/recovery-score` |
| many per case | DrugAdministration | `GET`/`POST /cases/{id}/drugs`, `GET`/`PATCH`/`DELETE /cases/{id}/drugs/{drug_id}` |
| 0..n per case | NewbornRecord | `GET`/`POST /cases/{id}/newborns`, `PATCH`/`DELETE /cases/{id}/newborns/{nb_id}` |

Cardinalities are taken straight from the entity catalog (Patient 1, DrugAdministration
many, NewbornRecord 0..n obstetric-only, etc.). `PUT` on a singleton creates-or-replaces
so the app can save a whole sub-form in one call; `PATCH` on the root does partial
envelope edits.

### 2.4 Export (the payoff)

```
POST /cases/{id}/export/{form_id}
  Accept: application/pdf
  → 200 application/pdf   (the filled, print-faithful PDF)
```

The `export_service` loads the persisted case aggregate, runs `derive_service` to fill
computed cells, then binds every entity attribute onto that form's schema `id`/`bbox` and
calls the `FormRenderer`. The renderer draws the **blank 1:1 clone first** (existing
behaviour of
[../../../notebooks/forms/regen.py:regenerate](../../../notebooks/forms/regen.py) for
`nota_postanestesica`/`registro_transanestesico`, and
[../../../notebooks/forms/imss_gen.py:render_pdf](../../../notebooks/forms/imss_gen.py)
for the two `imss_*` pages) then layers the **new fill-pdf value pass** over it, keyed by
`field.type` + bbox exactly as the schema spec anticipates
([../../../notebooks/docs/parsing-wiki/schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md),
L88–92 "the **same bboxes** feed a filled-PDF export"):

| field type | fill action | target bbox |
|---|---|---|
| `text` / `open_field` | `drawString` value | `blank_bbox` |
| `checkbox` | stamp X/✓ | `checkbox_bbox` |
| `checkbox_value` | mark box + draw value (+`unit`) | `checkbox_bbox` + `blank_bbox` |
| `number` | draw value + unit | `blank_bbox` |
| table cell | draw in `row_cuts × col_cuts` rect | `tables[]` |
| `score` | mark connected Aldrete cell | `aldrete_*_c0..5` |
| `timeseries_chart` | plot point: value→y via `y_axis.ticks`, time→x via `x_axis.hour_lines`, per `lane` | inside chart `bbox` |

Because a single case supplies all forms, the same `id` can be exported to any `form_id`
it participates in. Optional request body: `{ "include_derived": true, "time_points":
["0","20","60"] }`. If rendering is slow enough to matter, the endpoint MAY return `202`
with a `GET /cases/{id}/exports/{job_id}` poll; default proposal is synchronous.

---

## 3. Payload DTOs (what `Codable` binds to)

JSON keys are **snake_case**, matching the app's existing engine round-trip convention
([[engine]]); Swift binds with `keyDecodingStrategy = .convertFromSnakeCase` or explicit
`CodingKeys`. Every DTO is a Pydantic model in `application/dto.py`. Numeric clinical
values that carry a unit use a shared `Quantity { value: number, unit: string }` value
object. **Fields marked `readOnly` are server-computed** (`derive_service`) and rejected
if sent by the client.

Per-entity shape (attributes lifted from the entity docs; the schema `id` inventory is the
exhaustive per-field source):

- **Patient** — `registro, nombre, edad(yr), sexo(M|F), peso(kg), talla(cm), hb, hto, rh,
  grupo_sanguineo, sala, servicio, cama`; **readOnly** `imc, peso_ideal, vsc`
  (from [../../../notebooks/docs/parsing-wiki/entities/patient.md](../../../notebooks/docs/parsing-wiki/entities/patient.md)).
  `weight/height/age/sex` **is** the app's `PatientProfile` ([[models]]).
- **AnesthesiaCase (root)** — `fecha, tipo_admision(urgencia|electiva), tipo(I|II),
  diagnostico_preop, diagnostico_postop, operacion_propuesta, operacion_realizada,
  procedimiento, asa(I..V), raq(1..5), posicion, duracion_anestesia,
  complicaciones_trans, complicaciones_post, observaciones, equipo_quirurgico`; nested
  `providers { anestesiologo{nombre,cedula,universidad,clave}, cirujano }`
  ([../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md)).
- **PreanestheticAssessment** — `history{...}`, `exam{...}`, `labs_orina{...}`,
  `labs_quimica{ analyte: Quantity }` (each lab a `{value,unit}`), `premedicacion`
  ([../../../notebooks/docs/parsing-wiki/entities/preanesthetic-assessment.md](../../../notebooks/docs/parsing-wiki/entities/preanesthetic-assessment.md)).
- **AnestheticTechnique** — tagged union on `modality (AGIB|AGEV|BEPD|…)`; branch payloads
  `general{induccion,via_aerea,ventilacion,mantenimiento,emersion}`,
  `regional_neuraxial{...}`, `peripheral_block[...]`. The 254 nota2 fields are carried as
  a `values: { field_id: bool | Quantity | string }` map keyed by schema `id`, so the
  254-field surface needs no bespoke DTO per checkbox
  ([../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md)).
- **TransanestheticRecord** — `series: [{ lane, points: [{t, value}] }]`,
  `events: [{ marker(1..6), t }]`, `snapshots: { basal:{fc,fr,ta,pam,spo2,pvc},
  post:{...} }`, `monitoring: { ecg, spo2, etco2, bis, tnm, temp_site, … booleans }`
  ([../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md)).
  `series` maps 1:1 onto the chart `lanes`/`y_axis` — the app's `ChartCanvas`
  ([[simulation-screen]]).
- **DrugAdministration** (collection item) — `id, label(A..O|A..M), farmaco, dosis:
  Quantity, via(IV|IM|inhalación|…), time`; optional **readOnly** `recommended: {bolus,
  infusion}` from the TCI engine
  ([../../../notebooks/docs/parsing-wiki/entities/drug-administration.md](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md)).
- **FluidBalance** — `matrix: { row_id: { "1hr": ml, … "5hr": ml } }` for entered rows +
  `blood_components{...}`; **readOnly** rows `balance_parcial, balance_total,
  gasto_urinario, tasa_fentanilo` and somatometry volumes `vsc, sp` computed per hour
  ([../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md)).
- **RecoveryScore** — `aldrete: { criterion: { time_point: 0|1|2 } }` (5×6);
  **readOnly** `total: { time_point: 0..10 }`; `otras_escalas{ramsay,bromage,ena}`,
  `alta_a_su_piso, medico_responsable`
  ([../../../notebooks/docs/parsing-wiki/entities/recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md)).
- **NewbornRecord** (collection item) — `id, expulsion_placenta, sexo, peso(Quantity),
  talla(Quantity), apgar{min1,min5,min10}, estado_general_al_salir`; shown only for
  obstetric cases
  ([../../../notebooks/docs/parsing-wiki/entities/newborn-record.md](../../../notebooks/docs/parsing-wiki/entities/newborn-record.md)).

The full-aggregate `GET /cases/{id}` returns the root envelope plus each populated child
under its key (`patient`, `anesthetic_technique`, `drugs: []`, `newborns: []`, …).

---

## 4. Schema JSON → served field-definition metadata

`GET /forms/{form_id}/schema` serves the field-definition metadata used **server-side** for
validation and the export mapping, and optionally consumed by the app as a **field
catalogue** for its dense repetitive sections (so it need not hard-code hundreds of toggles
— [[decisions]] ADR-1). It is **not** a dynamic form-rendering feed; the app's screens are
native ([[proposed-screens]]). The field id → entity binding this depends on is the
[[field-crosswalk]]. `FileSchemaProvider` reads the emitted
contract (`../../../notebooks/forms/schema/{nota2,nota21,imss_p1,imss_p2}.schema.json`),
returns it largely verbatim per
[../../../notebooks/docs/parsing-wiki/schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md),
and adds two enrichment keys per field:

- `ui_control` — mapped from `field.type` via the field-detection table in the schema spec
  (`checkbox`→toggle, `checkbox_value`→toggle+input, `number`→numeric, `text`/`open_field`
  →text). It also applies the clinically-obvious overrides the input analysis calls out:
  the ~6 date/time and ~4 signature fields typed `text`, and the IMSS lab/urinalysis rows
  that are numeric-despite-`text` — reclassified in this UI layer **without schema
  changes**.
- `entity` — the owning entity, from the field→entity map in
  [../../../notebooks/docs/parsing-wiki/entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md),
  so the app knows which DTO/endpoint a given field binds to.

Response shape (superset of the on-disk schema):

```jsonc
{
  "form_id": "registro_transanestesico",
  "page":   { "width": 612, "height": 792 },
  "sections": ["Anestesia General", ...],           // major_sections + subsections
  "fields": [ {
    "id": "propofol_42", "type": "checkbox_value", "label": "Propofol",
    "unit": "mg", "section": "Anestesia General",
    "bbox": [x0,top,x1,bottom], "checkbox_bbox": [...], "blank_bbox": [...],
    "ui_control": "toggle_with_input",              // enrichment
    "entity": "drug_administration"                 // enrichment
  } ],
  "tables": [ { "id": "control_fluidos", "rows":[...], "columns":[...],
                "row_cuts":[...], "col_cuts":[...] } ],
  "charts": [ { "id": "vitals_grid", "type": "timeseries_chart",
                "y_axis": {...}, "x_axis": {...}, "lanes": [...] } ]
}
```

Validation: on `PUT`/`POST` of an entity, `schema_service` checks each incoming value
against the field definition for that entity's fields (type, unit presence, `score` ∈
{0,1,2}, enum membership). The bboxes are ignored by the app for input but are the exact
coordinates the export step draws into — the app never needs them, keeping the frontend
free of geometry.

---

## 5. Concrete example — Patient upsert + export

**Save the patient** (drives both the form identity block and the PK engine covariates):

```
PUT /api/v1/cases/6f2a.../patient
Content-Type: application/json

{
  "registro": "TU-2026-0481",
  "nombre":   "N. Pérez",
  "edad":     54,
  "sexo":     "F",
  "peso":     72.0,
  "talla":    161.0,
  "hb": 13.2, "hto": 39.6, "rh": "+", "grupo_sanguineo": "O",
  "sala": "Q3", "servicio": "Cirugía General", "cama": "204"
}
```

**Response** (200 — server has stamped the read-only derived biometrics):

```json
{
  "registro": "TU-2026-0481", "nombre": "N. Pérez",
  "edad": 54, "sexo": "F", "peso": 72.0, "talla": 161.0,
  "hb": 13.2, "hto": 39.6, "rh": "+", "grupo_sanguineo": "O",
  "sala": "Q3", "servicio": "Cirugía General", "cama": "204",
  "imc": 27.8, "peso_ideal": 56.4, "vsc": 5040
}
```

**Export the post-anaesthetic note as a filled PDF:**

```
POST /api/v1/cases/6f2a.../export/nota_postanestesica
Accept: application/pdf

→ 200 OK
  Content-Type: application/pdf
  Content-Disposition: attachment; filename="nota_postanestesica_6f2a.pdf"
  <binary PDF: 1:1 clone from regen.regenerate() with the case's values
   drawn into each field bbox by the fill-pdf layer>
```

The app displays/prints the returned PDF; it never touched a bbox or the schema geometry.

---

## 6. Build sequence (proposal)

1. Scaffold `backend/` rings; `domain/entities.py` + `derivations.py` from the entity docs.
2. `FileSchemaProvider` + `GET /forms/{id}/schema` (read-only, no DB) — unblocks the app's
   dynamic renderer first.
3. SQLAlchemy models + Alembic baseline; `SqlCaseRepository`; `Case` CRUD + sub-resources.
4. `ReportLabRenderer` adapter wrapping `regen.py`/`imss_gen.py` **plus the new fill-pdf
   value pass** (the one genuinely new piece of rendering code) → `export` endpoint.
5. `derive_service` (Aldrete totals, fluid balances, IMC/peso ideal/VSC, optional TCI
   recommended dose via the app's engine contract — [[engine]]).

## Open questions — resolved in [[decisions]]

- Auth/tenancy → **ADR-3**: `cases.owner` from the first migration; full auth a later phase.
- Async vs sync export (§2.4) → **ADR-4**: synchronous by default; async only if measured
  latency warrants.
- Where `recommended` TCI dosing is computed → **ADR-5**: client-side (the app's PK engine
  [[pk-engine-math]]), not the backend; store only the given dose.

The field id → entity binding this contract depends on is specified in [[field-crosswalk]]
(build alongside the export layer, not a skeleton blocker).

Related: [[architecture]] (whole system), [[parsing]] (the pipeline hub), [[screens]] /
[[input-screens]] (the app surfaces that will consume these payloads),
[[state-navigation]] (where `AppState` would hold fetched cases).
