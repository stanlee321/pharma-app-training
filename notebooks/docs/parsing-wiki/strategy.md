---
type: strategy
updated: 2026-07-05
tags: [parsing, playbook]
---

# Parsing Strategy — the decision playbook

The end-to-end procedure for turning a form PDF into a clone + schema. Start every
new document here.

## Goal (two deliverables, one hub)

```
                                     ┌─► regen.py     → print-faithful PDF clone (1:1)
source PDF → primitives → SCHEMA ────┤
   (exact geometry + real fonts)     └─► app (HTML/SwiftUI) → digital form
```

The **schema is the hub**. HTML/app is an *output* of the schema, never an OCR-parse
of a rasterized image — that would discard exact geometry and inject recognition
error. See [[schema-spec]] for the contract.

## Step 1 — Classify the source

The single most important fork: **vector vs scanned.**

```bash
pdfinfo  file.pdf   # Creator/Producer (Excel/Word = likely vector), Pages
pdffonts file.pdf   # embedded fonts present? → vector text
pdfimages -list file.pdf  # 1 full-page image per page + no fonts → scanned
```

Or decisively, with the pipeline's own loader:
```python
import pdfsrc; p = pdfsrc.load("file.pdf")["pages"][0]
len(p["chars"]), len(p["drawings"])   # ~0 chars ⇒ scanned
```

| Type | Signal | Approach |
|---|---|---|
| **Vector** | extractable chars + drawings | **This pipeline.** 1:1 is achievable & mostly mechanical. |
| **Scanned** | 1 image/page, 0 chars | OCR/vision reconstruction — separate track, deferred. See [[imss-registro-anestesia]]. |

Rule: **never rasterize a vector form to re-parse it.** We already hold the ground
truth. Rasterize only what was *born* raster.

## Step 2 — Clone it (fidelity proof)

Run `regen.py` (see [[pipeline]]). This proves we captured the geometry and fonts,
and is the export format later. Verify with [[fidelity-verification]] — target
< ~3.5/255 mean pixel diff; inspect where the residual concentrates.

Getting to 1:1 on a vector form depends on three things, in order of how often they
bite: [[font-handling]], [[clip-aware-source]], [[geometry]].

## Step 3 — Extract the schema

Run `schema_extract.py`. Generic **field detection** ([[field-detection]]) works with
no config — checkboxes, fill-blanks, open fields, sections. For richer layouts add a
`PROFILES` entry:

- **Tables** ([[table-detection]]) — declare title + row labels + column headers;
  cell bounds come from the line grid.
- **Charts** ([[chart-detection]]) — flip `chart: True`; the dotted lattice is
  auto-detected and emitted as a `timeseries_chart`.

## Step 4 — Verify visually

Always render the **detection overlay** (fields = coloured boxes, tables = red grid,
chart = blue box + ticks/lanes) over the page image and eyeball it. The pixel-diff
number is lenient (misses dropped thin glyphs); the overlay catches semantic misses.
See [[fidelity-verification]].

## Step 5 — File it

Write `sources/<slug>.md`, update [[index]] and [[log]] (see [[SCHEMA]] → Ingest).

## Effort model

- **Vector, checkbox/blank form** (like [[nota-postanestesica]]): near-mechanical.
  Field detection is generic; only labels may want curation.
- **Vector, tables + chart** (like [[registro-transanestesico]]): add a PROFILE
  (~30 lines) declaring table anchors; chart auto-detects.
- **Scanned**: high effort, low leverage when a clean vector twin exists. Defer.
