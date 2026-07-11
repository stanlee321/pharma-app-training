---
type: page
updated: 2026-07-10
tags: [backend, api, reference, howto, built]
---

# Backend API — Reference & Usage (as built)

The **as-built** reference for the FastAPI service in `backend/` — every endpoint, the payload
shapes, and how to run + call it. The **design of record** is [[rest-contract]]; this page is what
actually runs today (verified live via `backend/scripts/e2e.py`). Domain: [[clinical-record]].
Contract deltas the parsing outputs forced: [[contract-reconciliation-2026-07-10]].

- **Base URL:** `http://127.0.0.1:8000/api/v1` · **Health:** `GET /health` → `{"status":"ok"}`
- **Interactive docs (live):** `http://127.0.0.1:8000/docs` (Swagger) · `/openapi.json`
- **Tenancy:** every request is scoped by the **`X-User-Id`** header (a UUID — the API gateway
  injects it; absent → a fixed mock tenant `settings.mock_user_id`). Cases isolate per `user_id`:
  `GET /cases` lists only yours, and cross-tenant read/write/delete → **404**. `owner` is a separate
  human display name. Real token auth is later — [[decisions]] ADR-3. The app sends its persisted
  mock login UUID as `X-User-Id`.
- **Wire format:** JSON, **snake_case** (the Swift app decodes with `.convertFromSnakeCase`).

## Run it (procedure)

```bash
cd backend
docker compose up -d                                   # Postgres → localhost:5433 (tiva/tiva/tiva)
export TIVA_DATABASE_URL="postgresql+psycopg://tiva:tiva@localhost:5433/tiva"
conda activate tiva_backend                            # Python 3.11 env with the deps
alembic upgrade head                                   # create the schema
uvicorn app.main:app --host 127.0.0.1 --port 8000      # serve
python scripts/e2e.py                                  # drive the full lifecycle + export PDFs
```

Omit `TIVA_DATABASE_URL` to use the zero-setup **SQLite** dev DB (`./tiva.db`). Stop Postgres with
`docker compose down` (keep data) or `down -v` (wipe). Tests: `python -m pytest`.

## Conventions

- **Singletons** (1-per-case children) use **`GET`/`PUT`** — `PUT` is a create-or-replace upsert of
  the whole sub-form. **Collections** (many-per-case) use `GET`/`POST` + `PATCH`/`DELETE` by item id.
- **Derived fields are read-only** — the server computes and stamps them ([[field-inventory]] §3);
  sending them is ignored. They come back populated on every read: `patient.imc`/`peso_ideal`/`vsc`/
  `vsc_25`/`vsc_15`, `recovery.totals`, and `fluid_balance.balance_parcial`/`balance_total`/
  `total_a_reponer`/`gasto_urinario`/`tasa_fentanilo`.
- **404** on a missing case or unknown sub-resource segment.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /cases` | create a case → returns the full aggregate (body `{ "owner": "…" }`) |
| `GET /cases` | list case summaries (`id, owner, nombre, diagnostico_preop, created_at`) |
| `GET /cases/{id}` | full aggregate (envelope + all children + derived) |
| `PATCH /cases/{id}` | update envelope fields (dx, sala, servicio, asa, raq, …) |
| `DELETE /cases/{id}` | delete the case (204) |
| `GET /cases/{id}/{resource}` | read a singleton **or** collection (one dispatcher — see note) |
| `PUT /cases/{id}/{child}` | upsert a singleton child |
| `POST /cases/{id}/{coll}` | add a collection item |
| `PATCH /cases/{id}/{coll}/{item_id}` | update a collection item |
| `DELETE /cases/{id}/{coll}/{item_id}` | delete a collection item (204) |
| `GET /forms` | list the 4 form ids + titles |
| `GET /forms/{form_id}/schema` | the raw parsed schema JSON for a form |
| `POST /cases/{id}/export/{form_id}` | render the **filled form PDF** (`application/pdf`) |

**Singleton `{child}` segments:** `patient`, `preanesthetic-assessment`, `anesthetic-technique`,
`transanesthetic-record`, `fluid-balance`, `recovery-score`.
**Collection `{coll}` segments:** `drugs`, `newborns`.
Note: `GET /cases/{id}/{resource}` is one route that resolves `resource` against collections first,
then singletons (Starlette can't host two identical 2-segment templates — see the routes_cases note).

`form_id` ∈ `nota_postanestesica`, `registro_transanestesico`, `imss_valoracion_preanestesica`,
`imss_registro_anestesia`.

## Payload examples

**Create + envelope + patient (derived stamped in the response):**
```bash
CID=$(curl -s -XPOST localhost:8000/api/v1/cases -H 'content-type: application/json' \
      -d '{"owner":"dr.perez"}' | jq -r .id)

