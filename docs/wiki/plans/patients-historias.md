---
type: plan
updated: 2026-09-25
tags: [plan, patients, historias-clinicas, i18n, backend, web]
---

# Historias clínicas — Patient → Cases, Spanish UI

Follows [[web-port]] and [[auth-admin]]. Source: the user's annotated sketch (2026-09-25):
list of patients → **missing intermediate screen** (patient + their cases, "+" = new case for that
patient) → the existing case Hub, all in Spanish.

## Decisions (2026-09-25)

| Decision | Choice |
|---|---|
| Visibility | **Shared across the hospital**: every anesthesiologist sees every patient and all their cases; cases written by others are **read-only**; you edit only your own drafts. Admin sees everything. |
| Patient identity | **Registro / expediente is unique** (trimmed, case-insensitive). Creating a patient with an existing registro returns/opens the existing one. |
| Language | **Spanish only** (every screen, message, admin area). |
| Existing cases | **Grouped into patients** by the migration. |

## Data model

- New `patients`: `id` uuid · `registro` (unique normalized, nullable only for legacy rows without
  one) · `nombre` · `sexo` · `fecha_nacimiento` (nullable) · `grupo_sanguineo` · `rh` ·
  `created_by` / `updated_by` (FK users) · `created_at` · `updated_at`.
- `cases.patient_id` → FK `patients.id` (NOT NULL after migration, ON DELETE RESTRICT).
- **Identity lives on the patient; per-encounter values stay on the case** (peso, talla, edad at
  the encounter, Hb/Hto, cama, dilución). A new case copies the identity + the last case's
  biometrics as defaults. The case keeps a **snapshot** of name/registro for the PDFs; editing a
  patient updates the snapshot of that patient's **draft** cases only — finalized cases never change.
- Migration: group existing cases by normalized registro (global); cases without registro by
  (owner, lowercased nombre); otherwise one patient per case. Then `patient_id` NOT NULL.

## API (additions)

- `GET /patients?q=&limit=&offset=` (name/registro search) · `POST /patients` (409 + existing id on a
  duplicate registro) · `GET /patients/{id}` (+ case summaries: number, date, diagnosis, status,
  author) · `PATCH /patients/{id}` (any anesthesiologist; `updated_by` recorded) ·
  `DELETE /patients/{id}` (admin, only without cases).
- Case create requires `patient_id`. Authorization matrix change: anesthesiologists may **read** any
  case; writes stay owner + draft only.
- Admin: case list filter by patient, patients page, `patients_total` in stats.

## Web

1. **Historias clínicas** (replaces "Encounters"): patient list with search; "+" = new patient
   (nombre, registro, sexo, fecha de nacimiento, grupo, Rh) with duplicate-registro handling.
2. **Paciente** (new screen): header nombre + registro (+ edad, sexo), datos del paciente (editable),
   list of cases (Caso N · fecha · diagnóstico · estado · autor; others' cases open read-only),
   "+" = new case for this patient → Hub.
3. **Hub**: back goes to the patient; "Datos del paciente" shows identity read-only with a link to
   edit the patient, and per-encounter values editable.
4. **Spanish everywhere**, incl. the admin area, errors, empty states, dates (`es-MX`).
5. Admin: patients page (search, case counts, delete empty), case list filter/column by patient.

## Build

One `/delegate-build` workflow: (1) backend patients + migration + authz + tests + docs, (2) web
patient list + patient screen + new-case flow + Hub/patient-data changes, (3) Spanish translation of
the whole UI, (4) admin patients + e2e script. Per-increment review + final audit (live run against
a **scratch** backend on a scratch DB — the shared Docker stack testers use is never touched).
