---
type: plan
updated: 2026-07-10
tags: [plan, crosswalk, integration, backend]
---

# Field-ID ↔ Entity Crosswalk (the Rosetta stone)

The integration artifact that binds the two vocabularies of the system:

- the **schema** speaks in opaque field ids with bboxes — `propofol_42`,
  `aldrete_actividadm_c0`, `rn_peso` ([[field-inventory]], the emitted
  [`forms/schema/*.json`](../../../notebooks/forms/schema/nota2.schema.json));
- the **entity DTOs** speak in clean attributes — `imc`, `sexo`,
  `aldrete.actividad.al_salir` ([[rest-contract]] §3).

Nothing yet maps one to the other. **This crosswalk is that map**, and both directions of
the round-trip need it: `PUT entity → validate` and `entity → fill-pdf export`. Mandated by
[[decisions]] ADR-6. **Status (2026-07-10): a first-cut is implemented** in
`backend/app/infrastructure/render/crosswalk.py` — per-form `id`→case-value resolvers for a
demonstrable subset, driving the **real fill-pdf export** (see [[log]]). The full versioned artifact +
the canonical key vocabulary specified below (the `checkbox_value` value shape, `control_fluidos`
row/hour slugs, Aldrete time-point keys) remain to build.

## Why it's unavoidable

- **Export** ([[rest-contract]] §2.4): to draw a value into a field's bbox we must know
  *which entity attribute supplies that field id*. E.g. field `imc_7` (bbox on IMSS p1) ←
  `Patient.imc` (a **derived** read-only value); field `propofol_42` ←
  `AnestheticTechnique.values["propofol_42"]`.
- **Validation** ([[rest-contract]] §4): `schema_service` validates an incoming entity by
  finding *which schema fields it owns*, then checking type/unit/enum.
- The existing `entity` enrichment idea ([[rest-contract]] §4) is only at **section**
  granularity in [entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md);
  the crosswalk makes it **per field id**.

## Shape

One entry per schema field id, per form. Lives **server-side** (the app never sees it —
[[decisions]] ADR-1):

```jsonc
// crosswalk[form_id][field_id]
{
  "entity": "patient",                    // owning entity (one of the 9)
  "attribute": "imc",                     // dotted path into the DTO, OR null for blob fields
  "mode": "attribute",                    // "attribute" | "values_blob" | "table_cell" | "score_cell" | "series_point" | "derived"
  "readonly": true                        // derived/computed (server stamps; reject from client)
}
```

`mode` handles the field families that don't map to a scalar attribute:

| `mode` | when | binds to |
|---|---|---|
| `attribute` | scalar field | `entity.<attribute>` (e.g. `patient.sexo`) |
| `values_blob` | the ~185-field technique & other dense checkbox sets | `anesthetic_technique.values["<field_id>"]` — id **is** the key ([[rest-contract]] §3) |
| `table_cell` | `farmaco` / `control_fluidos` cells | `entity.matrix[row_id][col_id]` |
| `score_cell` | Aldrete 36 cells | `recovery_score.aldrete[criterion][time_point]` |
| `series_point` | `vitals_grid` lanes | `transanesthetic_record.series[lane]` — implemented 2026-11 in `backend/app/infrastructure/render/timegrid.py` (nota21 only) |
| `derived` | IMC, VSC, Aldrete totals, fluid balances | computed by `derive_service`; **readonly** |

## Worked examples

| form_id | field_id | entity | attribute | mode | readonly |
|---|---|---|---|---|---|
| imss_valoracion_preanestesica | `edad_1` | patient | `edad` | attribute | false |
| imss_valoracion_preanestesica | `imc_?` (derived cell) | patient | `imc` | derived | true |
| nota_postanestesica | `propofol_42` | anesthetic_technique | — | values_blob | false |
| imss_valoracion_preanestesica | `aldrete_actividadm_c0` | recovery_score | `aldrete.actividad_muscular.al_salir` | score_cell | false |
| registro_transanestesico | `control_fluidos:sangrado:3hr` | fluid_balance | `matrix.sangrado.3hr` | table_cell | false |
| registro_transanestesico | `vitals_grid` | transanesthetic_record | `series` | series_point | false |

## How it's built (semi-automatic + curated)

Most of it is derivable from artifacts we already have; the residue is curated:

1. **Seed `entity` from `section`.** Every schema field carries `section`
   ([schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md)); the field→entity map ([entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md))
   maps sections → entities. A script emits a first-pass `field_id → entity` for all ~471.
2. **Assign `mode`.** From `field.type` + table/chart membership (`checkbox`→attribute or
   values_blob, table cells→table_cell, `score`→score_cell, chart→series_point).
3. **Curate `attribute`** for the structured entities (Patient, FluidBalance rows,
   RecoveryScore criteria, NewbornRecord) — a bounded set. Dense checkbox entities
   (`AnestheticTechnique`) stay `values_blob` and need **no** per-id attribute.
4. **Mark `derived`** from the [[field-inventory]] §3 computed list.
5. **Validate coverage:** every schema field id appears exactly once; every non-blob DTO
   attribute has a source field. A CI check keeps it in sync when schemas change.

Output: `backend/app/infrastructure/schema/crosswalk/{form_id}.json`, loaded by
`schema_service` / `export_service` ([[rest-contract]] §1).

## Build task

Not yet built. Estimated as a focused, mostly-mechanical pass over the four schemas + the
entity docs (steps 1–2 scripted; 3–4 curated). It gates the fill-pdf export ([[rest-contract]]
§2.4) but **not** Phase 0 or the backend skeleton — schedule it alongside the export layer.

Related: [[decisions]] (ADR-6), [[rest-contract]] (consumer), [[field-inventory]] (the field
classification it extends), [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md) (the on-disk shape).
