# Clinician feedback — 2026-11 (añadir antecedentes patológicos y quirúrgicos)

Source: `añadir antecedentes patológicos y quirurgicos.docx` (clinician review of the web app,
received 2026-11-19). Branch: `clinician-feedback-2026-11` (not committed yet). Scope: web app
(the MVP) + backend (DTOs, PDF crosswalk/renderer). The iOS app is on hold and was **not**
changed; its Swift model lacks the new fields (they are kept by the backend, not by iOS).

Status legend: ✅ done · 🟨 done with a limitation (see note) · ❓ waits on the clinician

| # | Request | Status | Where | Notes |
|---|---|---|---|---|
| 1 | Antecedentes patológicos y quirúrgicos | ✅ | Valoración preanestésica → Antecedentes | New `antecedentes_patologicos` / `antecedentes_quirurgicos`; also exposed the existing `antecedentes_anestesicos` and `medicamentos_previos`. The IMSS form has no slot of its own, so they print in "OTROS" ("Patológicos: …; Quirúrgicos: …"), wrapped over several lines. |
| 2 | Examen físico por sistemas, desplegable | 🟨 ❓ | Valoración preanestésica → Examen físico por sistemas | 9 systems (neurológico, cardiovascular, respiratorio, abdomen, renal, endocrinometabólico, osteomuscular, hematológico, piel). Each opens its findings box once marked Normal / Alterado. Prints: respiratorio / cardiovascular / tegumentos in their IMSS boxes, the rest in "OTROS". **The system list is our proposal**: the "documento correspondiente" was not attached. |
| 3 | "Signos al finalizar la cirugía"; "tendencia de reposo" | ✅ | Registro transanestésico | Sections now read "Signos en reposo (basales)" and "Signos al finalizar la cirugía"; the chart is "Tendencia de reposo → fin de la cirugía" (ticks Reposo / Fin de la cirugía). Data keys unchanged. |
| 4 | Intercurrencias ajenas al acto médico | ✅ | Registro transanestésico → Intercurrencias | Type chips (corte de energía eléctrica, falla de equipo, gases medicinales, insumos, comunicación, otra) + description. Prints in "Observaciones/incidentes" (nota2) and "Observaciones" (IMSS) after the existing observaciones. |
| 5 | Signos vitales cada 5 minutos | ✅ | Registro transanestésico → Registro intraoperatorio (cada 5 minutos) | Start time + one column per 5 min (up to 5 h). Prints on the transanesthetic record's grid: • FC, X TA (sys–dia joined), O FR, ∆ temperatura, hour labels, events 1–6. |
| 6 | Neuromonitorización, Entropía, BIS, NINDEX, cada uno con su fila | 🟨 | Monitorización chips + grid rows | Each monitor has its own row in the app, shown once its chip is selected. **PDF limit:** the paper form has one depth row (BIS): it prints BIS, or Entropía ("E 45") / NINDEX ("N 40") when BIS is empty. TNM and neuromonitorización have no row on the printed form (kept in the app only). The form's "Entropía" checkbox is now stamped. |
| 7 | Anestésicos inhalados en % que cambia en el tiempo | ✅ | Grid → Anestésicos inhalados (%) | Up to 3 agents (form rows); value at each change, e.g. 2 → 2.5. Prints agent name + % per column. |
| 8 | Fluidos IV por nombre completo, sin abreviaturas | 🟨 ❓ | Grid → Fluidos IV (ml) | Catalogue of full names (Ringer lactato, Solución fisiológica 0,9 %, …, coloides, hemocomponentes); up to 5 (form rows); ml per column. Names also print in the form's Cristaloides / Coloides / Hemocomponentes fields. "Circuito resp." spelled out on Balance hídrico. **The amount notation image was blank in the docx**: we use ml until the clinician resends it. |
| 9 | Infusión continua vs bolo | ✅ | Fármacos → Bolo / Infusión continua | Infusion: rate units (mcg/kg/min, mg/h, ml/h…), start and end time. Prints "Noradrenalina (infusión continua) · 0.08 mcg/kg/min IV" and a line on the grid from start to end. |
| 10 | PVC → POCUS; EKG con texto; SpO₂ y O₂ numéricos | 🟨 | Grid → Monitorización | EKG is a text row ("Ritmo sinusal"), SpO₂ / O₂ numeric (%), POCUS a text row. **PDF limit:** the printed row label still says "PVC" (part of the form template); the POCUS finding prints in that row. O₂ is taken as % (FiO₂) — confirm with the clinician. |
| — | Bug: sevoflurano (Técnica) never stamped its PDF checkbox | ✅ | crosswalk `_technique_on` | `volatil_` / `aguja_` prefixes are now stripped before matching. |

## Open questions for the clinician

1. **Item 8:** resend the image with the notation for fluid amounts (it is a blank 1×1 image).
2. **Item 2:** send the "documento correspondiente" with the systems and findings to include.
3. **Item 10:** may the printed form keep the "PVC" row label (showing the POCUS finding), or
   must the form template be relabelled? Is the O₂ row FiO₂ (%) or flow (L/min)?
4. **Item 6:** the paper form has a single BIS row and no TNM / neuromonitoring rows — is
   printing Entropía/NINDEX in the BIS row acceptable?

## Other changes made along the way

- PDF text that does not fit now shrinks (to 5 pt) before being cut, and wraps over several lines
  in tall boxes (e.g. IMSS "OTROS"). This affects every form's long text.
- The time grid is drawn only on the transanesthetic record (nota21). The IMSS registro's grid
  has another layout and is still not drawn.

## Verification (2026-11-19)

- Backend: `python -m pytest` → 323 passed, 7 skipped (new: `tests/test_clinician_feedback.py`).
- Web: `npx vitest run` → 372 passed; `tsc -b --noEmit` and `eslint src` clean; `npm run build` OK.
- E2E against a live branch server (scratch SQLite, synthetic patient): `scripts/e2e.py` passes,
  and a feedback-specific run (every new field PUT → GET → exported to the 3 forms → text
  checked in the PDFs) passes 21/21. The printed grid was checked visually.
- Not done: a manual check of the web screens in a browser (the browser extension could not
  reach the local dev server).

## Log

- 2026-11-19 — tracker created; baseline: backend 319 passed / 7 skipped, web 369 passed.
- 2026-11-19 — all 10 items + the sevoflurano bug built and verified (see table).
