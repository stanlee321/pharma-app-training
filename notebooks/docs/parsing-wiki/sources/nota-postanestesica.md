---
type: source
updated: 2026-07-05
tags: [parsing, source, vector]
form_id: nota_postanestesica
state: done
---

# Source — NOTA POSTANESTÉSICA (2.pdf)

- **File:** `../../data/NOTA POST y TRANSANESTÉSICA 2.pdf`
- **Producer:** Microsoft Excel LTSC → PDF · 1 page · Letter (612×792)
- **Type:** vector ([[strategy|classify]]) — full extractable text + drawings
- **Role:** the *postanesthetic note* — narrative/checkbox description of anesthetic
  technique. Companion to [[registro-transanestesico]] (the live record half).

## What it is

A dense single-page checkbox form: 3 rotated sidebar zones (Anestesia General /
Regional Neuroaxial / Bloqueo Periférico), black-bar sub-headers, ~1,400 underscore
fill-blanks, ~184 Wingdings2 checkboxes, subscripts (SpO₂, N₂O, cmH₂O).

## Results

- **Clone:** 96.7% pixel-identical (mean **3.34/255**, 2.50% visibly diff).
  `../../forms/out/nota2_clone.pdf`. Verified: `nota2_overlay.png`, `side_by_side_2.png`.
- **Schema:** **254 fields** — 152 checkbox, 44 checkbox_value, 9 number, 44 text,
  5 open_field; 3 major_sections; 4 subsection headers; 0 tables; 0 charts.
  `../../forms/schema/nota2.schema.json`.

## Profile

None needed — pure [[field-detection]]. `PROFILES["nota_postanestesica"] = {tables:[],
chart:False}`.

## Techniques born here

[[font-handling]] (discovered per-doc subsets; Calibri absent on this Mac),
[[geometry]] (text-matrix placement; white = grayscale tuple), [[field-detection]],
[[fidelity-verification]].

## Known residue / curation notes

- A handful of top-row units (FC/FR/TA…) can split across baseline buckets in edge
  cases — [[geometry]]/[[lessons]] #10 mitigates most.
- Some long ruled lines (Observaciones, table rows) are captured as unlabeled `text`
  fields — expected; they're free-text areas.

## Run

```bash
PY=/Users/stanleysalvatierra/anaconda3/envs/forms_p11/bin/python
$PY forms/regen.py "data/NOTA POST y TRANSANESTÉSICA 2.pdf" forms/out/nota2_clone.pdf
$PY forms/schema_extract.py "data/NOTA POST y TRANSANESTÉSICA 2.pdf" nota_postanestesica forms/schema/nota2.schema.json
```
