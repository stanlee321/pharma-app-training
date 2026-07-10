---
type: plan
updated: 2026-07-10
tags: [plan, decisions, adr, architecture]
---

# Build Decisions (ADRs)

The architectural decisions that close the gaps found in the [[forms-to-app|plan]]
readiness review, so development starts from a contradiction-free spec. Each is an ADR:
**Context → Decision → Consequences.** Status is *Accepted (proposed)* — Stanley can veto
any; if changed, update the affected plan page and log it.

These resolve the open questions previously left in [[rest-contract]] §6 and the
undecided app-architecture fork.

---

## ADR-1 — The app is native hand-built screens, not a schema-driven form renderer

**Context.** Two contradictory app models were present: [[rest-contract]] §0/§4 implied the
app *"renders forms dynamically from server-served field metadata,"* while
[[proposed-screens]] + [[ux-ui]] design bespoke native screens per entity (the "native UX,
not a form viewer" thesis). These are different apps; only one can be built.

**Decision.** **Native, bespoke SwiftUI screens** — the [[proposed-screens]] set, with the
[[ux-components]] widgets and the [[ux-ui]] two-tempo/ergonomic flows. The app binds entity
DTOs to `Codable` structs ([[rest-contract]] §3); it is **not** a generic form engine.

Nuance (the precise synthesis, not either/or): within the **dense repetitive sections**
(the ~185-field `AnestheticTechnique`, the fluid/Aldrete grids) a screen **may data-drive
its field list from the schema** so we don't hand-code hundreds of toggles — but that is a
*bespoke screen iterating a field catalogue*, not a generic renderer. The schema is the
field catalogue + the export/validation source, **not** the layout engine.

**Consequences.**
- The schema/bbox metadata is a **server-side concern** (export + validation). The app does
  not need bboxes or dynamic layout.
- `[[rest-contract]]` §0/§4 wording corrected (was "app renders forms dynamically").
- The heavy screens need the schema's per-section field list at build time (bundled or
  fetched once), keyed by field `id` — see [[field-crosswalk]].

---

## ADR-2 — App persistence: online-first MVP behind a `CaseStore` protocol; offline deferrable

**Context.** The backend is the system of record ([[forms-to-app]]), but the app's local
model was undecided (in-memory + REST vs local cache vs offline-first). An intra-op OR tool
may lack network; but offline-first is a large commitment.

**Decision.** MVP is **online-first**: `AppState` fetches/edits a `Case` over REST and
holds it in memory, auto-saving on edit (`PUT`/`PATCH`). All access goes through a
**`CaseStore` protocol** (a port), so a local-cache/offline implementation (SwiftData or a
file cache) can be dropped in later **without rewiring screens**.

**Consequences.**
- Screens depend on `CaseStore`, never on `URLSession` directly.
- Ship value fast; revisit offline once the OR/network reality is known. Flag: intra-op
  capture ([[ux-ui]] P1) is the case that will most want offline — measure before deciding.

---

## ADR-3 — Auth/tenancy: `cases.owner` from day one; full auth a later phase

**Context.** Multi-clinic/author tenancy was punted in [[rest-contract]] §6.

**Decision.** Add an `owner` (and later `clinic`) column to `cases` from the **first
migration**, and thread an author identity through the API seam, but defer real
authentication (tokens/OIDC) to a dedicated later phase. Endpoints assume a resolved
author for now.

**Consequences.** No schema migration pain when auth lands; the ownership column exists
early. Not production-secure until the auth phase — acceptable for the build MVP.

---

## ADR-4 — Export is synchronous by default

**Context.** [[rest-contract]] §2.4 left sync-vs-async open.

**Decision.** `POST /cases/{id}/export/{form_id}` renders **synchronously** and returns
`application/pdf`. Add the `202 + poll` path **only if** measured render latency warrants
it (the notebook renderers clone a form in tens of ms; fill-pdf adds a bounded value pass).

**Consequences.** Simplest client; N10 ([[proposed-screens]]) shows a brief spinner. Revisit
with real numbers.

---

## ADR-5 — TCI "recommended dose" is computed client-side, not in the backend

**Context.** [[rest-contract]] §6 asked whether the `recommended` TCI dosing on
`DrugAdministration` is computed server-side or delegated to the Swift/Rust engine.

**Decision.** The **app's existing PK engine** ([[pk-engine-math]]) computes the recommended
bolus/infusion (it already does, for the simulation screen). The backend stores only the
**given** dose; `recommended` is a client-side decision aid, not persisted authoritative
data. Do **not** re-implement the PK math server-side.

**Consequences.** No duplicated/divergent engine (the [[frontend-audit-2026-07-09|audit]]'s
lesson). Gated by **Phase 0** — the Schnider V3 fix must land before any recommendation is
surfaced.

---

## ADR-6 — The field-id ↔ entity crosswalk is a first-class, server-side artifact

**Context.** The schema speaks in opaque ids (`propofol_42`); the DTOs speak in clean
attributes (`imc`). Nothing yet maps the ~471 ids to entity attributes/bboxes — the
integration piece the export and validation both need.

**Decision.** Build the crosswalk as an explicit, versioned artifact, **server-side**, built
semi-automatically then curated. Fully specified in [[field-crosswalk]]. It is a
**prerequisite for the fill-pdf export** and for `schema_service` validation.

**Consequences.** [[field-crosswalk]] is the concrete next artifact after Phase 0 / the
backend skeleton; the fill-pdf layer ([[rest-contract]] §2.4) consumes it.

---

Related: [[forms-to-app]] (roadmap), [[rest-contract]] (the contract these correct/close),
[[proposed-screens]] / [[ux-ui]] (the native app these decisions lock in),
[[field-crosswalk]] (the artifact ADR-6 mandates).
