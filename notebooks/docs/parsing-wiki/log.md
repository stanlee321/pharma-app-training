---
type: log
updated: 2026-07-05
tags: [parsing, chronology]
---

# Parsing Wiki — Log

Append-only. Newest at the bottom. Prefix `## [YYYY-MM-DD] <op> | <subject>`.
`grep "^## \[" log.md | tail -5` for recent activity.

## [2026-07-05] build | wiki instantiated

Instantiated the [`llmwiki.md`](../llmwiki.md) pattern under `docs/parsing-wiki/`,
scoped to the **PDF form parsing** domain. Wrote schema layer ([[SCHEMA]]), scaffolding
([[index]], [[cold-resume]], this log), core pages ([[strategy]], [[pipeline]],
[[schema-spec]], [[lessons]]), 8 technique pages, and 3 source pages. Captures the
methodology developed while parsing the first two documents (below).

## [2026-07-05] ingest | NOTA POSTANESTÉSICA 2.pdf

First document. Vector (Excel→PDF). Built the initial pipeline:
- **1:1 clone** at 96.7% pixel-identical (mean 3.34/255) via `regen.py`.
- **Schema**: 254 fields (152 checkbox, 44 checkbox+value, 9 number, 44 text, 5 open),
  3 major zones, 4 sub-headers.
- Techniques born here: [[font-handling]] (per-doc font subsets; Calibri not on this
  Mac), [[geometry]] (text-matrix placement, white = grayscale tuple),
  [[field-detection]], [[fidelity-verification]].

See [[nota-postanestesica]].

## [2026-07-05] ingest | NOTA POST y TRANSANESTÉSICA 2-1.pdf

Companion transanesthetic record. Vector, but structurally harder (vitals graph +
tables). Forced a rewrite of extraction onto **PyMuPDF** ([[clip-aware-source]]) after
discovering a clip-hidden phantom duplicate table that pdfplumber both included and
mis-placed. Added [[ink-oracle]], [[table-detection]], [[chart-detection]].
- **1:1 clone** at 99.0% (mean 1.42/255).
- **Schema**: 70 fields + 2 tables (farmaco A–O, control_fluidos 17×5) + 1
  `timeseries_chart` (vitals grid → maps to the app's ChartCanvas).
- Three subtle bugs fixed en route — see [[lessons]] (degenerate rects, rawdict flags,
  centerline ink test).

See [[registro-transanestesico]].

## [2026-07-05] ingest | 4-30-60-72 IMSS Tula.pdf (scanned)

The hard one: a **scanned** 2-page official IMSS form (image only, 0 vectors). No
extraction possible → **reconstructed** it. New technique page [[vision-reconstruction]]:
render page-with-transform (page 1 JPEG was 180° rotated), measure the line skeleton by
ink projection + band-restricted vertical detection, transcribe every label by vision,
author a declarative spec → clean vector PDF + schema.
- **Recreation:** `forms/out/imss_recreated.pdf`, verified by red-on-scan overlay.
- **Schema:** `imss_valoracion_preanestesica` (86 fields incl. 36 Aldrete score-cells)
  + `imss_registro_anestesia` (58 fields incl. a `vitals_grid` timeseries_chart).
- Flipped [[imss-registro-anestesia]] from deferred → done. All three source documents
  now parsed.

## [2026-07-05] build | entities layer (domain model synthesis)

Identified the **entities** the forms encode and added the `entities/` layer
([[entities/model]] + 9 entity pages), grounded in the four real schemas. Established the
**round-trip**: entity data + a form's field bboxes → regenerate the exact expected PDF,
so the app's digital process emits the identical paper form. Mapped the bridge to the
existing app model — [[patient]] = `PatientProfile` (drives the pharma engine),
[[transanesthetic-record]] = `ChartCanvas`, [[drug-administration]] ↔ drug models/TCI.
Updated [[SCHEMA]] (entity page type + ingest step 5) and [[index]]. Next technique to
build: `fill-pdf` (data + schema → filled form).
