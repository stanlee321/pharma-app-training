"""
Primitive-level 1:1 regenerator for the vector anesthesia forms.

Pipeline:  source PDF --(pdfsrc: PyMuPDF, clip-aware)--> primitives
           --(reportlab)--> clone PDF

- Text/graphics come from pdfsrc (what actually renders: clipped-out phantom
  content excluded, correct char origins).
- Fonts: each source PDF's own embedded subsets are extracted and registered;
  at draw time the subset actually containing the glyph is chosen, falling
  back to system Arial. (Font subsets are per-document!)
- Wingdings2 ballot-box glyphs are re-drawn as stroked squares (semantically
  a checkbox, visually equivalent).
"""
import sys, os, re
import fitz
import pdfsrc
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ARIAL_DIR = "/System/Library/Fonts/Supplemental"
AUTO_DIR = "forms/fonts/_auto"


def _san(name):
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)


def _norm(fontname):
    """'BCDFEE+Calibri-Bold' -> 'calibri-bold'"""
    return fontname.split("+")[-1].strip().lower()


class FontMapper:
    """Registers a source PDF's embedded font subsets and picks, per glyph,
    a registered font that actually contains it."""

    def __init__(self, src_pdf):
        os.makedirs(AUTO_DIR, exist_ok=True)
        self.by_name = {}          # normalized source name -> [registered names]
        doc = fitz.open(src_pdf)
        for xref in range(1, doc.xref_length()):
            try:
                name, ext, _, buf = doc.extract_font(xref)
            except Exception:
                continue
            if not buf or ext not in ("ttf", "otf"):
                continue
            reg = _san(f"{name}_{xref}")
            path = f"{AUTO_DIR}/{reg}.{ext}"
            with open(path, "wb") as fh:
                fh.write(buf)
            try:
                pdfmetrics.registerFont(TTFont(reg, path))
            except Exception:
                continue
            self.by_name.setdefault(_norm(name), []).append(reg)
        doc.close()
        for nm, fn in [("Arial", "Arial.ttf"), ("Arial-Bold", "Arial Bold.ttf"),
                       ("Arial-Italic", "Arial Italic.ttf"),
                       ("Arial-BoldItalic", "Arial Bold Italic.ttf")]:
            try:
                pdfmetrics.registerFont(TTFont(nm, f"{ARIAL_DIR}/{fn}"))
            except Exception:
                pass

    @staticmethod
    def _has_glyph(regname, codepoint):
        try:
            face = pdfmetrics.getFont(regname).face
            return codepoint in face.charToGlyph
        except Exception:
            return False

    def _arial(self, n):
        bold = "bold" in n
        ital = "italic" in n or "oblique" in n
        if bold and ital: return "Arial-BoldItalic"
        if bold: return "Arial-Bold"
        if ital: return "Arial-Italic"
        return "Arial"

    def pick(self, span_font, text):
        n = _norm(span_font)
        if "wingding" in n:
            return "WINGDINGS"
        cp = ord(text) if text else 32
        exact = self.by_name.get(n, [])
        for reg in exact:                       # exact subset name match
            if self._has_glyph(reg, cp):
                return reg
        fam = n.split("-")[0].replace("mt", "")
        for key, regs in self.by_name.items():  # same family, any subset
            if key.split("-")[0].replace("mt", "") == fam:
                for reg in regs:
                    if self._has_glyph(reg, cp):
                        return reg
        return self._arial(n)                   # system fallback


def _set_colors(c, fill, stroke):
    if fill is not None:
        c.setFillColorRGB(*fill[:3]) if len(fill) >= 3 else c.setFillGray(fill[0])
    if stroke is not None:
        c.setStrokeColorRGB(*stroke[:3]) if len(stroke) >= 3 else c.setStrokeGray(stroke[0])


