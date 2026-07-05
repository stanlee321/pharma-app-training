---
type: technique
updated: 2026-07-05
tags: [parsing, extraction, pymupdf]
---

# Clip-aware source extraction (PyMuPDF)

**Problem it solves.** Excel/Word export forms with content that is *clipped out* of
the visible page — off-print-area duplicates, overflow. pdfplumber returned that
hidden content as if it rendered, and mis-placed some spans. We need "what actually
renders," which is what `pdfsrc.py` provides.

The trigger: form 2-1 ([[registro-transanestesico]]) contains a full **duplicate
Control-de-fluidos table**, clipped away in the original but emitted by pdfplumber —
producing a garbled overlapping clone and phantom fields.

## Text — `_load_chars`

`page.get_text("rawdict")` with **default flags**. The default flags include clip
handling that drops clipped-out spans; overriding them (e.g. adding
`TEXT_PRESERVE_WHITESPACE`) re-admits the phantom. See [[lessons]] #2.

Per char we keep: `text, font, size, color (int→rgb), x0/top/x1/bottom, origin
(baseline pen point), dir (line direction), upright, line_id`.

- `line_id = (block_index, line_index)` — one rawdict *visual line*. Rotated multi-line
  labels ("Anestésicos Inhalados") come as parallel rotated columns; grouping by
  `line_id` reassembles them in reading order (used by `rotated_labels`, see
  [[field-detection]]).
- `origin` is the glyph's baseline pen point — the correct anchor for re-placement
  ([[geometry]]).

## Graphics — `_load_drawings`

`page.get_drawings(extended=True)` yields nodes with a **clip hierarchy** via `level`:

- Maintain a stack of active `(level, scissor Rect)`; pop entries whose level ≥ the
  current node (they've gone out of scope).
- `clip` nodes push their `scissor`. `group` nodes are skipped. Path nodes (`f`/`s`/`fs`)
  are dropped if fully outside every active scissor.
- **Degenerate-rect trap:** pure h/v lines have zero-area rects and
  `Rect.intersects()` is always False for them → inflate by ε before the scissor test,
  or real lines disappear. See [[geometry]] and [[lessons]] #3.

Kept per path: `type, items, rect, scissor, fill, color, width, even_odd`.

Note: fitz scissors are **not precise enough for partial clipping** — we only drop
*fully*-outside paths here. Residual partially-clipped phantom strokes are removed
downstream by the [[ink-oracle]].

## `segments()` — lines for tables

Flattens line-like graphics into axis-aligned `(x0,y,x1)` / `(x,y0,y1)` segments:
stroked lines, rect edges, **and thin filled rects** (Excel borders are skinny fills,
not strokes — [[lessons]] #4), using each thin fill's centerline. Feeds
[[table-detection]] and [[chart-detection]].

## Code

`../../forms/pdfsrc.py` — `load`, `_load_chars`, `_load_drawings`, `segments`.
