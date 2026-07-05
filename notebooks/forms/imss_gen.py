"""
Vision-reconstruction generator for the scanned IMSS form
"4-30-60/72 Registro de Anestesia y Recuperación".

The source is a scanned JPEG (no vectors), so we cannot extract primitives. Instead:
  1. line skeleton measured from the scan (forms/imss/skeleton_p*.json + band detection)
  2. labels transcribed by vision
  3. a DECLARATIVE spec (build_page1 / build_page2) drawn as a clean vector PDF
     AND emitted as the field schema (same contract as forms/schema/*.schema.json).

The spec IS the schema: every `field(...)` becomes a schema entry.
Coordinates: points, TOP-LEFT origin, y grows down (converted to ReportLab at draw).
"""
import sys, json
from reportlab.pdfgen import canvas

W, H = 612.0, 792.0
FN, FB = "Helvetica", "Helvetica-Bold"


class Page:
    def __init__(self, form_id):
        self.form_id = form_id
        self.el = []       # drawing elements
        self.fields = []   # schema fields

    # ---- primitives (top-left coords) ----
    def hline(self, y, x0, x1, w=0.7):
        self.el.append(("h", y, x0, x1, w))

    def vline(self, x, y0, y1, w=0.7):
        self.el.append(("v", x, y0, y1, w))

    def rect(self, x0, y0, x1, y1, w=0.8):
        self.el.append(("r", x0, y0, x1, y1, w))

    def box(self, cx, cy, w, h):
        self.rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, 0.7)

    def arrow_down(self, x, y0, y1, w=0.9):
        self.el.append(("a", x, y0, y1, w))

    # ---- text: (x, y=baseline), align h ∈ l|c|r ----
    def text(self, x, y, s, size=7.2, bold=False, align="l", rot=0):
        self.el.append(("t", x, y, s, size, bold, align, rot))

    def ctext(self, cx, cy, s, size=7.2, bold=False):
        self.text(cx, cy + size * 0.34, s, size, bold, "c")

    def ltext(self, x, cy, s, size=7.2, bold=False):
        self.text(x, cy + size * 0.34, s, size, bold, "l")

    # ---- a header/label row with column dividers + centered labels ----
    def cols(self, y0, y1, xs, labels, size=7.2, bold=False, verticals=True):
        if verticals:
            for x in xs:
                self.vline(x, y0, y1)
        cy = (y0 + y1) / 2
        for i, lab in enumerate(labels):
            if lab:
                self.ctext((xs[i] + xs[i + 1]) / 2, cy, lab, size, bold)

    # ---- evenly spaced labels across [x0,x1] with no rules (sub-headers) ----
    def spread(self, y0, y1, x0, x1, labels, size=7.2, bold=False):
        cy = (y0 + y1) / 2
        n = len(labels)
        for i, lab in enumerate(labels):
            cx = x0 + (x1 - x0) * (i + 0.5) / n
            self.ctext(cx, cy, lab, size, bold)

    # ---- schema field ----
    def field(self, fid, x0, y0, x1, y1, label=None, kind="text", unit=None,
              section=None):
        self.fields.append(dict(id=fid, type=kind, label=label, unit=unit,
                                section=section,
                                bbox=[round(x0, 1), round(y0, 1),
                                      round(x1, 1), round(y1, 1)]))


# --------------------------------------------------------------------- render

