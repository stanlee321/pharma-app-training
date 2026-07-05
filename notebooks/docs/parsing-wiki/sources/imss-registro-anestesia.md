---
type: source
updated: 2026-07-05
tags: [parsing, source, scanned, reconstruction]
form_id: imss_valoracion_preanestesica, imss_registro_anestesia
state: done
---

# Source — IMSS Registro de Anestesia y Recuperación (Tula)

- **File:** `../../data/4-30-60-72 IMSS Tula.pdf`
- **Producer:** Microsoft Word 2016 → PDF · **2 pages** · Letter
- **Type:** **scanned** — each page is a single full-page JPEG. **0 chars, 0 drawings.**
- **State:** ✅ **done** via [[vision-reconstruction]] (2026-07-05).

## What it is

The official IMSS form **"Registro de Anestesia y Recuperación"** (form code
4-30-60/72 · 320 001 3013). Page 1: preanesthetic valuation + complications + Aldrete
recovery-score grid. Page 2: the anesthesia record (vitals grid, medicamentos,
método/técnica, casos obstétricos). Same clinical content as the modern vector forms
([[nota-postanestesica]], [[registro-transanestesico]]) in the old official layout.

## How it was done

No vectors to extract → **reconstructed**, not parsed. See [[vision-reconstruction]]:
1. Rendered the page with its transform applied (page 1's JPEG was stored **180°
   rotated**).
2. Measured the line skeleton by ink projection + **band-restricted** vertical
   detection for the short header dividers; overlaid on the scan to author against
   real point-coordinates.
3. Transcribed every label by vision (4 bands/page).
4. Authored a declarative spec → clean vector PDF + field schema (`imss_gen.py`).

## Results

- **Recreation:** `../../forms/out/imss_recreated.pdf` — a crisp 2-page vector clone.
  Verified by red-on-scan overlay (`forms/out/imss_p{1,2}_overlay.png`): lines track
  the original's rules; minor global drift on the skewed scan, as expected for a clean
  recreation.
- **Schema:** two forms in the standard contract ([[schema-spec]]),
  `source: "scanned-reconstruction"`:
  - `imss_valoracion_preanestesica` — **86 fields** (datos 14, antecedentes 8, orina 7,
    química 12, r.a.q. 5, complicaciones 2 textareas, **aldrete 36 score-cells** across
    6 time columns).
  - `imss_registro_anestesia` — **58 fields** incl. a `vitals_grid` **timeseries_chart**
    (20–240 axis, 5 hour-blocks, TEMP/TA/PULSO/R series, events 1–6), medicamentos A–M,
    método/técnica, casos obstétricos, footer clasificación strip.
  - `../../forms/schema/imss_p1.schema.json`, `imss_p2.schema.json`.

## Known residue

- IMSS logo is a placeholder box (the real mark is a raster; swap in an asset if
  needed).
- Slight vertical drift in page-2 lower half vs the scan (acceptable per the clean-
  recreation target).

## Run

```bash
PY=/Users/stanleysalvatierra/anaconda3/envs/forms_p11/bin/python
$PY forms/imss_gen.py all   # -> forms/out/imss_recreated.pdf + forms/schema/imss_p*.schema.json
```
