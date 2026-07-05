---
type: technique
updated: 2026-07-05
tags: [parsing, scanned, reconstruction, vision]
---

# Vision reconstruction — rebuilding a scanned form

For **scanned** forms (image only, zero vectors — see [[strategy|classify]]) the
extraction pipeline ([[clip-aware-source]]) has nothing to read. We don't extract; we
**reconstruct**: measure the geometry, transcribe the labels, and redraw a clean vector
form + schema. Used for [[imss-registro-anestesia]].

Core principle: **measure geometry, don't eyeball it.** Vision reads *labels*
(what it's genuinely needed for); the *line skeleton* is measured off the pixels so the
redraw snaps to real positions.

## Pipeline

```
scanned PDF ─► render page (transform-applied) ─► line skeleton (ink projections)
                                              ─► vision transcription of labels
                                              ─► declarative spec ─► clean vector PDF
                                                                  └► field schema
```

### 1. Render the *page*, not the raw image
`page.get_pixmap()` applies the page's display transform. The embedded JPEG may be
stored rotated (IMSS page 1 was **180° flipped**); `get_images()` returns it raw and
upside-down. Always rasterize the page.

### 2. Measure the line skeleton (ink projections)
Binarize (`pixels < 160` = ink). A **horizontal rule** = a row whose dark-pixel count
exceeds ~35% of width; a **vertical rule** = a column exceeding ~25% of height. Cluster
adjacent hits, convert px→points (`x_pt = x_px * 612/W`).
- The global pass finds long rules but **misses short internal dividers** (e.g. the
  top-header columns). Fix: run **band-restricted** detection — within a given y-band,
  lower the threshold so short dividers in that band register. That gives exact
  per-region column boundaries.
- Overlay the detected rules (with pt labels) back on the scan to author against
  measured coordinates, not guesses.

### 3. Transcribe labels with vision
Cut the page into readable bands (~4 per page), upscale, and read every label. Record
the section/table structure. This is the one step only vision can do.

### 4. Declarative spec → PDF + schema (`imss_gen.py`)
A `Page` builder collects drawing elements (`hline/vline/rect/box/text/…`) **and**
`field(...)` entries. One renderer draws to ReportLab; `emit_schema` writes the fields.
**The spec is the schema** — every writable cell declared once yields both the printed
box and the app-bindable field. Coordinates are top-left points (converted at draw),
identical to the [[schema-spec]] contract, so the app treats a reconstructed form like
any parsed one. Chart-like regions (the vitals grid) emit a `timeseries_chart`
([[chart-detection]] shape) → the app's ChartCanvas.

## Fidelity target

A **clean vector recreation** (crisper than the noisy scan), not a photocopy clone.
Verify by overlaying the redrawn lines (red) on the gray scan: they should track the
original's rules. Small global drift on a skewed scan is acceptable — the goal is
faithful structure + correct labels + a usable schema, not pixel-match to a skew.

## When NOT to use this

If a clean **vector twin** of the same content exists (as the modern NOTA forms are to
the IMSS form), reconstruction is high-effort / low-leverage — prefer the vector twin.
Do this only when that specific official layout is required. See [[strategy]].

## Code

`../../forms/imss_gen.py` (`Page`, `build_page1`, `build_page2`, `render_pdf`,
`emit_schema`), skeleton detection in `../../forms/imss/` (`skeleton_p*.json`).