def render_pdf(pages, out_pdf):
    c = canvas.Canvas(out_pdf, pagesize=(W, H))
    for pg in pages:
        for e in pg.el:
            k = e[0]
            if k == "h":
                _, y, x0, x1, w = e
                c.setLineWidth(w); c.line(x0, H - y, x1, H - y)
            elif k == "v":
                _, x, y0, y1, w = e
                c.setLineWidth(w); c.line(x, H - y0, x, H - y1)
            elif k == "r":
                _, x0, y0, x1, y1, w = e
                c.setLineWidth(w); c.rect(x0, H - y1, x1 - x0, y1 - y0, stroke=1, fill=0)
            elif k == "a":
                _, x, y0, y1, w = e
                c.setLineWidth(w); c.line(x, H - y0, x, H - y1)
                for dx in (-2.2, 2.2):
                    c.line(x, H - y1, x + dx, H - (y1 - 3))
            elif k == "m":            # registration corner bracket
                _, cx, cy = e
                c.setLineWidth(0.8)
                c.line(cx, H - cy, cx + 12, H - cy)
                c.line(cx, H - cy, cx, H - (cy - 12))
            elif k == "arrow":        # horizontal arrow ->
                _, x0, x1, y = e
                c.setLineWidth(0.9); c.line(x0, H - y, x1, H - y)
                for dy in (-2.2, 2.2):
                    c.line(x1, H - y, x1 - 3, H - y + dy)
            elif k == "sym":          # legend glyph
                _, x, cy, kind = e
                yy = H - cy
                c.setLineWidth(0.8)
                if kind == "tri":
                    c.line(x - 4, yy - 3, x + 4, yy - 3)
                    c.line(x - 4, yy - 3, x, yy + 4); c.line(x + 4, yy - 3, x, yy + 4)
                elif kind == "x":
                    c.line(x - 4, yy - 4, x + 4, yy + 4); c.line(x - 4, yy + 4, x + 4, yy - 4)
                elif kind == "dot":
                    c.circle(x, yy, 1.8, stroke=0, fill=1)
                elif kind == "circ":
                    c.circle(x, yy, 3.2, stroke=1, fill=0)
            elif k == "t":
                _, x, y, s, size, bold, align, rot = e
                c.saveState()
                c.setFont(FB if bold else FN, size)
                c.translate(x, H - y)
                if rot:
                    c.rotate(rot)
                if align == "c":
                    c.drawCentredString(0, 0, s)
                elif align == "r":
                    c.drawRightString(0, 0, s)
                else:
                    c.drawString(0, 0, s)
                c.restoreState()
        c.showPage()
    c.save()
    print("wrote", out_pdf)


def emit_schema(pg, out_json):
    sch = dict(form_id=pg.form_id, source="scanned-reconstruction",
               page=dict(width=W, height=H), fields=pg.fields)
    json.dump(sch, open(out_json, "w"), ensure_ascii=False, indent=2)
    print(f"{pg.form_id}: {len(pg.fields)} fields -> {out_json}")


# --------------------------------------------------------- PAGE 1: Preanestésica

