---
type: technique
updated: 2026-07-05
tags: [parsing, fonts, fidelity]
---

# Font handling — per-document subsets & glyph-aware substitution

**The core fact: font subsets are per-document.** When a PDF embeds `Calibri`, it
embeds a *subset* containing only the glyphs that document uses, renamed like
`BCDEEE+Calibri`. Two PDFs that both "use Calibri" carry **different** subsets.

**The bug this caused.** `regen.py` initially reused the fonts extracted from form 2 to
render form 2-1. Form 2-1 uses glyphs (its "f", subscripts ₂) absent from form 2's
subset → they rendered blank. And **Calibri is not installed on this Mac**, so there's
no system fallback with the real glyphs. See [[lessons]] #5.

## Solution — `FontMapper` (in `regen.py`)

Per source PDF, at load time:

1. **Extract every embedded font** via `fitz` `doc.extract_font(xref)` → write each
   subset `.ttf`/`.otf` to `forms/fonts/_auto/`, register with ReportLab under a
   sanitised name keyed by its normalized base name (`calibri`, `calibri-bold`, …).
2. **Pick per glyph.** `pick(span_font, text)`:
   - Wingdings → sentinel `"WINGDINGS"` (draw a square, below).
   - Try subsets matching the exact font name; accept the first whose face
     **contains the glyph** (`face.charToGlyph[codepoint]`).
   - Else try any subset of the same family that has the glyph.
   - Else fall back to system **Arial** (regular/bold/italic — the forms already mix
     ArialMT, and Arial *is* installed).

Choosing by actual glyph coverage (not just name) is what makes it robust to
subsetting.

## Wingdings2 checkboxes → drawn squares

The Wingdings2 ballot-box glyph does not round-trip reliably through
extraction→ReportLab. Instead, wherever a Wingdings char sits, **draw a stroked square**
(`size*0.72`). It's visually identical to the ballot box and semantically a checkbox —
which also helps [[field-detection]] treat it as one. See [[lessons]] #9.

## Where the real fonts live

`forms/fonts/` (Calibri regular/bold/italic + Wingdings2, extracted early) and
`forms/fonts/_auto/` (per-run extraction). These embedded subsets are the *only* source
of the real Calibri glyphs on this machine.

## Code

`../../forms/regen.py` — `FontMapper`, `_norm`, `_san`.
