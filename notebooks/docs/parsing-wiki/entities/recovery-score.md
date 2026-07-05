---
type: entity
updated: 2026-07-05
tags: [parsing, entity, aldrete, scoring]
entity: RecoveryScore
---

# Entity — RecoveryScore (Valoración de la recuperación / Aldrete)

Post-anesthetic recovery scoring over time. **1 per [[anesthesia-case]]**, evaluated at
several time points. From `imss_p1.aldrete` (36 score-cells) + nota2 término scores.

## Structure

The **Aldrete** matrix: **5 criteria** × **6 time points**, each cell 0/1/2.

### Criteria (`imss_p1.aldrete` rows)
| criterion | 2 / 1 / 0 |
|---|---|
| `actividad_muscular` | mueve 4 / 2 extremidades / inmóvil |
| `respiracion` | amplia y tose / limitada, tos débil / apnea |
| `circulacion` | TA ±20 / ±20–50 / ±50 de cifras control |
| `estado_conciencia` | despierto / responde al llamado / no responde |
| `coloracion` | mucosas sonrosadas / pálida / cianosas |

### Time points (columns)
`AL SALIR (quirófano), 0, 20, 60, 90, 120 min` (SALA DE RECUPERACIÓN). Plus per-column
`total` (sum, 0–10) and final `alta_a_su_piso` + `medico_responsable`.

### Other scales (nota2, at término)
`aldrete, ramsay, bromage, ena`; `ventilación` (espontánea/asistida/controlada); post
signos vitales → snapshot on [[transanesthetic-record]].

## Representation

A `{criterion, time_point} → score` map; `total[time_point] = Σ criteria`. The app can
**auto-sum** and chart the recovery trajectory.

## Relationships

Belongs to [[anesthesia-case]]; the post signos snapshot ties to
[[transanesthetic-record]].

## Round-trip

Fills the 36 Aldrete cells + 6 totals of IMSS p1 — each cell has its measured bbox
(`aldrete_<criterion>_c<0..5>`, `aldrete_total_c<0..5>`) in `imss_p1.schema.json`, so
scores draw straight back into the connected-box grid.
