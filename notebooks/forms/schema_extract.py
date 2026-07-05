"""
Semantic field-schema extractor for the vector anesthesia forms.

pdfsrc (clip-aware chars + drawings) --> tokens --> lines -->
    FIELDS   (checkbox / checkbox_value / number / text / open_field)
  + TABLES   (anchored: row labels x column headers, line-derived bounds)
  + CHARTS   (the vitals dotted-grid -> a timeseries_chart component)

Emits JSON the app can bind to:
  { form_id, page{w,h}, major_sections, subsections, fields, tables, charts }
bboxes are PDF top-left coords (x0, top, x1, bottom) in points.
"""
import sys, json, re, unicodedata, collections
import pdfsrc
from regen import InkOracle

# ---------------------------------------------------------------- helpers

UNITS = {"lpm", "/min", "mmHg", "mmhg", "%", "cmH₂O", "cmh₂o", "mg", "mcg", "ml",
         "min", "cm", "G", "mmDI", "mEq", "L/min", "kg", "Kg", "mt", "µg/kg",
         "ml/hr", "hrs", "hr", "mm", "mg/dl", "kg/m²", "mil"}

def strip_punct(s):
    return s.strip().strip(":.,;()#").strip()

def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()

def slug(s, n):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return (s or "field")[:32] + f"_{n}"

def is_checkbox(font):
    return "wingding" in (font or "").lower()

def is_blank(text):
    return len(text) > 0 and set(text) <= set("_")

def white(color):
    return color is not None and all(v > 0.9 for v in color[:3])

def unit_after(toks, idx):
    for k in range(idx + 1, min(idx + 3, len(toks))):
        if toks[k]["kind"] != "text":
            break
        s = strip_punct(toks[k]["text"])
        if s == "":
            continue
        return s if s in UNITS else None
    return None

# ------------------------------------------------------- tokens and lines

def build_lines(chars):
    """Cluster upright chars into visual lines (by baseline bottom), then
    merge adjacent chars into tokens: text / blank(______) / checkbox."""
    flat = sorted((c for c in chars if c["upright"]), key=lambda c: c["bottom"])
    lines_raw, cur, last_b = [], [], None
    for c in flat:
        if last_b is not None and c["bottom"] - last_b > 3.5:
            lines_raw.append(cur); cur = []
        cur.append(c); last_b = c["bottom"]
    if cur:
        lines_raw.append(cur)

    lines = []
    for li, cs in enumerate(lines_raw):
        cs.sort(key=lambda c: c["x0"])
        toks, t = [], None
        for c in cs:
            if is_checkbox(c["font"]):
                if t: toks.append(t); t = None
                toks.append(dict(kind="checkbox", text="☐", x0=c["x0"], x1=c["x1"],
                                 top=c["top"], bottom=c["bottom"], white=False, line=li))
                continue
            kind = "blank" if c["text"] == "_" else "text"
            gap = (c["x0"] - t["x1"]) if t else 0
            if t and t["kind"] == kind and gap < (3.5 if kind == "text" else 2.5):
                t["text"] += c["text"]; t["x1"] = max(t["x1"], c["x1"])
                t["top"] = min(t["top"], c["top"]); t["bottom"] = max(t["bottom"], c["bottom"])
            else:
                if t: toks.append(t)
                t = dict(kind=kind, text=c["text"], x0=c["x0"], x1=c["x1"],
                         top=c["top"], bottom=c["bottom"],
                         white=white(c["color"]), line=li)
        if t: toks.append(t)
        lines.append(toks)
    return lines

# -------------------------------------------------------------- fields

