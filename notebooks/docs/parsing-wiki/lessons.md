---
type: lessons
updated: 2026-07-05
tags: [parsing, gotchas]
---

# Lessons — hard-won gotchas

Consolidated so a fresh session doesn't re-discover them. Each links to the technique
page with the full story.

## Extraction

1. **pdfplumber includes clip-hidden phantom content and mis-places some Excel spans.**
   Form 2-1 had a whole clipped-out *duplicate* fluid table that pdfplumber returned
   as if visible. We moved extraction to PyMuPDF. → [[clip-aware-source]]
2. **`get_text("rawdict")` must use DEFAULT flags.** The default flags carry the clip
   handling that excludes phantom spans; passing custom flags (e.g.
   `TEXT_PRESERVE_WHITESPACE`) *re-admits* the phantom. → [[clip-aware-source]]
3. **Degenerate (zero-width/height) rects break `fitz.Rect.intersects()`** — it is
   always `False` for an empty rect, so pure horizontal/vertical lines fail every
   scissor/intersection test and real table borders vanish. **Inflate by ε (~0.2pt)**
   before testing. → [[geometry]]
4. **Excel draws table borders as skinny FILLED rects, not strokes.** Any line
   detector that only looks at `type == 's'` misses the whole grid. Include thin
   fills (min dimension < 2.5pt) and use their centerline. → [[table-detection]]

## Fidelity / rendering

5. **Font subsets are per-document.** Reusing form A's embedded Calibri subset to
   render form B silently drops glyphs missing from A's subset (form 2-1 lost its
   "f" and subscripts). Extract each source's *own* fonts; pick per-glyph via
   `charToGlyph`. Calibri is **not** installed on this Mac, so the embedded subsets
   are the only source of the real glyphs. → [[font-handling]]
6. **The ink oracle must test centerline CONTINUITY, not any-pixel.** A real rendered
   line is continuous ink (~100% coverage along its centerline); an any-pixel test
   false-positives on a phantom line that merely crosses text. Threshold ≥ 0.85. →
   [[ink-oracle]]
7. **Text matrix carries rotation, not scale.** pdfplumber's char matrix is
   `(1,0,0,1,e,f)` for upright text — size is separate; dividing by size shrinks
   everything. In PyMuPDF, use the line `dir` (dx,dy): `transform(dx,-dy,dy,dx,ox,H-oy)`.
   → [[geometry]]
8. **White text is grayscale** and can arrive as a 1-element tuple `(1.0,)`; a
   `len>=3` colour check misses it (this zeroed section-header detection once). →
   [[field-detection]]
9. **Wingdings2 checkbox glyphs are unreliable** across the pdfplumber→ReportLab
   round-trip. Draw a stroked square instead — visually identical and semantically a
   checkbox. → [[font-handling]]

## Field / layout heuristics

10. **Line-bucket by baseline (`bottom`), not `top`.** Underscore fill-blanks sit low;
    bucketing by `top` splits a blank from its trailing unit onto different lines and
    the unit is lost. → [[field-detection]]
11. **Bound an open-field's value area by vertical rules ON THAT LINE's y-band**, not
    by page-wide x-cuts (which truncate at unrelated columns). → [[field-detection]]
12. **The pixel-diff score is lenient** — dropped thin glyphs barely move it (2-1 read
    5.5/255 while visibly missing several letters). Always confirm with the detection
    overlay. → [[fidelity-verification]]
