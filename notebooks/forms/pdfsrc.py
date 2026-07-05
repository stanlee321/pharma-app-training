"""
Shared, clip-aware page source for the anesthesia-form pipeline.

Built on PyMuPDF because it is the ground truth of what actually RENDERS:
  - text via get_text("rawdict")  -> clip-aware, correct char origins
    (pdfplumber mis-places some Excel-generated spans and includes text
    hidden by clip paths, e.g. the phantom Control-de-fluidos table on 2-1)
  - graphics via get_drawings(extended=True) -> clip 'scissor' rects with a
    'level' hierarchy, so clipped-out paths can be dropped.

Both regen.py (1:1 clone) and schema_extract.py (field schema) consume this.
Coordinates are fitz/pdfplumber-style: origin top-left, y grows DOWN.
"""
import fitz


def _int_to_rgb(v):
    if v is None:
        return (0.0, 0.0, 0.0)
    return (((v >> 16) & 255) / 255.0, ((v >> 8) & 255) / 255.0, (v & 255) / 255.0)


def _load_chars(page):
    chars = []
    # NOTE: default flags matter — they include the clip handling that
    # excludes phantom (clipped-out) spans; overriding them re-admits it.
    raw = page.get_text("rawdict")
    for bi, block in enumerate(raw["blocks"]):
        if block.get("type") != 0:
            continue
        for li, line in enumerate(block["lines"]):
            dx, dy = line["dir"]
            upright = abs(dy) < 1e-3 and dx > 0
            for span in line["spans"]:
                font = span["font"]
                size = span["size"]
                color = _int_to_rgb(span.get("color"))
                for ch in span["chars"]:
                    x0, top, x1, bottom = ch["bbox"]
                    chars.append(dict(
                        text=ch["c"], font=font, size=size, color=color,
                        x0=x0, top=top, x1=x1, bottom=bottom,
                        origin=tuple(ch["origin"]), dir=(dx, dy), upright=upright,
                        line_id=(bi, li),   # rawdict line = one visual text line
                    ))
    return chars


def _load_drawings(page):
    """Visible drawing paths, in paint order, with clipping applied
    (a path fully outside its active scissor is dropped)."""
    out = []
    active = []  # stack of (level, scissor Rect)
    for nd in page.get_drawings(extended=True):
        level = nd.get("level", 0)
        active = [(lv, sc) for (lv, sc) in active if lv < level]
        typ = nd.get("type")
        if typ == "clip":
            sc = nd.get("scissor")
            if sc is not None:
                active.append((level, fitz.Rect(sc)))
            continue
        if typ == "group":
            continue
        # path node ('f', 's', or 'fs')
        rect = fitz.Rect(nd["rect"])
        # pure h/v lines have DEGENERATE rects (zero width/height) and
        # fitz Rect.intersects() is always False for empty rects — inflate
        # by epsilon so real axis-aligned lines survive the scissor test.
        test = fitz.Rect(rect.x0 - 0.2, rect.y0 - 0.2, rect.x1 + 0.2, rect.y1 + 0.2)
        eff = fitz.Rect(page.rect)                     # effective scissor (informational)
        for _, sc in active:
            eff.intersect(sc)
        # drop only when fully outside a scissor — fitz scissors are not
        # precise enough for partial clipping (it removed real table lines);
        # partially-clipped phantom strokes are filtered by regen's ink oracle.
        if any(not test.intersects(sc) for _, sc in active):
            continue
        out.append(dict(
            type=typ,                                  # 'f' | 's' | 'fs'
            items=nd["items"],
            rect=(rect.x0, rect.y0, rect.x1, rect.y1),
            scissor=(eff.x0, eff.y0, eff.x1, eff.y1),  # draw must clip to this
            fill=nd.get("fill"),
            color=nd.get("color"),
            width=nd.get("width") or 0.5,
            even_odd=bool(nd.get("even_odd")),
            fill_opacity=nd.get("fill_opacity", 1.0),
            stroke_opacity=nd.get("stroke_opacity", 1.0),
        ))
    return out


def segments(drawings, axis_tol=0.5):
    """Flatten line-like graphics into horizontal/vertical segments (for
    table-grid detection): stroked lines/rect edges AND thin filled rects
    (Excel draws table borders as skinny fills, not strokes).
    Returns (h_segments, v_segments) as (x0, y, x1) and (x, y0, y1)."""
    hs, vs = [], []

    def add(p1, p2):
        (x0, y0), (x1, y1) = p1, p2
        if abs(y1 - y0) <= axis_tol and abs(x1 - x0) > axis_tol:
            hs.append((min(x0, x1), (y0 + y1) / 2, max(x0, x1)))
        elif abs(x1 - x0) <= axis_tol and abs(y1 - y0) > axis_tol:
            vs.append(((x0 + x1) / 2, min(y0, y1), max(y0, y1)))

    for d in drawings:
        stroked = d["type"] in ("s", "fs")
        filled = d["type"] in ("f", "fs") and d["fill"] is not None
        white = filled and all(v > 0.95 for v in d["fill"][:3])
        for it in d["items"]:
            if it[0] == "l" and stroked:
                add((it[1].x, it[1].y), (it[2].x, it[2].y))
            elif it[0] == "re":
                r = it[1]
                if stroked:
                    add((r.x0, r.y0), (r.x1, r.y0)); add((r.x0, r.y1), (r.x1, r.y1))
                    add((r.x0, r.y0), (r.x0, r.y1)); add((r.x1, r.y0), (r.x1, r.y1))
                elif filled and not white and min(r.width, r.height) < 2.5 \
                        and max(r.width, r.height) > 4:
                    # skinny filled rect == border line: use its centerline
                    if r.width >= r.height:
                        hs.append((r.x0, (r.y0 + r.y1) / 2, r.x1))
                    else:
                        vs.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
    return hs, vs


def load(src_pdf):
    """-> dict(pages=[{width, height, chars, drawings}])"""
    doc = fitz.open(src_pdf)
    pages = []
    for page in doc:
        pages.append(dict(
            width=page.rect.width, height=page.rect.height,
            chars=_load_chars(page), drawings=_load_drawings(page),
        ))
    doc.close()
    return dict(pages=pages)
