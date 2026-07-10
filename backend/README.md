# TivaTrainer Backend

FastAPI service that persists anesthesia **cases** (patient record, pre-anesthetic
assessment, technique, transanesthetic record, drug administrations, fluid balance,
recovery score, newborns) behind a clean REST contract. It is the server that sits
behind the app's **CaseStore** port — the iOS app talks to it over HTTP; swapping the
app's local store for this backend requires no call-site changes.

- **Stack:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic.
- **Domain core is frozen** under `app/` (config → db → domain → application → infrastructure → api).
  DTOs are snake_case Pydantic models; `CaseService` is the single application entrypoint.
- **Contract & data model:** see the wiki — [`../docs/wiki/plans/rest-contract.md`](../docs/wiki/plans/rest-contract.md)
  (endpoints, singletons vs. collections) and [`../docs/wiki/app/clinical-record.md`](../docs/wiki/app/clinical-record.md)
  (the case envelope the app records into).

## Quick start

```bash
# one-time: create the env (Python 3.11)
conda create -n tiva_backend python=3.11
conda activate tiva_backend
pip install -r requirements.txt

# apply DB migrations (creates tables)
alembic upgrade head

# run the API (from backend/) — docs at http://127.0.0.1:8000/docs
uvicorn app.main:app --reload

# run tests
python -m pytest
```

Run all commands from the `backend/` directory.

## Database

Configured via `app/core/config.py` (`settings`, env prefix `TIVA_`, optional `.env`).

- **Default:** local SQLite file — `sqlite:///./tiva.db`, zero external dependencies.
- **Postgres (prod):** set `TIVA_DATABASE_URL`, e.g.
  `export TIVA_DATABASE_URL="postgresql+psycopg://user:pass@host:5432/tiva"`.

`alembic upgrade head` provisions/migrates whichever database `TIVA_DATABASE_URL` points at.

## Endpoints

All routes are mounted under the `/api/v1` prefix (see `app/main.py`):

- **Cases** — create / list / get / patch-envelope / delete; nested singleton children
  (`patient`, `preanesthetic-assessment`, `anesthetic-technique`, `transanesthetic-record`,
  `fluid-balance`, `recovery-score`) and collections (`drugs`, `newborns`).
- **Forms** — read the form schema served from `settings.schema_dir`
  (`notebooks/forms/schema`).
- **Export** — PDF for a case.

> **Export is MVP.** The `/export` endpoint currently returns a **summary PDF** generated
> from the case DTOs. True field-level PDF filling (writing values back into the original
> anesthesia form templates via the `notebooks/forms` renderers) is **pending the
> field-crosswalk** — see [`../docs/wiki/plans/field-crosswalk.md`](../docs/wiki/plans/field-crosswalk.md).