class InkOracle:
    """Rasterizes the ORIGINAL page and answers: does the source render show
    ink along this segment? Used to drop phantom strokes that survive the
    scissor test (clipped-out content partially overlapping visible areas)."""

    def __init__(self, src_pdf, page_index, dpi=150, dark=245):
        import numpy as np
        self._np = np
        doc = fitz.open(src_pdf)
        pix = doc[page_index].get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72))
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        self.gray = arr[..., :3].min(axis=2)
        self.sc = dpi / 72
        self.dark = dark
        doc.close()

    def seg_coverage(self, x0, y0, x1, y1, band=1.2):
        """Fraction of the segment's length that has ink under it (0..1)."""
        np, sc = self._np, self.sc
        h, w = self.gray.shape
        horizontal = abs(x1 - x0) >= abs(y1 - y0)
        if horizontal:
            a0, a1 = sorted((x0, x1)); c0, c1 = y0, y1
        else:
            a0, a1 = sorted((y0, y1)); c0, c1 = x0, x1
        A0, A1 = int(a0 * sc), int(a1 * sc) + 1
        C0 = max(int((min(c0, c1) - band) * sc), 0)
        C1 = int((max(c0, c1) + band) * sc) + 1
        if horizontal:
            strip = self.gray[max(C0, 0):min(C1, h), max(A0, 0):min(A1, w)]
            cols = (strip < self.dark).any(axis=0)
        else:
            strip = self.gray[max(A0, 0):min(A1, h), max(C0, 0):min(C1, w)]
            cols = (strip < self.dark).any(axis=1)
        return float(cols.mean()) if cols.size else 0.0

    # A real rendered line is CONTINUOUS ink (~100% coverage); a phantom line
    # crossing text/other lines picks up only patchy coverage (<~60%).
    def stroke_visible(self, op, it, min_cov=0.85):
        if op == "l":
            return self.seg_coverage(it[1].x, it[1].y, it[2].x, it[2].y) >= min_cov
        if op == "re":
            r = it[1]
            if min(r.width, r.height) < 2.5:
                # thin border rect == a line: judge its CENTERLINE only
                # (short edges are point samples that give false positives)
                if r.width >= r.height:
                    cy = (r.y0 + r.y1) / 2
                    return self.seg_coverage(r.x0, cy, r.x1, cy) >= min_cov
                cx = (r.x0 + r.x1) / 2
                return self.seg_coverage(cx, r.y0, cx, r.y1) >= min_cov
            edges = [(r.x0, r.y0, r.x1, r.y0), (r.x0, r.y1, r.x1, r.y1),
                     (r.x0, r.y0, r.x0, r.y1), (r.x1, r.y0, r.x1, r.y1)]
            return any(self.seg_coverage(*e) >= min_cov for e in edges)
        if op == "c":
            return self.seg_coverage(it[1].x, it[1].y, it[4].x, it[4].y, band=2.0) >= 0.15
        return True


def _draw_path(c, d, H, oracle=None):
    do_fill = d["type"] in ("f", "fs") and d["fill"] is not None
    do_stroke = d["type"] in ("s", "fs") and d["color"] is not None
    if not do_fill and not do_stroke:
        return
    _set_colors(c, d["fill"] if do_fill else None, d["color"] if do_stroke else None)
    if do_stroke:
        c.setLineWidth(max(d["width"], 0.3))
    # phantom candidates are LINE-LIKE elements: stroked lines, or Excel-style
    # borders drawn as skinny filled rects. Judge per ITEM (a single path may
    # bundle many border rects, so the path bbox is useless for thinness).
    white_fill = do_fill and d["fill"] and all(v > 0.95 for v in d["fill"][:3])
    may_check = oracle is not None and not white_fill

    def is_phantom(op, it):
        if not may_check:
            return False
        if op == "l" and do_stroke:
            return not oracle.stroke_visible(op, it)
        if op == "re":
            r = it[1]
            if min(r.width, r.height) < 2.5 and max(r.width, r.height) > 4:
                return not oracle.stroke_visible(op, it)
        return False

    p = c.beginPath()
    drew = False
    for it in d["items"]:
        op = it[0]
        if is_phantom(op, it):
            continue
        if op == "re":
            r = it[1]
            p.rect(r.x0, H - r.y1, r.width, r.height)
        elif op == "l":
            p.moveTo(it[1].x, H - it[1].y)
            p.lineTo(it[2].x, H - it[2].y)
        elif op == "c":
            p.moveTo(it[1].x, H - it[1].y)
            p.curveTo(it[2].x, H - it[2].y, it[3].x, H - it[3].y, it[4].x, H - it[4].y)
        elif op == "qu":
            q = it[1]
            p.moveTo(q.ul.x, H - q.ul.y)
            for pt in (q.ur, q.lr, q.ll):
                p.lineTo(pt.x, H - pt.y)
            p.close()
        else:
            continue
        drew = True
    if drew:
        c.drawPath(p, stroke=1 if do_stroke else 0, fill=1 if do_fill else 0,
                   fillMode=1 if d["even_odd"] else 0)


def regenerate(src_pdf: str, out_pdf: str):
    fonts = FontMapper(src_pdf)
    data = pdfsrc.load(src_pdf)
    first = data["pages"][0]
    c = canvas.Canvas(out_pdf, pagesize=(first["width"], first["height"]))

    for pi, page in enumerate(data["pages"]):
        H = page["height"]
        oracle = InkOracle(src_pdf, pi)
        # graphics first (forms are background graphics + text on top)
        for d in page["drawings"]:
            _draw_path(c, d, H, oracle)
        # then text
        for ch in page["chars"]:
            if ch["text"] in (" ", " ", ""):
                continue
            reg = fonts.pick(ch["font"], ch["text"])
            size = ch["size"] or 1.0
            ox, oy = ch["origin"]
            dx, dy = ch["dir"]
            # fitz y-down direction -> y-up rotation matrix
            a, b, cc, dd = dx, -dy, dy, dx
            c.saveState()
            c.transform(a, b, cc, dd, ox, H - oy)
            if reg == "WINGDINGS":
                s = size * 0.72
                c.setStrokeColorRGB(0, 0, 0)
                c.setLineWidth(0.6)
                c.rect(0, 0, s, s, stroke=1, fill=0)
            else:
                c.setFillColorRGB(*ch["color"])
                c.setFont(reg, size)
                c.drawString(0, 0, ch["text"])
            c.restoreState()
        c.showPage()
    c.save()
    print(f"wrote {out_pdf}")


if __name__ == "__main__":
    regenerate(sys.argv[1], sys.argv[2])
