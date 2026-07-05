---
type: entity
updated: 2026-07-05
tags: [parsing, entity, richest]
entity: AnestheticTechnique
---

# Entity — AnestheticTechnique (Técnica anestésica)

How the anesthetic was delivered. The **richest** entity — it's the whole of
[[nota-postanestesica]] (254 fields across 3 zones) plus IMSS p2 `metodo`. Modeled as a
tagged union by modality.

## Structure

### Modality (top-level choice) — nota2 `Técnica anestésica administrada`
`AGIB | AGEV | BEPD | BESA | BEMIX | Epidural Caudal | Local | Bloqueo de Plexo |
Bloqueo Troncular | Bloqueo Paravertebral | Sedación | Otro`.

### General anesthesia (`nota2` zone *Anestesia General*, 44 fields; IMSS p2 `metodo`)
- `induccion`: inhalatoria/endovenosa; agents + doses → [[drug-administration]]
  (Propofol, Etomidato, Fentanilo, Tiopental, relajantes…).
- `via_aerea`: IET (oral/nasal) / LMA / laringoscopía (Cormack-Lehane I–IV, pala, nº
  intentos) / TET (tipo, calibre, guía, manguillo) / verificación.
- `ventilacion`: modo (controlada/asistida/espontánea), ciclado (volumen/presión/SIMV),
  parámetros (Vt, FiO₂, FGF, PVA, Ppic, Pmax, FR, PEEP, I:E).
- `mantenimiento`: sevo/des/iso, relajantes, opioides, N₂O/aire.
- `emersion` / `extubacion` (con/sin incidentes).

### Regional neuraxial (`nota2` zone *Anestesia Regional Neuroaxial*, 59 fields)
- `abordaje_epidural` (medio/paramedio, aguja Tuohy, espacio, pérdida de resistencia).
- `abordaje_subaracnoideo` (aguja Quincke/Sprotte/Whitacre, LCR, parestesia).
- `anestesico` (Lidocaína/Ropivacaína/Bupivacaína %, baricidad), `adyuvantes`,
  `cateter` (calibre, dirección, dosis).

### Peripheral block (`nota2` zone *Bloqueo Periférico*, 21 fields)
- per-nerve rows (Plexo Cervical/Braquial/Lumbo-Sacro/Ciático…): `lado I/D`, `abordaje`,
  `aguja`, `anestésico local y dosis`.

### IMSS p2 método (compact equivalent)
`induccion (IV/IM/inhalación), mascarilla, canula_faringea, tubo_endotraqueal
(nas/oral, calibre), globo_inflable, complicaciones, sangre_y_soluciones`.

## Relationships

Belongs to [[anesthesia-case]]. Emits many [[drug-administration]] records (the dosed
agents). Airway/ventilation params co-occur with [[transanesthetic-record]].

## Round-trip

Fills nearly all of nota2 (checkbox/blank fields, grouped by the 3 zone `section`s) and
the `metodo` column of IMSS p2. Checkbox fields → booleans; `checkbox_value` → boolean +
value.
