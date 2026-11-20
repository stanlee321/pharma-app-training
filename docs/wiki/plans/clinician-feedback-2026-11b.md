# Clinician feedback — 2026-11b (registro de anestesia, modificaciones)

Source: `REGISTRO DE ANESTESIA MODIFICAICONES .docx` + two chat messages ("No llega toda la hoja",
"está incompleto lo de los anestésicos"), received 2026-11-20. Branch:
`clinician-feedback-2026-11b` (on top of `clinician-feedback-2026-11`). Scope: web app + backend
(DTOs, derivations, PDF crosswalk/renderer). iOS is on hold and was not changed.

> PHI note: the clinician's screenshots show what looks like a real patient. No value from them is
> copied here or in the code/tests; every test and e2e uses synthetic data.

Status legend: ✅ done · 🟨 done with a limitation (see note) · ❓ waits on the clinician

| # | Request | Status | Where (app) | Prints on |
|---|---|---|---|---|
| 1 | Edad in the first page; Servicio as a list of specialties | ✅ | Hub → Datos del caso: Edad (read-only), Servicio dropdown (10 specialties; older free text kept) | nota21 Servicio / Edad (already) |
| 2 | Sala → Cama | ✅ | Hub shows **Cama** (`patient.cama`) instead of Sala; `sala` kept in the data | imss_p2 Cama (already) |
| 3 | Neuraxial: asepsia, campos, intentos, catéter (cm), puncture level vs block level (T10), resultado satisfactorio, guiador; lidocaína infiltración + bupivacaína / fentanilo / morfina with their route | ✅ | Técnica · Regional neuroaxial: Asepsia y campos, Punción, Resultado, Dosis y vía (route chips per drug; lidocaína defaults to "Infiltración por planos") | nota2 neuraxial block (región, solución, campo, intentos, sitio, guía, nivel de difusión + "satisfactorio", catéter cm, bupivacaína / fentanilo / morfina doses, Fármacos utilizados) and nota21 Fármaco table (after the ledger rows) |
| 4 | Monitoring: temperatura, PANI, PAI, an "Otro" free entry | ✅ | Monitorización chips PANI / PAI; Temp opens the site chips (esofágica, rectal, nasofaríngea, cutánea); "Otra monitorización" text | nota21 PANI / PAi / Otro / temperature-site boxes; the "Otro" text in nota2 Observaciones |
| 5 | Remove the EKG text row | ✅ | Grid row hidden (still shown for a case that holds EKG values) | — |
| 6 | Diagnóstico operatorio, procedimiento propuesto / realizado, isquemia, neumoperitoneo, acceso endovascular, O₂ suplementario in the transanesthetic record | ✅ | Registro transanestésico: new sections (isquemia with computed tiempo total; up to 3 venas + 1 arterial + 1 CVC; O₂ device + flow) | nota21 (diagnosis/procedure, isquemia hours/presión/tiempo total, neumoperitoneo presión, acceso lines, O₂ boxes + flujo); nota2 neumoperitoneo presión |
| 7 | Ventilación row, stepped line on a change (espontánea → asistida…) | ✅ | Grid → Ventilación (one choice per column; enter it when it changes) | nota21 Ventilación rows: a stepped line to event 5/6 or one column past the last entry |
| 8 | Event numbers 1–6 on their own row | ✅ | Grid → Tiempos del 1 al 6 | nota21 "Tiempos del 1 al 6" row; "Horas en quirófano" computed from events 1→6 |
| 9 | Drugs on the grid: letter at the time, "50 mg IV" in the table; infusions as a line ending in a bar | ✅ | Grid → Fármacos row shows each ledger letter at its column (— while an infusion runs); a new drug row now starts at the current minute | nota21 (already drawn). **Bug fixed:** a ledger row without a dose printed " mg IV"; it now prints nothing |
| 10 | Labs in the preanesthetic visit: Hb, Hto, PTL, TP, TPT, INR | ✅ | Valoración preanestésica → Laboratorios (+ PTL, TP, TPT, INR) | nota21 Hb / Hto (falls back to the labs) / PTL / TP / TPT / INR |
| 11 | Fluids: totals from the grid; remove "Tasa Fentanilo"; bleeding divisions; neuraxial consideration | 🟨 | Balance hídrico: empty intake cells take the grid sum of that hour (grey); Sangrado = Textiles + Aspirador + Recuperador; "Total fluidos infundidos" | nota21: ml per Cristaloides / Coloides / Hemocomponentes + Total fluidos infundidos; derived rows (Sangrado, Total a reponer, Balance parcial / total, Gasto urinario); the "Tasa Fentanilo" label is removed (redacted) from the form. "Neuroaxial" consideration: nothing specific built — ❓ |
| 12 | Only sevoflurane (others not on the market) | ✅ | Técnica general + grid offer Sevoflurano only; older cases keep and print their agents | — |
| 13 | Grid: keep earlier columns, open on the latest; alarm for pending pressures; intercurrencias / extra drugs as notes | 🟨 | Grid opens scrolled to the current column; row names wrap (no "TA sistólica (m…"); a banner lists the columns without TA up to now (red cells). "Medicación adicional y notas" box | nota2 Observaciones ("Notas: …"). The reminder is on screen only (no sound) — ❓ |
| 14 | Position over time with the standard symbols | ✅ | Grid → Posición (17 positions from the reference sheet, symbol shown under the choice) | nota21 "Posición" row: one symbol + time per change (up to 6) |

## Open questions for the clinician

1. "No llega toda la hoja": which sheet — the grid screen on the tablet (now wraps its labels and
   opens on the current time), or the exported PDF?
2. Item 11: what should change for neuraxial anesthesia in the fluid control?
3. Item 13: is an on-screen reminder enough, or do they want a sound?
4. Item 7: ventilation is entered when it changes — OK, or one value per 5 minutes?
5. Still open from 2026-11: the fluid-notation image and the exam-systems document.

## Verification (2026-11-20)

- Backend `python -m pytest` → 330 passed, 7 skipped (new: `tests/test_clinician_feedback_b.py`).
- Web `npx vitest run` → 382 passed (new: `state/clinicianFeedback2026b.test.ts`,
  `routes/monitoring/ClinicianFeedback2026b.test.tsx`); `tsc -b --noEmit`, `eslint src` clean;
  `npm run build` OK.
- E2E on a live branch server (scratch SQLite, synthetic patient): `scripts/e2e.py` passes; the
  2026-11b run (every new field PUT → GET → derived values → exported to nota21 / nota2 / imss_p1 →
  text checked in the PDFs) passes 28/28. The printed grid, positions and fluid table were checked
  visually.
- Not done: a manual check of the web screens in a browser.