def build_page1():
    p = Page("imss_valoracion_preanestesica")
    L, R = 20.0, 594.0
    p.rect(L, 28, R, 781, 1.0)                      # outer frame

    # title
    p.ctext((L + R) / 2, 20, "VALORACION PREANESTESICA", 10, True)

    # -- signos header (28-40 labels) + data (40-61) --
    sx = [20, 47, 76, 132, 162, 195, 227, 260, 293, 387, 420, 452, 485, 556, 594]
    slab = ["EDAD", "SEXO", "ESTATURA", "PESO", "TA", "P", "R", "T", "TEGUMENTOS",
            "Hb", "Hto", "Rh", "GRUPO SANGUINEO", "T. PROT."]
    p.cols(28, 40, sx, slab, 6.6, False)
    for x in sx:
        p.vline(x, 40, 61)
    p.hline(40, L, R); p.hline(61, L, R)
    for i, lab in enumerate(slab):
        p.field(f"pre_{lab.lower().replace(' ','_').replace('.','')}",
                sx[i], 40, sx[i + 1], 61, label=lab, section="datos")

    # -- antecedentes header (61-72) + data (72-93) --
    ax = [20, 162, 227, 301, 361, 432, 594]
    alab = ["ANTECEDENTES ANESTESICOS", "ALERGIA", "DENTADURA", "CUELLO",
            "ESTADO PSIQUICO", "OTROS"]
    p.cols(61, 72, ax, alab, 6.6, False)
    for x in ax:
        p.vline(x, 72, 93)
    p.hline(72, L, R); p.hline(93, L, R)
    for i, lab in enumerate(alab):
        p.field(f"ant_{lab.split()[0].lower()}", ax[i], 72, ax[i + 1], 93,
                label=lab, section="antecedentes")

    # -- aparato respiratorio / cardio-vascular --
    for (y0, y1, lab, fid) in [(93, 113, "APARATO\nRESPIRATORIO", "aparato_respiratorio"),
                               (113, 133, "APARATO CARDIO-\nVASCULAR", "aparato_cardiovascular")]:
        p.hline(y1, L, R); p.vline(76, y0, y1)
        _multiline(p, 48, (y0 + y1) / 2, lab, 7.0, False)
        p.field(fid, 76, y0, R, y1, label=lab.replace("\n", " "), section="exploracion")

    # -- orina --
    p.vline(76, 133, 154); p.hline(154, L, R)
    _multiline(p, 48, 143.5, "ORINA", 7.2, False)
    p.spread(133, 154, 76, R, ["DENSIDAD", "ALBUMINA", "CILINDROS", "HEMATURIA",
                               "BILIRRUBINA", "GLUCOSA", "ACETONA"], 7.0)
    for i, lab in enumerate(["densidad", "albumina", "cilindros", "hematuria",
                             "bilirrubina", "glucosa", "acetona"]):
        w = (R - 76) / 7
        p.field(f"orina_{lab}", 76 + i * w, 133, 76 + (i + 1) * w, 154,
                label=lab, section="orina")

    # -- quimica sanguinea --
    p.vline(76, 154, 174); p.hline(174, L, R)
    _multiline(p, 48, 164, "QUIMICA\nSANGUINEA", 7.0, False)
    qlab = ["UREA", "CREATININA", "GLUCOSA", "ALBUMINA", "GLOBULINA", "PO2", "PCO2",
            "SAT % Hb", "pH", "K", "CL", "Na"]
    p.spread(154, 174, 76, R, qlab, 6.8)
    for i, lab in enumerate(qlab):
        w = (R - 76) / len(qlab)
        p.field(f"quim_{lab.lower().replace(' ','').replace('%','pct')}",
                76 + i * w, 154, 76 + (i + 1) * w, 174, label=lab, section="quimica")

    # -- medicamentos previos / analgesica obstetrica --
    for (y0, y1, lab, fid) in [(174, 195, "MEDICAMENTOS\nPREVIOS", "medicamentos_previos"),
                               (195, 215, "ANALGESICA\nOBSTETRICA", "analgesica_obstetrica")]:
        p.hline(y1, L, R); p.vline(76, y0, y1)
        _multiline(p, 48, (y0 + y1) / 2, lab, 7.0, False)
        p.field(fid, 76, y0, R, y1, label=lab.replace("\n", " "), section="antecedentes")

    # -- r.a.q. : 5 blocks [E/U  n  A/B] --
    p.vline(76, 215, 236); p.hline(236, L, R)
    _multiline(p, 48, 225.5, "r.a.q.", 7.2, False)
    bx = [76, 180, 283, 387, 491, 594]
    for i in range(5):
        x0, x1 = bx[i], bx[i + 1]
        p.vline(x1, 215, 236)
        p.text(x0 + 8, 224, "E", 6.6); p.text(x0 + 8, 233, "U", 6.6)
        p.ctext((x0 + x1) / 2, 225.5, str(i + 1), 8, False)
        p.text(x1 - 14, 224, "A", 6.6); p.text(x1 - 14, 233, "B", 6.6)
        p.field(f"raq_{i+1}", x0, 215, x1, 236, label=f"r.a.q. {i+1}", section="raq")

    # -- complicaciones (two header bands + writing boxes) --
    p.hline(250, L, R); p.ctext((L + R) / 2, 243, "COMPLICACIONES TRANSANESTESICA", 9, True)
    p.hline(339, L, R)
    p.field("complic_transanestesica", L, 250, R, 339, label="Complicaciones transanestésica",
            kind="textarea", section="complicaciones")
    p.hline(353, L, R); p.ctext((L + R) / 2, 346, "COMPLICACIONES POSTANESTESICAS", 9, True)
    p.hline(442, L, R)
    p.field("complic_postanestesicas", L, 353, R, 442, label="Complicaciones postanestésicas",
            kind="textarea", section="complicaciones")

    _build_aldrete(p, L, R)

    # footer id
    p.text(L, 789, "320 001 3013 REV.", 6.0)
    return p