def extract_fields(lines, skip_zones=(), vsegs=(), page_w=612.0):
    """Checkbox / blank / open-field state machine over token lines.
    skip_zones: bboxes (chart lattice etc.) where no fields are created."""
    def in_zone(t):
        cx, cy = (t["x0"] + t["x1"]) / 2, (t["top"] + t["bottom"]) / 2
        return any(zx0 <= cx <= zx1 and zy0 <= cy <= zy1
                   for zx0, zy0, zx1, zy1 in skip_zones)

    fields, headers, n = [], [], 0
    for toks in lines:
        i = 0
        while i < len(toks):
            t = toks[i]
            if in_zone(t):
                i += 1; continue
            if t["kind"] == "text" and t["white"] and len(strip_punct(t["text"])) > 1:
                headers.append(dict(title=strip_punct(t["text"]),
                                    bbox=[t["x0"], t["top"], t["x1"], t["bottom"]]))
                i += 1; continue
            if t["kind"] == "checkbox":
                label, lbbox = "", None
                if i + 1 < len(toks) and toks[i + 1]["kind"] == "text":
                    label = strip_punct(toks[i + 1]["text"]); lbbox = toks[i + 1]
                ftype, unit, vbbox = "checkbox", None, None
                j = i + 2 if lbbox else i + 1
                if j < len(toks) and toks[j]["kind"] == "blank":
                    ftype, vbbox = "checkbox_value", toks[j]
                    unit = unit_after(toks, j)
                x1 = (vbbox or lbbox or t)["x1"]
                fields.append(dict(id=slug(label or "chk", n), type=ftype, label=label,
                                   unit=unit, section=None,
                                   bbox=[t["x0"], t["top"], x1, t["bottom"]],
                                   checkbox_bbox=[t["x0"], t["top"], t["x1"], t["bottom"]],
                                   blank_bbox=([vbbox["x0"], vbbox["top"], vbbox["x1"], vbbox["bottom"]]
                                               if vbbox else None)))
                n += 1
                if vbbox:   i = j + (2 if unit else 1)
                elif lbbox: i += 2
                else:       i += 1
                continue
            if t["kind"] == "blank":
                label = ""
                for k in range(i - 1, -1, -1):
                    if toks[k]["kind"] == "text":
                        s = strip_punct(toks[k]["text"])
                        if s:
                            label = s; break
                unit = unit_after(toks, i)
                fields.append(dict(id=slug(label or "blank", n),
                                   type="number" if unit else "text",
                                   label=label, unit=unit, section=None,
                                   bbox=[t["x0"], t["top"], t["x1"], t["bottom"]],
                                   checkbox_bbox=None,
                                   blank_bbox=[t["x0"], t["top"], t["x1"], t["bottom"]]))
                n += 1; i += 1; continue
            # open field: "Label:" with nothing to the right on this line
            if t["kind"] == "text" and t["text"].rstrip().endswith(":"):
                lbl = strip_punct(t["text"])
                nxt = toks[i + 1] if i + 1 < len(toks) else None
                gap = (nxt["x0"] - t["x1"]) if nxt else (page_w - t["x1"])
                if 2 <= len(lbl) <= 40 and gap > 15:
                    # value area: label end -> next vertical rule ON THIS LINE's
                    # y-band (page-wide x cuts would truncate wrongly) / next token
                    limit = nxt["x0"] - 2 if nxt else page_w - 10
                    here = sorted(x for (x, y0, y1) in vsegs
                                  if y0 <= t["bottom"] + 1 and y1 >= t["top"] - 1
                                  and t["x1"] + 2 < x < limit)
                    for vx in here:
                        if vx - t["x1"] < 8:
                            continue        # cell's own left edge hugging the label
                        limit = vx; break
                    if limit - t["x1"] > 25:
                        fields.append(dict(id=slug(lbl, n), type="open_field",
                                           label=lbl, unit=None, section=None,
                                           bbox=[t["x0"], t["top"], limit, t["bottom"]],
                                           checkbox_bbox=None,
                                           blank_bbox=[t["x1"] + 2, t["top"], limit, t["bottom"]]))
                        n += 1
            i += 1
    return fields, headers

# ----------------------------------------------------- rotated labels

