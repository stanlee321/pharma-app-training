---
type: technique
updated: 2026-07-05
tags: [parsing, phantom-filter, verification]
---

# Ink oracle — render-and-verify phantom filter

**Problem.** Some phantom (clipped-out) strokes survive the scissor test in
[[clip-aware-source]] because fitz scissors aren't precise enough for *partial*
clipping. We need a final arbiter of "does this line actually appear?"

**Idea.** The original render is ground truth. Rasterize it once, then for any
candidate line ask: *is there continuous ink under it?* If not, it's phantom — drop it.

## `InkOracle` (in `regen.py`)

- Rasterize the source page at **150 dpi**; keep the min-over-RGB grayscale (darkest
  channel → ink).
- `seg_coverage(x0,y0,x1,y1, band)` → fraction of the segment's length (sampled along
  its long axis, within a ±band strip) that has a dark pixel. `1.0` = ink the whole
  way; `0.3` = patchy.
- `stroke_visible(op, item, min_cov=0.85)` → `True` if coverage along the item's
  **centerline** ≥ 0.85.

## Why centerline continuity, not any-pixel

A real rendered line is **continuous** ink along its centerline. A phantom line that
merely *crosses* text picks up ink at the crossings — so an any-pixel or edge-sampling
test **false-positives**. Testing the centerline for high continuous coverage
distinguishes a true rule from a phantom. Threshold 0.85 was the sweet spot. See
[[lessons]] #6.

Also: for a thin border rect, judge its **centerline only** — its short end-edges are
point samples that give false positives.

## Two consumers

1. **`regen.py`** — `_draw_path` skips line-like items (`l` strokes; thin `re` fills
   with `min<2.5 < max`) that fail `stroke_visible`, so phantom borders never draw.
   White fills are exempt (they legitimately have no ink).
2. **`schema_extract.py`** — filters `segments()` output (keep segments with
   `seg_coverage ≥ 0.8`) before [[table-detection]], so phantom grid lines don't
   fabricate table cells.

## Cost

One 150-dpi rasterization per page (~cheap). This is a *verification-in-the-loop*
pattern — the generator checks itself against the source render.

## Code

`../../forms/regen.py` — `InkOracle`, used in `_draw_path` and by `schema_extract.extract`.