def _build_aldrete(p, L, R):
    # left title box + right time-column headers
    xcut = [277, 336, 387, 438, 489, 540, 591]   # 6 box columns
    times = ["AL SALIR", "0 min.", "20 min.", "60 min.", "90 min.", "120 min."]
    # left title
    p.vline(277, 442, 476)
    _multiline(p, (L + 277) / 2, 459, "VALORACION DE LA RECUPERACION ANESTESICA",
               8.4, True, cx=True, width=34)
    # header row 1: QUIROFANO | SALA DE RECUPERACION
    p.hline(461, 277, R)
    p.vline(336, 445, 476)
    p.ctext((277 + 336) / 2, 453, "QUIROFANO", 6.8, False)
    p.ctext((336 + R) / 2, 453, "SALA DE RECUPERACION", 8, True)
    # header row 2: time labels
    p.hline(476, L, R)
    for i in range(6):
        p.vline(xcut[i], 461, 476)
        p.ctext((xcut[i] + xcut[i + 1]) / 2, 468.5, times[i], 6.8)
    p.vline(591, 461, 781)

    rows = [
        (476, 528, "ACTIVIDAD\nMUSCULAR",
         ["MOVIMIENTOS VOLUNTARIOS (4 EXTREMIDADES) = 2",
          "MOVIMIENTOS VOLUNTARIOS (2 EXTREMIDADES) = 1",
          "COMPLETAMENTE INMOVIL..................................... = 0"]),
        (528, 582, "RESPIRA-\nCION",
         ["RESPIRACIONES AMPLIAS Y CAPAZ DE TOSER......... = 2",
          "RESPIRACIONES LIMITADAS Y TOS DEBIL.............. = 1",
          "APNEA.................................................................. = 0",
          "(FRECUENCIA = F)"]),
        (582, 636, "CIRCULA-\nCION",
         ["TENSION ARTERIAL: +-20 / DE CIFRAS DE CONTROL = 2",
          "TENSION ARTERIAL: +-20 50 / DE CIFRAS DE CONTROL = 1",
          "TENSION ARTERIAL: +-50 / DE CIFRAS DE CONTROL = 0",
          "( FRECUENCIA DE PULSO = P) (Y TENSION ARTERIAL = TA)"]),
        (636, 691, "ESTADO DE\nCONCIENCIA",
         ["COMPLETAMENTE DESPIERTO................................. = 2",
          "RESPONDE AL SER LLAMADO................................ = 1",
          "NO RESPONDE...................................................... = 0"]),
        (691, 745, "COLORA-\nCION",
         ["MUCOSAS SONROSADAS......................................... = 2",
          "PALIDA................................................................ = 1",
          "CIANOSAS............................................................ = 0"]),
    ]
    centers = [(xcut[i] + xcut[i + 1]) / 2 for i in range(6)]
    for ri, (y0, y1, cat, lines) in enumerate(rows):
        p.hline(y1, L, R)
        p.vline(72, y0, y1); p.vline(277, y0, y1)
        _multiline(p, (L + 72) / 2, (y0 + y1) / 2, cat, 7.0, False, cx=True)
        yy = y0 + 12
        for ln in lines:
            p.text(78, yy, ln, 6.6); yy += 10.5
        # boxes per time column (connectors drawn once, below)
        cy = (y0 + y1) / 2
        for ci, cx in enumerate(centers):
            p.box(cx, cy, 20, 24)
            p.field(f"aldrete_{_slug(cat)}_c{ci}", xcut[ci], y0, xcut[ci + 1], y1,
                    label=f"{cat.replace(chr(10),' ')} @ {times[ci]}", kind="score",
                    section="aldrete")
    # connectors between consecutive box rows
    rc = [(rows[i][0] + rows[i][1]) / 2 for i in range(5)]
    for ci, cx in enumerate(centers):
        for i in range(4):
            p.vline(cx, rc[i] + 12, rc[i + 1] - 12)
        p.arrow_down(cx, rc[4] + 12, 745)   # into total row

    # bottom: ALTA A SU PISO / MEDICO RESPONSABLE | TOTAL | 6 total boxes
    p.hline(781, L, R)
    p.vline(215, 745, 781); p.vline(277, 745, 781)
    p.ltext(26, 754, "ALTA A SU PISO", 7.2)
    p.ltext(26, 772, "MEDICO RESPONSABLE", 7.2)
    p.ctext((215 + 277) / 2, 763, "TOTAL", 8, True)
    for ci in range(6):
        p.vline(xcut[ci], 745, 781)
        p.box(centers[ci], 763, 20, 24)
        p.field(f"aldrete_total_c{ci}", xcut[ci], 745, xcut[ci + 1], 781,
                label=f"TOTAL @ {times[ci]}", kind="score", section="aldrete")