def rotated_labels(chars, want_white):
    """Rotated (sidebar/band) labels. Chars are grouped by their rawdict
    line_id (one visual text line, already in reading order), then adjacent
    parallel lines are merged (multi-line labels like 'Anestésicos Inhalados'
    render as two rotated columns)."""
    groups = collections.defaultdict(list)
    for c in chars:
        if not c["upright"] and white(c["color"]) == want_white:
            groups[c["line_id"]].append(c)
    items = []
    for cs in groups.values():
        text = "".join(c["text"] for c in cs).strip()   # rawdict order = reading order
        if not text:
            continue
        items.append(dict(text=text, x=min(c["x0"] for c in cs),
                          y0=min(c["top"] for c in cs), y1=max(c["bottom"] for c in cs)))
    items.sort(key=lambda it: it["x"])
    merged = []
    for it in items:
        for m in merged:
            overlap = min(it["y1"], m["y1"]) - max(it["y0"], m["y0"])
            if abs(it["x"] - m["x"]) < 16 and overlap > 0.3 * (it["y1"] - it["y0"]):
                m["text"] += it["text"]
                m["x"] = it["x"]
                m["y0"] = min(m["y0"], it["y0"]); m["y1"] = max(m["y1"], it["y1"])
                break
        else:
            merged.append(dict(it))
    out = [dict(title=m["text"], y0=m["y0"], y1=m["y1"])
           for m in merged if len(m["text"]) >= 3]
    out.sort(key=lambda b: b["y0"])
    return out

# -------------------------------------------------------------- tables

def _find_token(lines, text, x_range=None, y_min=None):
    tgt = norm(text)
    for toks in lines:
        for t in toks:
            if t["kind"] != "text":
                continue
            tn = norm(t["text"])
            # exact match, or containment for long anchors (cell text can pick
            # up merged neighbours, e.g. 'mlTasa Fentanilo µg/kg')
            if tn != tgt and not (len(tgt) >= 6 and tgt in tn):
                continue
            if x_range and not (x_range[0] <= t["x0"] <= x_range[1]):
                continue
            if y_min is not None and t["top"] < y_min:
                continue
            return t
    return None

def _cuts(values, tol=1.5):
    out = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out

def extract_table(spec, lines, hsegs, vsegs):
    title_t = _find_token(lines, spec["title"], spec.get("title_x"))
    if not title_t:
        return None
    y_top = title_t["top"] - 3
    rows = []
    for lbl in spec["rows"]:
        t = _find_token(lines, lbl, spec.get("rows_x"), y_min=y_top)
        if t:
            rows.append((lbl, t))
    cols = []
    for lbl in spec["cols"]:
        t = _find_token(lines, lbl, spec.get("cols_x"), y_min=y_top - 12)
        if t:
            cols.append((lbl, t))
    if not rows or not cols:
        return None
    y_bot = max(t["bottom"] for _, t in rows) + 14
    x_left = spec.get("x_left", title_t["x0"] - 4)
    x_right = spec.get("x_right", max(t["x1"] for _, t in cols) + 40)

    ycuts = _cuts([y for (x0, y, x1) in hsegs
                   if y_top - 4 <= y <= y_bot and x0 < x_right and x1 > x_left
                   and (x1 - x0) > 0.3 * (x_right - x_left)])
    xcuts = _cuts([x for (x, y0, y1) in vsegs
                   if x_left - 4 <= x <= x_right + 4 and y0 < y_bot and y1 > y_top])

    def bounds(center, cuts, lo, hi):
        b0, b1 = lo, hi
        for cv in cuts:
            if cv <= center: b0 = cv
            else: b1 = cv; break
        return b0, b1

    rows_out = []
    for lbl, t in rows:
        cy = (t["top"] + t["bottom"]) / 2
        y0, y1 = bounds(cy, ycuts, y_top, y_bot)
        rows_out.append(dict(label=lbl, y0=round(y0, 1), y1=round(y1, 1)))
    cols_out = []
    for lbl, t in cols:
        cx = (t["x0"] + t["x1"]) / 2
        x0, x1 = bounds(cx, xcuts, x_left, x_right)
        cols_out.append(dict(label=lbl, x0=round(x0, 1), x1=round(x1, 1)))

    # snap the bbox to the outermost grid cuts when available
    if xcuts:
        x_left, x_right = min(xcuts), max(xcuts)
    if ycuts:
        y_top, y_bot = min(ycuts), max(ycuts)
    return dict(id=spec["id"], title=spec["title"],
                bbox=[round(x_left, 1), round(y_top, 1), round(x_right, 1), round(y_bot, 1)],
                rows=rows_out, columns=cols_out,
                row_cuts=[round(v, 1) for v in ycuts],
                col_cuts=[round(v, 1) for v in xcuts])

