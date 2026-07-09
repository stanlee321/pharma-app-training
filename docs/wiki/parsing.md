---
type: page
updated: 2026-07-09
tags: [parsing, federation]
---

# Forms Parsing & PDF Regeneration

Federation hub. The forms-parsing work has its **own first-class sub-wiki** co-located
with the code it documents at
[`../../notebooks/docs/parsing-wiki/`](../../notebooks/docs/parsing-wiki/index.md)
(own `SCHEMA`, own `index`, its relative links assume that location). This page does
**not** restate it — it orients you at a high level and wires it into the project wiki
and the app. Drill into the sub-wiki for anything real; cite `notebooks/forms/*` for
code.

## What the pipeline does

Turn paper/vector clinical anesthesia forms into two deliverables off one hub — a
**print-faithful 1:1 PDF clone** and a **structured field schema (JSON)** that drives a
digital form and, in reverse, a filled-PDF export. The schema is the hub; the app/HTML
is an *output* of it, never an OCR re-parse of a rasterized page. Full playbook:
[strategy.md](../../notebooks/docs/parsing-wiki/strategy.md).

### The 3 source forms

| Form | File (`notebooks/data/`) | Path | State |
|---|---|---|---|
| Nota postanestésica | `NOTA POST y TRANSANESTÉSICA 2.pdf` | vector-extraction | 96.7% clone · 254 fields |
| Registro transanestésico | `NOTA POST y TRANSANESTÉSICA 2-1.pdf` | vector-extraction | 99.0% clone · 70 fields + 2 tables + 1 chart |
| IMSS Registro de Anestesia (Tula) | `4-30-60-72 IMSS Tula.pdf` | **vision-reconstruction** | done · 2 pages · 86 + 58 fields |

Details per form under
[sources/](../../notebooks/docs/parsing-wiki/sources/).

### Two paths (the classify fork)

The one decision that forks everything is **vector vs scanned** (extractable chars +
drawings, or one full-page JPEG with 0 chars):

- **Vector-extraction path** — the two modern forms. `pdfsrc.py` loads clip-aware
  primitives, then two consumers run off them: `regen.py` re-emits a 1:1 clone (its
  `FontMapper` reuses the PDF's own embedded font subsets; its `InkOracle` rasterizes
  the original to drop phantom/clipped strokes; entry point `regenerate()`), and
  `schema_extract.py` runs the field/table/chart state machine (`build_lines →
  extract_fields / rotated_labels / extract_table / extract_chart`, entry point
  `extract()`). Never rasterize a vector form to re-parse it — the ground truth is
  already in hand. See [pipeline.md](../../notebooks/docs/parsing-wiki/pipeline.md).
- **Vision-reconstruction path** — the **scanned** IMSS form (each page a single JPEG,
  0 vectors). Nothing to extract, so it is *rebuilt*: render the page (page 1's JPEG was
  stored 180° rotated), measure the line skeleton by ink projection, transcribe every
  label by vision, then author a declarative spec that emits a clean vector PDF **plus**
  the same schema contract (`imss_gen.py`: `Page` primitives → `build_page1/2` +
  `_build_aldrete` → `render_pdf` + `emit_schema`, `source: "scanned-reconstruction"`).
  See [sources/imss-registro-anestesia.md](../../notebooks/docs/parsing-wiki/sources/imss-registro-anestesia.md).

### The schema contract (fields / tables / charts)

One JSON per form, bboxes as `[x0, top, x1, bottom]` in points, top-left origin — so it
maps 1:1 back to the source PDF (filled-export) and forward to the app canvas.
Top level: `form_id`, `page`, `major_sections`, `subsections`, `fields[]`, `tables[]`,
`charts[]`.

- **`fields[]`** — typed controls: `checkbox`, `checkbox_value`, `number`, `text`,
  `open_field`, each with `bbox` (+ optional `checkbox_bbox` / `blank_bbox`).
- **`tables[]`** — profile-driven grids; cells are `row_cuts × col_cuts`.
- **`charts[]`** — a `timeseries_chart` (y-axis ticks, x-axis hour lines, lanes, bands,
  legend) — the vitals grid.

Contract in full: [schema-spec.md](../../notebooks/docs/parsing-wiki/schema-spec.md).

## Into the parsing sub-wiki

| Go to | For |
|---|---|
| [index.md](../../notebooks/docs/parsing-wiki/index.md) | catalog of every page — read first, then drill in |
| [strategy.md](../../notebooks/docs/parsing-wiki/strategy.md) | the classify → clone → extract → verify playbook |
| [pipeline.md](../../notebooks/docs/parsing-wiki/pipeline.md) | the 3-module code architecture (`pdfsrc` → `regen` / `schema_extract`) |
| [schema-spec.md](../../notebooks/docs/parsing-wiki/schema-spec.md) | the output JSON contract (fields / tables / charts) |
| [sources/](../../notebooks/docs/parsing-wiki/sources/) | per-document notes on all 3 forms |
| [entities/model.md](../../notebooks/docs/parsing-wiki/entities/model.md) | the synthesis layer — what the parsed fields *mean* |

## Bridge to the app

The sub-wiki's [entities/model.md](../../notebooks/docs/parsing-wiki/entities/model.md)
synthesizes a single clinical domain model out of the parsed schemas, and three of its
entities connect **directly** to code the TivaTrainer app already has (grounded in
`PharmaApp/Models/**` — see [[models]]):

| Parsing entity | App model | Join |
|---|---|---|
| [Patient](../../notebooks/docs/parsing-wiki/entities/model.md) (`weight / height / age / sex`) | `PatientProfile` ([[models]]) | the form's patient covariates *are* the PK engine's inputs → LBM (James) → Marsh/Schnider/Minto/Hannivoort ([[pk-engine-math]]) |
| [TransanestheticRecord](../../notebooks/docs/parsing-wiki/entities/model.md) (vitals time-series) | `ChartCanvas` | the paper vitals grid — a `timeseries_chart` in the schema — is the interactive chart ([[simulation-screen]]) |
| [DrugAdministration](../../notebooks/docs/parsing-wiki/entities/model.md) (drugs given) | `DrugModel` / TCI dosing | the drugs charted on the form map onto the app's drug models and TCI ([[models]], [[pk-engine-math]]) |

Direction of the join: parsing supplies the **clinical envelope** (who the patient is,
what was charted, on what form); the app's PK engine supplies the **dosing math**. One
entity model backs all three forms' PDFs and feeds the simulation. Where this sits in
the overall layering: [[architecture]].

## Grounding & drift

- Sub-wiki claims verified against code on 2026-07-09: `regen.py` (`FontMapper`,
  `InkOracle`, `regenerate`), `schema_extract.py` (`build_lines`, `extract_fields`,
  `rotated_labels`, `extract_table`, `extract_chart`, `extract`), and `imss_gen.py`
  (`Page`, `build_page1/2`, `_build_aldrete`, `render_pdf`, `emit_schema`) all match the
  pages that describe them.
- **Drift inside the sub-wiki:** its `cold-resume.md` and `strategy.md` Step 1 still call
  the IMSS form "⏸ deferred (OCR track)", but `index.md`, the source page, and the
  shipped `imss_gen.py` show it is **done** via vision-reconstruction. Trust the latter;
  the resume line is stale. (Federation hub only — fix belongs in the sub-wiki, not
  here.)
- The app-side cross-link targets (`[[models]]`, `[[pk-engine-math]]`,
  `[[simulation-screen]]`, `[[architecture]]`) all resolve to pages in this wiki.
