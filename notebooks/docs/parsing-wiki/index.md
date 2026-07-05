---
type: index
updated: 2026-07-05
tags: [parsing, catalog]
---

# Parsing Wiki — Index

Catalog of every page. Read this first when answering a query, then drill in.
Orientation: [[cold-resume]]. Conventions & workflows: [[SCHEMA]].

## Core

| Page | What it covers |
|---|---|
| [[strategy]] | End-to-end decision playbook: classify → choose approach → procedure |
| [[pipeline]] | The 3-module code architecture (`pdfsrc` → `regen` / `schema_extract`) |
| [[schema-spec]] | The output JSON contract: fields, tables, charts |
| [[lessons]] | Hard-won gotchas, consolidated |

## Techniques

| Page | Method |
|---|---|
| [[clip-aware-source]] | Reading vector PDFs with PyMuPDF: clip-aware text, drawings + scissor |
| [[font-handling]] | Per-document embedded-font extraction & glyph-aware substitution |
| [[geometry]] | Coordinate systems, text-matrix placement, the degenerate-rect trap |
| [[ink-oracle]] | Render-and-verify filter that kills phantom/clipped strokes |
| [[field-detection]] | Tokens → checkbox / blank / open-field state machine |
| [[table-detection]] | Anchored row/col detection with line-derived cell bounds |
| [[chart-detection]] | Dotted-lattice → `timeseries_chart` component (axes, lanes, bands) |
| [[fidelity-verification]] | Pixel-diff scoring + detection overlays |
| [[vision-reconstruction]] | Rebuilding a **scanned** form: measure skeleton + transcribe → vector redraw |

## Entities (the domain model)

The synthesis layer — what the parsed fields *mean*, and the bridge to the app. Start at
[[entities/model]].

| Entity | Role |
|---|---|
| [[anesthesia-case]] | Aggregate root — one anesthesia episode |
| [[patient]] | Identity + biometrics (**= app `PatientProfile`**) |
| [[preanesthetic-assessment]] | Pre-op history, exam, labs |
| [[anesthetic-technique]] | How the anesthetic was delivered (richest) |
| [[transanesthetic-record]] | Vital-sign time series (**= app `ChartCanvas`**) |
| [[drug-administration]] | Drugs given (**↔ app drug models / TCI**) |
| [[fluid-balance]] | Intake/output accounting |
| [[recovery-score]] | Aldrete recovery scoring over time |
| [[newborn-record]] | Obstetric outcome (conditional) |

## Sources (parsed documents)

| Page | File | State |
|---|---|---|
| [[nota-postanestesica]] | `data/NOTA POST y TRANSANESTÉSICA 2.pdf` | ✅ done |
| [[registro-transanestesico]] | `data/NOTA POST y TRANSANESTÉSICA 2-1.pdf` | ✅ done |
| [[imss-registro-anestesia]] | `data/4-30-60-72 IMSS Tula.pdf` | ✅ done (scanned → reconstructed) |

## Chronology

[[log]] — append-only record of ingests, queries, lints.