# --------------------------------------------------------------- chart

def extract_chart(chars, drawings, lines, vsegs):
    # the dotted lattice: thousands of tiny filled rects
    dots = []
    for d in drawings:
        if d["type"] != "f" or not d["fill"]:
            continue
        for it in d["items"]:
            if it[0] == "re" and it[1].width <= 1.6 and it[1].height <= 1.6:
                dots.append(((it[1].x0 + it[1].x1) / 2, (it[1].y0 + it[1].y1) / 2))
    if len(dots) < 2000:
        return None
    xs = sorted(p[0] for p in dots); ys = sorted(p[1] for p in dots)
    # trim 0.5% outliers
    k = len(dots) // 200
    bx0, bx1 = xs[k], xs[-k - 1]
    by0, by1 = ys[k], ys[-k - 1]
    bbox = [round(bx0, 1), round(by0, 1), round(bx1, 1), round(by1, 1)]

    # y-axis ticks: integer tokens (multiples of 20, 20..240) just left of grid
    ticks = []
    for toks in lines:
        for t in toks:
            s = t["text"].strip()
            if t["kind"] == "text" and re.fullmatch(r"\d{2,3}", s):
                v = int(s)
                if 20 <= v <= 240 and v % 20 == 0 and \
                   bx0 - 45 <= t["x1"] <= bx0 + 25 and by0 <= t["bottom"] <= by1:
                    ticks.append(dict(value=v, y=round((t["top"] + t["bottom"]) / 2, 1)))
    ticks.sort(key=lambda d: -d["value"])

    # minor time labels ("15","30","45") above the grid
    minors = []
    for toks in lines:
        for t in toks:
            if t["kind"] == "text" and t["text"].strip() in ("15", "30", "45") \
               and t["bottom"] < by0 + 6 and bx0 - 10 <= t["x0"] <= bx1:
                minors.append(dict(label=t["text"].strip(),
                                   x=round((t["x0"] + t["x1"]) / 2, 1)))
    minors.sort(key=lambda d: d["x"])

    # hour boundaries: vertical segments spanning a large part of the grid
    hours = _cuts([x for (x, y0, y1) in vsegs
                   if bx0 - 3 <= x <= bx1 + 3 and (min(y1, by1) - max(y0, by0)) > 0.45 * (by1 - by0)],
                  tol=3.0)

    # lanes: short ALPHA labels hugging the grid's left edge
    # (EKG..BIS, A..O drug rows, Ventilación modes — not the numeric ticks)
    lanes = []
    for toks in lines:
        for t in toks:
            if t["kind"] != "text":
                continue
            s = strip_punct(t["text"])
            if not s or len(s) > 14 or not any(ch.isalpha() for ch in s):
                continue
            if bx0 - 42 <= t["x1"] <= bx0 + 14 and by0 - 6 <= t["top"] <= by1:
                lanes.append(dict(label=s, y=round((t["top"] + t["bottom"]) / 2, 1)))
    lanes.sort(key=lambda d: d["y"])

    # rotated black band labels at far left (Anestésicos Inhalados / Fluidos IV)
    bands = [dict(label=b["title"], y0=round(b["y0"], 1), y1=round(b["y1"], 1))
             for b in rotated_labels(chars, want_white=False)]

    # legend: the symbol-key line under the grid
    legend = None
    for toks in lines:
        joined = " ".join(t["text"] for t in toks if t["kind"] == "text")
        if "Temperatura" in joined and ("Tensión" in joined or "Tension" in joined):
            legend = dict(text=re.sub(r"\s+", " ", joined).strip(),
                          bbox=[round(min(t["x0"] for t in toks), 1),
                                round(min(t["top"] for t in toks), 1),
                                round(max(t["x1"] for t in toks), 1),
                                round(max(t["bottom"] for t in toks), 1)])
            break

    return dict(id="vitals_grid", type="timeseries_chart", bbox=bbox,
                y_axis=dict(ticks=ticks), x_axis=dict(hour_lines=
                [round(v, 1) for v in hours], minor_labels=minors),
                lanes=lanes, bands=bands, legend=legend)

