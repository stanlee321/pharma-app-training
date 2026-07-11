---
type: report
updated: 2026-07-10
tags: [report, contracts, entities, parsing, backend]
---
# Contract ↔ Parsing Reconciliation (2026-07-10)

Validates the backend DTOs (`backend/app/application/dto.py`) and derivation math
(`backend/app/domain/derivations.py`) against the **actual PDF-parsing outputs** — the four
emitted schemas (`notebooks/forms/schema/{nota2,nota21,imss_p1,imss_p2}.schema.json`), the
renderers that produce/consume them (`notebooks/forms/{schema_extract,regen,imss_gen,pdfsrc}.py`),
and the synthesized nine-entity model (`notebooks/docs/parsing-wiki/entities/`). The frozen
Swift mirror is `PharmaApp/Models/ClinicalRecord.swift`. Wiki anchors: [[field-inventory]],
[[field-crosswalk]], [[rest-contract]], [[clinical-record]], [[schema-spec]].

**Headline:** entity coverage is complete (9/9). The two blockers are a **broken
`fluid_balance()` derivation** (uses row names that don't exist in `control_fluidos`) and a
**Swift↔backend divergence** in `TransanestheticRecord` (Python DTO dropped `events` / `basal`
/ `termination`). Beyond those, ~30 entity-doc/schema attributes are absent from the DTOs,
mostly on the `AnesthesiaCase` envelope and `PreanestheticAssessment` exam/history — these
block a faithful `fill-pdf` round-trip (no source for their field ids).

> **Applied 2026-07-10 (commit follows):** both blockers + the CORRECTNESS additions
> (§5.2/§5.3/§5.4/§5.6/§5.7 + the §5.8 aldrete guard) landed in `backend/app/application/dto.py`,
> `…/domain/derivations.py`, `…/application/case_service.py` — verified (pytest green; fluid-balance
> real-row + `events`/`basal`/`termination` round-trip + aldrete-guard checks pass). **Deferred**
> (need a cross-cutting decision, not a backend edit): §5.5 the `checkbox_value` value convention,
> the `imss_gen.py` schema-side ids for composites + newborn static text, Swift-side mirroring of the
> new attributes (the app works without them — backend fields default), and **the exact clinical
> `Balance parcial/total` formula (awaiting anesthesiologist confirmation).**

---

## 1. Entity coverage — 9 DTOs vs 9 parsed entities

**All nine entities are present.** The `SINGLETONS` (6) + `COLLECTIONS` (2) maps
(`dto.py:178-190`) plus the `AnesthesiaCaseDTO` root (`dto.py:122`) = the nine entities of
`entities/model.md`. URL segments match [[rest-contract]] §2.3 exactly.

| Parsed entity (`entities/model.md`) | DTO (`dto.py`) | Attribute-level coverage |
|---|---|---|
| patient | `PatientRecordDTO` L31 (+`PatientProfileDTO` L23) | **partial** — missing `hab`; derived `sp`/`vsc_25`/`vsc_15` |
| anesthesia-case (root) | `AnesthesiaCaseDTO` L122 | **partial** — ~11 envelope fields absent (§1.1) |
| preanesthetic-assessment | `PreanestheticAssessmentDTO` L46 | **partial** — 7 exam/history attrs absent (§2) |
| anesthetic-technique | `AnestheticTechniqueDTO` L61 | structural OK; `checkbox_value` under-typed (§2) |
| transanesthetic-record | `TransanestheticRecordDTO` L76 | **regressed** — `events`/`basal`/`termination` dropped (§1.2) |
| drug-administration | `DrugAdministrationDTO` L82 | OK (minor: `Quantity` flattened) |
| fluid-balance | `FluidBalanceDTO` L93 | matrix OK; **derivation broken** (§3) |
| recovery-score | `RecoveryScoreDTO` L99 | OK; total needs a 5-criteria guard (§3) |
| newborn-record | `NewbornRecordDTO` L107 | missing `expulsion_placenta`, `estado_general` |

The extra DTOs (`ProviderDTO`, `PatientProfileDTO`, `VitalPointDTO`/`VitalSeriesDTO`,
`CaseSummaryDTO`, `CreateCaseRequest`, `CaseEnvelopePatch`) are transport/value objects folded
into the nine — not spurious entities.

### 1.1 `AnesthesiaCase` envelope — missing fields

`AnesthesiaCaseDTO` (`dto.py:126-139`) carries `fecha, sala, servicio, turno, tipo_admision,
diagnostico_preop, diagnostico_postop, operacion_propuesta, operacion_realizada, asa, raq,
anestesiologo, cirujano`. Present in `anesthesia-case.md` **and** a parsed schema field, but
absent from the DTO:

| Missing attr | Entity doc | Schema field id (`file`) |
|---|---|---|
| `tipo` (I / II) | anesthesia-case.md L18 | `i_11`, `ii_12` (`nota21` L231/L251) |
| `posicion` | anesthesia-case.md L26 | `posicion_51` (`nota21` L1031); nota2 decúbito checkboxes; `foot_5` (`imss_p2`) |
| `duracion_anestesia` | anesthesia-case.md L26 | `duracion_anestesia` (`imss_p2` L542) |
| `observaciones` | anesthesia-case.md L29 | `observaciones` (`imss_p2` L555, textarea) |
| `equipo_quirurgico` | anesthesia-case.md L30 | `equipo_quirurgico_69` (`nota21` L1391) |
| `complicaciones_post` | anesthesia-case.md L28 | `complic_postanestesicas` (`imss_p1` L647, textarea) |
| `isquemia` {hr_inicio, hr_termino, sitio} | anesthesia-case.md L27 | `isquemia_hr_inicio_41`, `hr_termino_42`, `sitio_de_isquemia_47` (`nota21`) |
| `neumoperitoneo` {hr_inicio} | anesthesia-case.md L27 | `neumoperitoneo_hr_inicio_49` (`nota21` L991) |
| `tiempo_total`, `horas_en_quirofano` | — | `tiempo_total_45`, `horas_en_quirofano_39` (`nota21`) |
| `procedimiento` | anesthesia-case.md L22 | (nota21 procedimiento) |
| classification footer (8) | anesthesia-case.md L37 | `foot_0..7` (`imss_p2` L646+) — mostly derived |

Note `complicaciones_trans` is *partially* covered by `TransanestheticRecordDTO.complicaciones`
(`dto.py:79`), but `complicaciones_post` (a distinct IMSS p1 textarea) has no home.
`Provider` (`dto.py:117`) is `{nombre, clave}` only; `anesthesia-case.md` L34 specifies
`anestesiologo{nombre, cedula, universidad, clave}` — `cedula`/`universidad` missing.

### 1.2 `TransanestheticRecord` — DTO regressed vs frozen Swift

The frozen Swift `TransanestheticRecord` (`ClinicalRecord.swift:124-131`) has **`events:
[SurgicalEvent]`** (L126), **`basal: VitalSnapshot`** (L128) and **`termination: VitalSnapshot`**
(L129). The Python `TransanestheticRecordDTO` (`dto.py:76-79`) has only `series`, `monitoring`,
`complicaciones` — it **dropped all three**. These are not cosmetic:

- `events` (markers 1–6) are first-class in the parsed chart — the `vitals_grid` legend
  enumerates *"1-Ingresa a quirófano … 6-Sale de quirófano"* (`nota21` legend L1957;
  `imss_p2` `chart.events` L807-815) — and `transanesthetic-record.md` L21-24 models them as
  timestamped x-axis anchors.
- `basal`/`termination` snapshots map to nota2's signos-vitales rows and IMSS p1 baseline TA/P/R/T
  (`transanesthetic-record.md` L26-29).

This is a **contract break**: a Swift `AnesthesiaCase` encoded today would round-trip through the
backend losing events + snapshots. Also unmodeled on both sides: the chart `bands`
(*Anestésicos Inhalados*, *Fluidos IV* — `nota21` L1944) and the AGENTES inhaled-agent rows
(`imss_p2` `agentes_bbox` L816).

---

## 2. Field / type fidelity

Schema `type` vocabulary (`schema-spec.md`; extended by `imss_gen.py`): `checkbox`,
`checkbox_value`, `number`, `text`, `open_field`, `score`, `textarea`, `composite`,
`timeseries_chart`, `table`. How each lands in the DTOs:

| Schema type | DTO representation | Fidelity |
|---|---|---|
| `checkbox` | technique `values` blob / `monitoring` bool | OK |
| `checkbox_value` (tick + value + unit) | technique `values: dict[str, Any]` (`dto.py:63`) | **lossy** — see below |
| `number` / `text` / `open_field` | scalar attr or `values` blob | OK where an attr exists |
| `score` (0/1/2) | `RecoveryScoreDTO.aldrete[crit][tp]: int` | OK |
| `textarea` | free-text attr | **gap** — imss_p1 complic_*, imss_p2 observaciones have no attr |
| `composite` (7 imss_p2 blocks) | technique `values` blob | **coarse** — see below |
| `timeseries_chart` | `series: [VitalSeriesDTO]` | partial — no `events`/`bands`/`agents` (§1.2) |
| `table` | `farmaco`→`drugs[]`; `control_fluidos`→`FluidBalance.matrix` | OK structurally |

**`checkbox_value` is under-typed.** Fields like `propofol_25` (`checkbox_value`, unit `mg`,
`nota2` L556-580) and `fentanilo_27` (unit `mcg`, `nota2` L606) carry a **tick AND a dose AND a
unit**. [[rest-contract]] §3 specifies `values: { field_id: bool | Quantity | string }`, but the
DTO's value type is `Any` (`dto.py:63`) and the frozen Swift `FieldValue` (`ClinicalRecord.swift:7`)
is `bool | number | text` — **no `Quantity` case, and no way to hold checked+value together**. So a
checked Propofol-200mg-`mg` field cannot be represented without a convention (e.g. two keys
`propofol_25` bool + `propofol_25__val` number), which the crosswalk does not define. The
`values` keys *are* meant to be the canonical schema ids (`propofol_25`, not the doc's
illustrative `propofol_42`); that part is fine — the gap is the value shape.

**`composite` blocks are coarse in the schema itself.** The 7 IMSS p2 method blocks
(`induccion`, `mascarilla`, `canula`, `tubo_et`, `globo`, `complic_metodo`, `sangre_soluciones`,
`imss_p2` L451-540) **all share the same bbox** `[155,535,327,710]` and expose **no sub-field ids**
(the inner lines like *"INDUCCION: IV/IM/INHALACION"* are drawn as static `p.text` in
`imss_gen.py`, not `p.field`). So these cannot be sub-filled regardless of DTO shape — a
schema-side limitation to note for `fill-pdf`.

**`PreanestheticAssessment` free-text under-modeled.** `PreanestheticAssessmentDTO`
(`dto.py:46-58`) has `alergia, dentadura, cuello, estado_psiquico, premedicacion` but omits
`antecedentes_anestesicos` (`ant_antecedentes`, `imss_p1` L192), `otros` (`ant_otros` L257),
`medicamentos_previos` (L543), `analgesica_obstetrica` (L556), `aparato_respiratorio` (L270),
`aparato_cardiovascular` (L283), `tegumentos` (`pre_tegumentos` L114) — 7 distinct exam/history
cells from `preanesthetic-assessment.md` §History/§Exam. They'd have to be crammed into the
single `notes` field. Also `labs: dict[str, float]` (`dto.py:57`) is float-only, but urinalysis
(`orina`) values are qualitative (`+`, `++`, *trazas*) — the type should be `dict[str, str|float]`
or `Quantity`.

**`NewbornRecord`** (`dto.py:107`, Swift L159) omits `expulsion_placenta` and
`estado_general_al_salir` — both listed in `newborn-record.md` L15/L22. (Caveat: `imss_gen.py`
draws these as static text with inline blanks and assigns them **no field id**, so the schema
also can't round-trip them — a paired schema+DTO gap.)

---

## 3. Derived-value correctness (`derivations.py`)

| Derivation | Formula | vs docs / Swift | Verdict |
|---|---|---|---|
| `imc` (L8) | `w / (h/100)²`, round 1 | field-inventory §3; Swift L64 | ✅ correct |
| `peso_ideal` (L13) | Devine `50/45.5 + 2.3·(in−60)` | patient.md; Swift L69 | ✅ correct |
| `vsc` (L20) | `w · 70` | field-inventory §3; Swift L75 | ✅ correct (default) |
| `aldrete_total` (L25) | Σ criteria, None if partial | recovery-score.md (0–10) | ⚠️ no 5-criteria guard |
| `fluid_balance` (L37) | intake − loss per hour | fluid-balance.md | ❌ **wrong row names** |

### 3.1 `fluid_balance()` — BLOCKER

`derivations.py:42-44` hard-codes:

```python
intake_rows = ("NCL", "Cristaloide", "Coloide")
loss_rows   = ("Sangrado", "Diuresis")
```

Cross-checked against the **actual** `control_fluidos` rows (`nota21` schema, verified):
`NCL, DCL, 3er Espacio, Diuresis, Circuito respiratorio, Sangrado, Textiles, Aspirador,
Recuperador, Total a reponer, Ingreso Critaloide, Ingreso Coloide, Ingreso hemocomponente,
Balance parcial, Balance total, Tasa Fentanilo µg/kg, Gasto urinario ml/kg`.

Bugs:
1. **`"Cristaloide"`/`"Coloide"` match no row** — the intake rows are literally
   **`"Ingreso Critaloide"`** (sic — misspelled in the source form), **`"Ingreso Coloide"`**,
   **`"Ingreso hemocomponente"`**. `matrix.get("Cristaloide", {})` → `{}` → contributes 0.
2. **`NCL` is mis-classified as intake.** Per `fluid-balance.md` L19-21, `NCL/DCL/3er Espacio/
   Diuresis/Circuito respiratorio/Sangrado` are **losses/requirements**, not intake. Counting
   NCL as intake inverts the balance sign.
3. **Incomplete losses** — omits `DCL`, `3er Espacio`, `Circuito respiratorio`.
4. **Wrong output shape.** It emits a generic `balance[hour]`, but the form has four *named*
   derived rows the export must fill: **`Balance parcial`, `Balance total`,
   `Tasa Fentanilo µg/kg`, `Gasto urinario ml/kg`** (plus `Total a reponer`). None are produced,
   so `fill-pdf` has nothing to draw into those cells.
5. **Hour-key mismatch.** Param uses `("1hr"…"5hr")` (L39) but the schema columns are labelled
   `"1 hr"…"5 hr"` (`control_fluidos.columns`); the crosswalk example uses `3hr`
   ([[field-crosswalk]]). The matrix row-key convention (raw label `"Sangrado"` vs slug
   `sangrado`, per the crosswalk `matrix.sangrado.3hr`) is also unpinned.

Net effect: with any real data, the current function returns near-zero garbage and can't source
the named derived rows. **This is the most consequential correctness defect.**

Also **not derived anywhere**: `Gasto urinario ml/kg` and `Tasa Fentanilo µg/kg` need patient
weight (cross-entity) and the fentanyl total (from `drugs[]`), and the Patient blood-volume set
`SP`, `25% del VSC`, `15% del VSC` (`vsc_62`, `sp_63`, `25_del_vsc_64`, `15_del_vsc_65` in
`nota21`; fluid-balance.md L29-30) — only base `vsc` is computed (`derivations.py:20`,
`_derive` L14-19).

### 3.2 `aldrete_total()` — correct but unguarded

`derivations.py:25-34` sums *whatever criteria are in the dict* and returns `None` for partial
columns — matching recovery-score.md ("total = Σ criteria", 0–10) and the schema's separate
`aldrete_total_c0..c5` row (`imss_p1` L1050). Two low-severity hardening gaps: (a) it doesn't
enforce the **five** canonical criteria (`actividad_muscular, respiracion, circulacion,
estado_conciencia, coloracion`) — a stray `total` key in the input would double the sum; (b) no
clamp to 0–10. Also the **time-point keys** are unpinned: the schema is `c0..c5` = `AL SALIR/0/20/
60/90/120 min`, the crosswalk uses `al_salir` (`aldrete.actividad_muscular.al_salir`) — a
canonical map must be fixed for `fill-pdf` to target the right column.

---

## 4. `fill-pdf` readiness

Per [[schema-spec]] §fill-pdf and [[field-crosswalk]], every schema field id must be sourceable
via one of `attribute | values_blob | table_cell | score_cell | series_point | derived`. Current
sourcing status:

| Source mode | Works today | Gaps the crosswalk cannot close yet |
|---|---|---|
| `attribute` | patient core, case dx/firmas, drug rows | case `tipo/posicion/duracion/observaciones/equipo_quirurgico/complic_post/isquemia/neumoperitoneo`; preassess `aparato_*`/`tegumentos`/`antecedentes`/`medicamentos_previos`; provider `cedula/universidad`; patient `hab` (§1–2) |
| `values_blob` | nota2 checkbox/text | `checkbox_value` tick+dose+unit not representable (§2); imss_p2 `composite` has no sub-ids |
| `table_cell` | `control_fluidos` matrix, `farmaco`→drugs | row-key + hour-key convention unpinned (§3.1) |
| `score_cell` | Aldrete 5×6 | time-point key map `al_salir↔c0` undefined (§3.2) |
| `series_point` | `vitals_grid` lanes | no `events`/`bands`/`agents` sink (§1.2) |
| `derived` | imc, peso_ideal, vsc, aldrete totals | fluid named rows broken; `sp/vsc_25/vsc_15`, `gasto_urinario`, `tasa_fentanilo` missing (§3) |

**The field-crosswalk must close:** (a) a value convention for `checkbox_value` (bool + Quantity);
(b) canonical row/hour keys for `control_fluidos`; (c) canonical time-point keys for Aldrete;
(d) attributes for the ~15 missing envelope/exam fields; (e) the named fluid derived rows +
Patient blood-volume set. Composite blocks and newborn `expulsion_placenta`/`estado_general`
additionally need **schema** field ids added in `imss_gen.py` before they can be filled at all.

---

## 5. Prioritized fix list

Concrete edits, ranked. (Backend edits only; Swift follow-ups flagged where the frozen mirror
must move in lock-step.)

### BLOCKER

1. **Rewrite `derivations.fluid_balance()`** (`derivations.py:37-49`) to the real
   `control_fluidos` rows and to emit the *named* derived rows.
   - `intake_rows = ("Ingreso Critaloide", "Ingreso Coloide", "Ingreso hemocomponente")`
     (keep the source's `Critaloide` misspelling, or normalise on a pinned slug).
   - `loss_rows = ("NCL", "DCL", "3er Espacio", "Diuresis", "Circuito respiratorio", "Sangrado")`.
   - Return keys `balance_parcial`, `balance_total` (cumulative), `total_a_reponer` per hour;
     add `gasto_urinario` (= Diuresis/`peso`/hr) and `tasa_fentanilo` (needs `drugs[]` fentanyl
     + `peso`) — so `_derive` (`case_service.py:19`) must pass patient weight and drugs in.
   - Pin the hour keys (normalise `"1 hr"→"1hr"`) and row keys (label→slug) — document in
     [[field-crosswalk]]. *Confirm the exact `Balance parcial/total` clinical formula with the
     anesthesiologist; the load-bearing fix is the row-name correctness + named outputs.*

2. **Restore `events` / `basal` / `termination` to `TransanestheticRecordDTO`**
   (`dto.py:76-79`) to match frozen Swift (`ClinicalRecord.swift:124-131`). Add
   `SurgicalEventDTO {marker:int, t:float, label:str}` and `VitalSnapshotDTO
   {fc,fr,ta_sys,ta_dia,spo2,pvc: Optional[float]}`; fields `events: list[SurgicalEventDTO]`,
   `basal`/`termination: VitalSnapshotDTO`. No Swift change (Swift already has them).

### CORRECTNESS

3. **Add missing `AnesthesiaCase` envelope attrs** (`dto.py:122-149`): `tipo: str`,
   `posicion: str`, `duracion_anestesia: str`, `observaciones: str`, `equipo_quirurgico: str`,
   `complicaciones_post: str`, `isquemia: dict|sub-DTO`, `neumoperitoneo: dict|sub-DTO`. Mirror
   the plain-string ones into `CaseEnvelopePatch` (`dto.py:164-174`) and Swift `AnesthesiaCase`
   (`ClinicalRecord.swift:172`).

4. **Extend `PreanestheticAssessmentDTO`** (`dto.py:46-58`): add `antecedentes_anestesicos`,
   `otros`, `medicamentos_previos`, `analgesica_obstetrica`, `aparato_respiratorio`,
   `aparato_cardiovascular`, `tegumentos` (all `str = ""`); change `labs: dict[str, float]` →
   `dict[str, str | float]` (qualitative urinalysis). Mirror in Swift `PreanestheticAssessment`
   (`ClinicalRecord.swift:78`).

5. **Give `checkbox_value` a composite value shape.** Either add a `Quantity` case to Swift
   `FieldValue` (`ClinicalRecord.swift:7`) + type `AnestheticTechniqueDTO.values` as
   `dict[str, bool | Quantity | str]` (`dto.py:63`), or pin a two-key convention
   (`<id>` bool + `<id>__value` Quantity) in [[field-crosswalk]]. Keep values keyed by canonical
   schema ids.

6. **Add `NewbornRecord.expulsion_placenta` + `estado_general_al_salir`** (`dto.py:107`, Swift
   L159). Paired: add `p.field(...)` ids for both in `imss_gen.py` `_build_p2_lower` (currently
   static text) so the cells become fillable.

7. **Complete the Patient/fluid derived set**: add `sp`, `vsc_25`, `vsc_15` derivations
   (`vsc_25 = 0.25·vsc`, `vsc_15 = 0.15·vsc`; `sp` = allowable blood loss, confirm formula) and
   stamp them in `_derive` (`case_service.py:12-20`). Add `hab` to `PatientRecordDTO`
   (`dto.py:31`). Add `cedula`, `universidad` to `ProviderDTO` (`dto.py:117`) + Swift `Provider`.

### NICE-TO-HAVE

8. **Harden `aldrete_total()`** (`derivations.py:25`): restrict the sum to the five canonical
   criteria (ignore a stray `total`/unknown key), clamp 0–10, and pin the time-point key map
   (`al_salir/0/20/60/90/120 ↔ c0..c5`) in [[field-crosswalk]].

9. **Use the shared `Quantity` VO for drug dose** (`DrugAdministrationDTO.dose_value/dose_unit`,
   `dto.py:87-88`) for cross-entity consistency with [[rest-contract]] §3 — cosmetic.

10. **Model chart `bands` + AGENTES rows** on `TransanestheticRecordDTO` (inhaled-agent series),
    and add the IMSS p2 `clasificacion` footer (`foot_0..7`) as derived case fields, for a
    complete `fill-pdf`.

---

## Sources

- Contracts: `backend/app/application/dto.py`, `backend/app/domain/derivations.py`,
  `backend/app/application/case_service.py`; frozen mirror `PharmaApp/Models/ClinicalRecord.swift`.
- Parsing ground truth: `notebooks/forms/{schema_extract,regen,imss_gen,pdfsrc}.py`;
  `notebooks/forms/schema/{nota2,nota21,imss_p1,imss_p2}.schema.json`.
- Synthesis: `notebooks/docs/parsing-wiki/entities/*.md`, `…/schema-spec.md`.
- Wiki: [[field-inventory]], [[field-crosswalk]], [[rest-contract]], [[clinical-record]],
  [[schema-spec]].
</content>
</invoke>
