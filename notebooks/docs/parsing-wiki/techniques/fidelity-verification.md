---
type: technique
updated: 2026-07-05
tags: [parsing, verification, qa]
---

# Fidelity verification — pixel diff + detection overlays

Two independent checks. The 1:1 clone is verified numerically; the schema is verified
visually. **Use both** — each catches what the other misses.

## Clone fidelity — pixel diff

Render original and clone to PNG at the same DPI (150), resize to match, and compute:

- **mean abs diff / channel** (out of 255) — overall closeness.
- **% visibly-different pixels** — fraction where max channel diff > 40.

Targets we hit:

| Form | mean | visibly diff |
|---|---|---|
| [[nota-postanestesica]] | 3.34/255 | 2.50% |
| [[registro-transanestesico]] | 1.42/255 | 1.04% |

Residual at these levels is antialiasing + the checkbox-square substitution — not
layout or content.

**Locate the diff**, don't just score it: sum the diff mask per row/column to find the
worst bands, and paint differing pixels red on the original (`diff_loc_*.png`). That's
how the phantom-table and dropped-glyph regressions were pinned down.

### The score is lenient — a warning

Dropped thin glyphs barely move the mean (2-1 once read 5.5/255 while visibly missing
several letters). A good number does **not** prove correctness. Always also do the
overlay check below. [[lessons]] #12

## Schema correctness — detection overlay

Render the page image and draw every detected element over it:

- fields as coloured boxes by type (checkbox=green, checkbox_value=blue, number=orange,
  text=purple, open_field=amber),
- tables as a red bbox + row/col cut lines,
- charts as a blue bbox + y-tick marks, hour lines, lane dots, band bars.

Eyeball `nota2_overlay.png` / `nota21_overlay.png`: every input box on the paper form
should have a coloured box, and no box should land on static text. This catches
semantic misses (a lost unit, an unboxed field) that the pixel score can't.

## Artifacts

`../../forms/out/` — `*_clone.pdf`, `o*/c*.png` (orig/clone renders), `side_by_side_*`,
`diff*`, `*_overlay.png`, plus targeted zooms.

## Tooling

PyMuPDF for rasterization, PIL + numpy for diffing. Run in env `forms_p11`.