# -------------------------------------------------------------- profiles

PROFILES = {
    "nota_postanestesica": dict(tables=[], chart=False),
    "registro_transanestesico": dict(
        chart=True,
        tables=[
            dict(id="farmaco", title="Fármaco", title_x=(40, 260),
                 rows=list("ABCDEFGHIJKLMNO"), rows_x=(10, 28),
                 cols=["Fármaco", "Dosis y Vía"], cols_x=(40, 440),
                 x_left=10),
            dict(id="control_fluidos", title="Control de fluidos", title_x=(340, 480),
                 rows=["NCL", "DCL", "3er Espacio", "Diuresis", "Circuito respiratorio",
                       "Sangrado", "Textiles", "Aspirador", "Recuperador",
                       "Total a reponer", "Ingreso Critaloide", "Ingreso Coloide",
                       "Ingreso hemocomponente", "Balance parcial", "Balance total",
                       "Tasa Fentanilo µg/kg", "Gasto urinario ml/kg"],
                 rows_x=(340, 500),
                 cols=["1 hr", "2 hr", "3 hr", "4 hr", "5 hr"], cols_x=(430, 615),
                 x_right=606),
        ]),
}

# ---------------------------------------------------------------- main

def extract(src_pdf, form_id):
    profile = PROFILES.get(form_id, dict(tables=[], chart=False))
    data = pdfsrc.load(src_pdf)
    page = data["pages"][0]
    chars, drawings = page["chars"], page["drawings"]

    # ink-filtered line segments (drops phantom clipped-out borders)
    oracle = InkOracle(src_pdf, 0)
    hs, vs = pdfsrc.segments(drawings)
    hs = [s for s in hs if oracle.seg_coverage(s[0], s[1], s[2], s[1]) >= 0.8]
    vs = [s for s in vs if oracle.seg_coverage(s[0], s[1], s[0], s[2]) >= 0.8]

    lines = build_lines(chars)

    charts = []
    skip_zones = []
    if profile.get("chart"):
        ch = extract_chart(chars, drawings, lines, vs)
        if ch:
            charts.append(ch)
            skip_zones.append(tuple(ch["bbox"]))

    tables = []
    for spec in profile["tables"]:
        tb = extract_table(spec, lines, hs, vs)
        if tb:
            tables.append(tb)

    fields, headers = extract_fields(lines, skip_zones=skip_zones, vsegs=vs,
                                     page_w=page["width"])

    bands = rotated_labels(chars, want_white=True)
    def band_for(f):
        yc = (f["bbox"][1] + f["bbox"][3]) / 2
        for b in bands:
            if b["y0"] - 4 <= yc <= b["y1"] + 4:
                return b["title"]
        return None
    for f in fields:
        f["section"] = band_for(f)

    return dict(form_id=form_id,
                page=dict(width=page["width"], height=page["height"]),
                major_sections=[b["title"] for b in bands],
                subsections=headers, fields=fields, tables=tables, charts=charts)


if __name__ == "__main__":
    src, form_id, out = sys.argv[1], sys.argv[2], sys.argv[3]
    sch = extract(src, form_id)
    json.dump(sch, open(out, "w"), ensure_ascii=False, indent=2)
    types = collections.Counter(f["type"] for f in sch["fields"])
    print(f"{form_id}: {len(sch['fields'])} fields {dict(types)}")
    print("  major_sections:", sch["major_sections"])
    print("  subsections:", len(sch["subsections"]), "| tables:", [t["id"] for t in sch["tables"]],
          "| charts:", [c["id"] for c in sch["charts"]])
    for t in sch["tables"]:
        print(f"    table {t['id']}: {len(t['rows'])}/{len(t.get('row_cuts',[]))} rows/cuts, "
              f"{len(t['columns'])} cols")
    for c in sch["charts"]:
        print(f"    chart {c['id']}: bbox={c['bbox']} ticks={len(c['y_axis']['ticks'])} "
              f"hours={len(c['x_axis']['hour_lines'])} lanes={len(c['lanes'])} bands={[b['label'] for b in c['bands']]}")
    print("wrote", out)