# ---- helpers ----

def _slug(s):
    return s.replace("\n", "").replace("-", "").replace(" ", "").lower()[:10]


def _multiline(p, x, cy, text, size, bold, cx=False, width=None):
    lines = text.split("\n")
    total = len(lines)
    y = cy - (total - 1) * (size + 1.5) / 2
    for ln in lines:
        if cx:
            p.text(x, y + size * 0.34, ln, size, bold, "c")
        else:
            p.text(x, y + size * 0.34, ln, size, bold, "c")
        y += size + 1.5


# --------------------------------------------------- PAGE 2: Registro de Anestesia

def build_page2():
    p = Page("imss_registro_anestesia")
    L, R = 20.0, 590.0

    # ---------- header ----------
    p.rect(24, 30, 80, 68, 0.8)                       # logo placeholder box
    p.ctext(52, 52, "IMSS", 15, True)
    p.text(90, 40, "INSTITUTO MEXICANO DEL SEGURO SOCIAL", 9, True)
    p.text(90, 52, "DIRECCION DE PRESTACIONES MEDICAS", 8, False)
    p.ctext(400, 44, "REGISTRO DE ANESTESIA", 12, True)
    p.ctext(400, 60, "Y RECUPERACION", 12, True)
    p.text(560, 32, "4-30-60/72", 8, False)
    # registration corner marks + CAMA
    for cx in (150, 330, 470):
        p.el.append(("m", cx, 95))
    p.text(430, 120, "CAMA", 9, False)
    p.field("cama", 340, 108, 420, 122, label="Cama", section="header")

    # ---------- vitals grid ----------
    GL, GR = 117.0, R
    blocks = [117, 211.6, 306.2, 400.8, 495.4, 590]
    gy_top, agentes_top, scale_top, scale_bot, tiempo_bot = 163.0, 177.0, 258.0, 440.0, 463.0
    p.rect(L, gy_top, R, tiempo_bot, 0.9)
    # 15/30/45 header per block
    p.vline(GL, gy_top, scale_bot)
    for b in range(5):
        x0, x1 = blocks[b], blocks[b + 1]
        p.vline(x1, gy_top, scale_bot, 0.9)
        for k, lab in enumerate(["15", "30", "45"]):
            p.ctext(x0 + (x1 - x0) * (k + 0.5) / 3, gy_top + 8, lab, 7.2)
    p.hline(agentes_top, GL, GR)
    # AGENTES block (label + 6 writing sub-rows)
    p.vline(99, agentes_top, scale_bot)
    _multiline(p, 59, (agentes_top + scale_top) / 2, "AGENTES", 8, False, cx=True)
    for i in range(1, 6):
        yy = agentes_top + (scale_top - agentes_top) * i / 6
        p.hline(yy, 99, GR, 0.4)
    p.hline(scale_top, L, GR)
    p.field("agentes", 99, agentes_top, GR, scale_top, label="Agentes", kind="textarea",
            section="grid")

    # value scale 240..20 + fine lattice
    labels = list(range(240, 0, -20))     # 240..20 (12)
    for i, val in enumerate(labels):
        yy = scale_top + (scale_bot - scale_top) * i / (len(labels) - 1)
        heavy = val % 40 == 0
        p.hline(yy, GL, GR, 0.6 if heavy else 0.3)
        p.text(113, yy + 2.5, str(val), 7.0, False, "r")
    # fine vertical lattice: 6 subcols per block
    for b in range(5):
        x0, x1 = blocks[b], blocks[b + 1]
        for k in range(1, 6):
            p.vline(x0 + (x1 - x0) * k / 6, scale_top, scale_bot, 0.3)

    # left legend: symbols + names, then numbered events
    legend = [("TEMP.", "tri"), ("T. A.", "x"), ("PULSO", "dot"), ("R.", "circ")]
    events = [("1.", "LLEG. QUIR"), ("2.", "1. ANEST."), ("3.", "1. OPER."),
              ("4.", "T. OPER."), ("5.", "T. ANEST."), ("6.", "P. REC."), ("Ø", "F.C.F.")]
    seq = legend + [("ev", e) for e in events]
    y0leg = scale_top + 4
    step = (scale_bot - 6 - y0leg) / len(seq)
    for i, item in enumerate(seq):
        cy = y0leg + step * (i + 0.5)
        if item[1] in ("tri", "x", "dot", "circ"):
            p.el.append(("sym", 28, cy, item[1]))
            p.text(40, cy + 2.5, item[0], 7.2)
        else:
            num, name = item[1]
            p.text(24, cy + 2.5, num, 7.0)
            p.text(44, cy + 2.5, name, 7.0)

    # TIEMPO 1 A 6 row
    p.hline(tiempo_bot, L, R)
    p.text(26, 449, "TIEMPO", 7.6); p.text(26, 459, "1 A 6", 7.6)
    p.el.append(("arrow", 70, 116, 454))
    p.vline(GL, scale_bot, tiempo_bot); p.vline(353, scale_bot, tiempo_bot)
    p.field("tiempo_1a6_a", GL, scale_bot, 353, tiempo_bot, label="Tiempo 1-6 A", section="grid")
    p.field("tiempo_1a6_b", 353, scale_bot, R, tiempo_bot, label="Tiempo 1-6 B", section="grid")
    p._chart = dict(id="vitals_grid", type="timeseries_chart",
                    bbox=[GL, scale_top, GR, scale_bot],
                    y_axis=dict(min=20, max=240, ticks=labels),
                    x_axis=dict(blocks=blocks, subcols=["15", "30", "45"]),
                    series=[s[0] for s in legend], events=[e[1] for e in events],
                    agentes_bbox=[99, agentes_top, GR, scale_top])

    _build_p2_lower(p, L, R)
    p.text(L, 789, "320 001 3013 ANV.", 6.0)
    return p


