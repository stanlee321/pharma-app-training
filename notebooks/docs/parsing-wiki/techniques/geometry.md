---
type: technique
updated: 2026-07-05
tags: [parsing, geometry, coordinates]
---

# Geometry — coordinates, placement, the degenerate-rect trap

Cross-cutting geometry facts used by both [[pipeline|regen and schema_extract]].

## Coordinate system

Everything in `pdfsrc` is **top-left origin, y grows down**, in points (matches
pdfplumber's `top`/`bottom` and PyMuPDF rects). bboxes are `[x0, top, x1, bottom]`.

ReportLab is **bottom-left origin**. Convert on the way out: `y_reportlab = H - y_top`.

## Text placement via the matrix / origin

- **pdfplumber** exposes each char's text matrix `(a,b,c,d,e,f)`: `(e,f)` is the
  baseline pen origin in PDF space, `(a,b,c,d)` encode **rotation only** — the font
  *size is separate*. Early bug: normalising the matrix by size (`a/size`) shrank all
  text. Apply `(a,b,c,d)` as-is and set the font size separately. [[lessons]] #7
- **PyMuPDF** (what we use now): each char has `origin` (baseline point) and its line
  has `dir = (dx, dy)`. Place with
  `canvas.transform(dx, -dy, dy, dx, origin_x, H - origin_y)` then `drawString(0,0,text)`.
  The `-dy` flips PyMuPDF's y-down direction into ReportLab's y-up rotation. This
  handles upright and rotated (sidebar) text uniformly.

## The degenerate-rect trap

Pure horizontal/vertical lines are **zero-area rects**. `fitz.Rect.intersects()`
returns **False** for any empty rect, so such lines fail every scissor/intersection
test and get silently dropped — real table borders vanish. Inflate before testing:

```python
test = fitz.Rect(r.x0-0.2, r.y0-0.2, r.x1+0.2, r.y1+0.2)
if any(not test.intersects(sc) for _, sc in active_scissors): drop
```

This was the single nastiest bug in the 2-1 clone. [[lessons]] #3

## Segment classification

An item is a **horizontal** segment if `|Δy| ≤ tol < |Δx|`, **vertical** if the
reverse. Thin filled rects (Excel borders) collapse to their centerline. See
`segments()` in [[clip-aware-source]].

## Line/row clustering

Cluster chars into visual lines by **baseline (`bottom`) with ~3.5pt tolerance**, not
`top` — fill-blank underscores sit low and `top`-bucketing separates a blank from its
unit. [[lessons]] #10, [[field-detection]].

## Code

`../../forms/pdfsrc.py` (`_load_drawings`, `segments`), `../../forms/regen.py`
(`regenerate` transform).