curl -XPATCH localhost:8000/api/v1/cases/$CID -H 'content-type: application/json' -d '{
  "sala":"Q3","servicio":"Cirugía General","tipo_admision":"urgencia",
  "diagnostico_preop":"Colecistitis aguda","asa":2,"raq":2 }'

curl -XPUT localhost:8000/api/v1/cases/$CID/patient -H 'content-type: application/json' -d '{
  "nombre":"N. Pérez","registro":"TU-2026-0481","hb":13.2,"hto":39.6,
  "profile":{"weight":72,"height":161,"age":54,"gender":"female"} }'
# → 200 { …, "imc":27.8, "peso_ideal":53.3, "vsc":5040.0, "vsc_25":1260.0, "vsc_15":756.0 }
```

**Collection (drugs) + fluid-balance (real `control_fluidos` row keys) + recovery:**
```bash
curl -XPOST localhost:8000/api/v1/cases/$CID/drugs -H 'content-type: application/json' \
  -d '{"farmaco":"Propofol","dose_value":120,"dose_unit":"mg","via":"IV","rust_model_id":"marsh"}'

curl -XPUT localhost:8000/api/v1/cases/$CID/fluid-balance -H 'content-type: application/json' -d '{
  "matrix":{"Ingreso Critaloide":{"1hr":500},"Sangrado":{"1hr":100},"Diuresis":{"1hr":80}} }'
# → derived: "balance_parcial":{"1hr":320.0}, "gasto_urinario":{"1hr":1.11}

curl -XPUT localhost:8000/api/v1/cases/$CID/recovery-score -H 'content-type: application/json' -d '{
  "aldrete":{"Actividad":{"0":2},"Respiración":{"0":2},"Circulación":{"0":2},
             "Conciencia":{"0":2},"Coloración":{"0":2}} }'   # → "totals":{"0":10}
```

**Export the filled form:**
```bash
curl -XPOST localhost:8000/api/v1/cases/$CID/export/registro_transanestesico -o nota21.pdf
# → application/pdf: the notebook's 1:1 clone with the case's values drawn into the field bboxes
#   (backend/app/infrastructure/render/, first-cut [[field-crosswalk]]; summary-PDF fallback)
```

The full worked flow is `backend/scripts/e2e.py`.

## How the app connects

The app talks to this service through the `CaseStore` port ([[decisions]] ADR-2, [[clinical-record]]).
This is **built + verified** ([[log]] 2026-07-10): `MockCaseStore` sits over a `CaseBackend` port
(`PharmaApp/Services/CaseBackend.swift`) with `InMemoryBackend` (default) and `RestBackend` (these
endpoints, snake_case via the models' explicit `CodingKeys`). Flip `CaseStoreProvider.useREST = true`
to persist to this service. Verified end-to-end by a standalone create→save→load→delete round-trip —
even the values-blob / fluid-matrix dict keys survive intact.

## Sources

- Routers: `backend/app/api/v1/{routes_cases,routes_forms,routes_export}.py`; DTOs
  `backend/app/application/dto.py`; services `…/case_service.py`; derivations `…/domain/derivations.py`;
  renderer `…/infrastructure/render/`. Run guide: `backend/README.md`, `backend/scripts/e2e.py`.
- Design: [[rest-contract]]. Domain: [[clinical-record]]. Deltas: [[contract-reconciliation-2026-07-10]].