def _build_p2_lower(p, L, R):
    MID = 327.0
    # ---- left: diagnostico / operacion ----
    p.rect(L, 463, R, 776, 0.9)
    p.vline(99, 463, 520); p.vline(MID, 463, 776)
    rows_d = [(463, 477, "DIAGNOSTICO:", "PREOPERATORIO:", "diag_preop"),
              (477, 490, "", "OPERATORIO:", "diag_oper"),
              (490, 505, "OPERACION:", "PROPUESTA:", "oper_prop"),
              (505, 520, "", "REALIZADA:", "oper_real")]
    for y0, y1, lab, sub, fid in rows_d:
        p.hline(y1, L, MID)
        if lab:
            p.ltext(24, (y0 + y1) / 2, lab, 7.6, False)
        p.text(103, (y0 + y1) / 2 + 2.5, sub, 7.2)
        p.field(fid, 99, y0, MID, y1, label=sub.strip(":"), section="diagnostico")

    # ---- medicamentos / metodo header ----
    p.hline(520, L, MID); p.hline(535, L, MID)
    mcols = [20, 35, 99, 155, MID]
    for x in mcols:
        p.vline(x, 520, 710)
    p.ctext((20 + 99) / 2, 527.5, "MEDICAMENTOS:", 7.2, False)
    p.ctext((99 + 155) / 2, 527.5, "DOSIS VIA", 7.2, False)
    p.ctext((155 + MID) / 2, 527.5, "METODO Y TECNICA ANESTESICA", 7.0, False)

    # rows A..M
    letters = list("ABCDEFGHIJKLM")
    ry = [535 + i * (710 - 535) / 13 for i in range(14)]
    for i, L_ in enumerate(letters):
        y0, y1 = ry[i], ry[i + 1]
        p.hline(y1, L, 155)
        p.ctext((20 + 35) / 2, (y0 + y1) / 2, L_, 7.0)
        p.field(f"med_{L_}_nombre", 35, y0, 99, y1, label=f"Medicamento {L_}", section="medicamentos")
        p.field(f"med_{L_}_dosis", 99, y0, 155, y1, label=f"Dosis/Vía {L_}", section="medicamentos")

    # metodo y tecnica content (right of col 155)
    mt = [
        (535, 552, "INDUCCION: IV____ I.M.____ INHALACION____"),
        (552, 567, "MASCARILLA:  SI________ NO__________"),
        (567, 581, "CANULA FARINGEA: NAS.______ ORAL______"),
    ]
    for y0, y1, s in mt:
        p.hline(y1, 155, MID)
        p.text(160, (y0 + y1) / 2 + 2.5, s, 6.8)
    # TUBO ENDOTRAQUEAL (spans 2 rows) with NAS/ORAL and CALIBRE
    p.hline(596, 155, MID); p.hline(610, 155, MID)
    p.vline(250, 581, 610)
    p.text(160, 590, "TUBO", 6.8); p.text(160, 601, "ENDOTRAQUEAL", 6.8)
    p.text(255, 590, "NAS.______ ORAL______", 6.8)
    p.text(255, 605, "CALIBRE____________", 6.8)
    p.text(160, 622, "GLOBO INFLABLE   EMPAQUE__________", 6.8)
    p.hline(624, 155, MID)
    p.text(160, 634, "COMPLICACIONES: SI________ NO________", 6.8)
    p.hline(638, 155, MID)
    p.text(160, 648, "SANGRE Y SOLUCIONES", 7.0)
    p.hline(710, 155, MID)
    p.ctext(205, 703, "TOTAL", 7.6, False)
    for fid, lab in [("induccion", "Inducción"), ("mascarilla", "Mascarilla"),
                     ("canula", "Cánula faríngea"), ("tubo_et", "Tubo endotraqueal"),
                     ("globo", "Globo inflable"), ("complic_metodo", "Complicaciones"),
                     ("sangre_soluciones", "Sangre y soluciones")]:
        p.field(fid, 155, 535, MID, 710, label=lab, kind="composite", section="metodo")

    # ---- right column: duracion / observaciones / casos obstetricos ----
    p.text(MID + 6, 472, "DURACION DE LA ANESTESIA:", 7.6, False)
    p.field("duracion_anestesia", MID, 463, R, 490, label="Duración de la anestesia",
            section="registro")
    p.hline(490, MID, R)
    p.text(MID + 6, 500, "OBSERVACIONES:", 7.6, False)
    p.hline(596, MID, R)
    p.field("observaciones", MID, 490, R, 596, label="Observaciones", kind="textarea",
            section="registro")
    # casos obstetricos
    p.ctext((MID + R) / 2, 606, "CASOS OBSTETRICOS", 8, True)
    p.hline(610, MID, R)
    p.text(MID + 6, 620, "EXPULSION DE LA PLACENTA:  Espontanea________  Manual________", 6.8)
    p.hline(624, MID, R)
    p.ctext((MID + R) / 2, 634, "RECIEN NACIDO", 7.6, True)
    p.hline(638, MID, R)
    p.vline(430, 638, 681)
    # SEXO row (full-width value)
    p.hline(652, MID, R)
    p.text(MID + 6, 648, "SEXO", 7.2)
    p.field("rn_sexo", 430, 638, R, 652, label="RN Sexo", section="obstetricos")
    # PESO / TALLA rows with Apgar (1/5/10 min) columns
    p.hline(667, MID, R); p.hline(681, MID, R)
    p.text(MID + 6, 663, "PESO", 7.2)
    p.text(MID + 6, 677, "TALLA", 7.2)
    p.vline(472, 652, 681); p.vline(511, 652, 681); p.vline(550, 652, 681)
    p.ctext((430 + 472) / 2, 668, "Apgar.", 6.8)
    for cx, lab in [(491.5, "1 Minuto"), (530.5, "5 Minutos"), (570, "10 Minutos")]:
        p.ctext(cx, 657, lab, 5.8)
    p.field("rn_peso", 430, 652, R, 667, label="RN Peso", section="obstetricos")
    p.field("rn_talla", 430, 667, R, 681, label="RN Talla", section="obstetricos")
    p.hline(681, MID, R)
    p.text(MID + 6, 691, "ESTADO GENERAL AL SALIR DEL QUIROFANO:  Apgar.", 6.6)

    # ---- anestesiologo / clave / cirujano ----
    p.hline(725, L, R)
    p.vline(MID, 710, 725)
    p.text(26, 721, "ANESTESIOLOGO", 7.6); p.text(200, 721, "CLAVE", 7.6)
    p.text(MID + 6, 721, "CIRUJANO", 7.6)
    p.field("anestesiologo", L, 710, 200, 725, label="Anestesiólogo", section="firmas")
    p.field("clave", 200, 710, MID, 725, label="Clave", section="firmas")
    p.field("cirujano", MID, 710, R, 725, label="Cirujano", section="firmas")

    # ---- footer strip (8 cols) ----
    fx = [20, 105, 210, 327, 385, 470, 520, 555, 590]
    flab = ["RIESGO ANESTESICO\nQUIRURGICO (R.A.Q.)", "MEDICACION\nPREANESTESICA",
            "ANESTESICOS", "TERAPIA", "COMPLICACIONES", "POSICION", "EDAD", "SEXO"]
    for i, lab in enumerate(flab):
        p.vline(fx[i], 725, 776)
        _multiline(p, (fx[i] + fx[i + 1]) / 2, 750, lab, 6.4, False, cx=True)
        p.field(f"foot_{i}", fx[i], 725, fx[i + 1], 776,
                label=lab.replace("\n", " "), section="clasificacion")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    pages, schemas = [], []
    if which in ("1", "all"):
        p1 = build_page1(); pages.append(p1)
        emit_schema(p1, "forms/schema/imss_p1.schema.json")
    if which in ("2", "all"):
        p2 = build_page2(); pages.append(p2)
        if getattr(p2, "_chart", None):
            p2.fields.append(dict(**{k: p2._chart[k] for k in ("id", "type", "bbox")},
                                  chart=p2._chart))
        emit_schema(p2, "forms/schema/imss_p2.schema.json")
    render_pdf(pages, "forms/out/imss_recreated.pdf")

