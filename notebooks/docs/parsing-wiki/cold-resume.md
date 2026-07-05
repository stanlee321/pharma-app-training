---
type: resume
updated: 2026-07-05
tags: [parsing, orientation]
---

# Cold Resume — orient in 60 seconds

You are maintaining a **PDF form parsing** knowledge base. New session? Read this,
then [[index]].

## What this project does

Turn paper/vector clinical forms into: **(1)** a print-faithful PDF clone and
**(2)** a structured field schema (JSON) that drives a digital form in the app.
See [[strategy]] for the why and the decision tree.

## Where things live

- **Inputs (raw, immutable):** `../../data/*.pdf`
- **Code (the pipeline):** `../../forms/` — `pdfsrc.py`, `regen.py`, `schema_extract.py`
- **Outputs:** `../../forms/schema/*.schema.json`, `../../forms/out/` (clones, overlays, diffs)
- **Env:** conda `forms_p11` — run everything with
  `/Users/stanleysalvatierra/anaconda3/envs/forms_p11/bin/python`

## Run it

```bash
PY=/Users/stanleysalvatierra/anaconda3/envs/forms_p11/bin/python
# 1:1 clone
$PY forms/regen.py "data/<file>.pdf" "forms/out/<slug>_clone.pdf"
# structured schema
$PY forms/schema_extract.py "data/<file>.pdf" "<form_id>" "forms/schema/<slug>.schema.json"
```

## Status (2026-07-05)

| Document | Clone | Schema | State |
|---|---|---|---|
| [[nota-postanestesica]] (2.pdf) | 96.7% (3.34/255) | 254 fields | ✅ done |
| [[registro-transanestesico]] (2-1.pdf) | 99.0% (1.42/255) | 70 fields + 2 tables + 1 chart | ✅ done |
| [[imss-registro-anestesia]] (Tula) | — | — | ⏸ deferred (scanned, OCR track) |

## The 3 things that will bite you

1. **Fonts are per-document subsets** — never reuse one PDF's fonts on another. [[font-handling]]
2. **pdfplumber lies about clipped content** — we extract with PyMuPDF. [[clip-aware-source]]
3. **Zero-width line rects fail fitz intersection tests** — epsilon-inflate. [[geometry]]

Full list: [[lessons]].
