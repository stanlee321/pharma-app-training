---
type: schema
domain: pdf-form-parsing
updated: 2026-07-05
tags: [parsing, wiki-config]
---

# Parsing Wiki — Schema & Conventions

This is the **schema layer** (per [`../llmwiki.md`](../llmwiki.md)): the config that
makes an LLM a disciplined maintainer of this wiki rather than a generic chatbot.
Read this first when operating on the wiki.

## Domain

**PDF form parsing & digitization.** We convert paper/vector clinical forms into
(a) a **1:1 print-faithful clone** and (b) a **structured field schema (JSON)** that
drives a digital equivalent in the app. The knowledge here is the *methodology* —
techniques, gotchas, per-document playbooks — not the app itself.

Guiding principle (user-set): capture everything **from the context of parsing**.
Pharma/clinical meaning belongs to the app's own docs, not here.

## Three layers

| Layer | Location | Who owns it |
|---|---|---|
| **Raw sources** (immutable) | `../../data/*.pdf` (inputs), `../../forms/` (code + artifacts) | user / pipeline — never edited by the wiki |
| **The wiki** (this dir) | `docs/parsing-wiki/` | the LLM writes & maintains all of it |
| **The schema** (config) | this file | co-evolved by user + LLM |

## Directory layout

```
docs/parsing-wiki/
  SCHEMA.md          ← you are here (layer 3)
  index.md           ← content catalog (read first on query)
  log.md             ← append-only chronological record
  cold-resume.md     ← 60-second orientation for a fresh session
  strategy.md        ← the end-to-end decision playbook + procedure
  pipeline.md        ← the 3-module code architecture
  schema-spec.md     ← the output JSON contract (fields/tables/charts)
  lessons.md         ← hard-won gotchas, one place, linkable
  techniques/        ← one focused page per reusable method
  sources/           ← one page per parsed document
  entities/          ← the domain model (synthesis): the objects the forms encode
```

The **entities/** layer is the synthesis that bridges parsing → app: parsed fields roll
up into domain entities ([[entities/model]]), which the app collects as inputs and binds
back onto any form's schema to regenerate the exact PDF (the round-trip).

## Page conventions

- **Frontmatter** (YAML) on every page: `type`, `updated` (ISO date), `tags`.
  Enables Obsidian Dataview. Types: `schema | index | log | strategy | pipeline |
  spec | technique | source | lessons | resume | entity | entity-index`.
- **Cross-links** use Obsidian wikilinks by basename: `[[ink-oracle]]`,
  `[[nota-postanestesica]]`. Link liberally; a link to a not-yet-written page is a
  valid TODO marker.
- **Code references** point at `../../forms/<file>.py` by function/symbol name
  (line numbers drift). Quote the parameter/threshold values we settled on.
- **Filenames** are kebab-case, one concept per page.
- Numbers must be **traceable** — a fidelity figure or field count states which run
  produced it (see [[log]]).

## Workflows

### Ingest — a new document arrives
1. **Classify** it (see [[strategy]]): vector vs scanned; identify the producer
   (`pdfinfo`, `pdffonts`, `pdfimages`).
2. **Run the pipeline** (`../../forms/`): `regen.py` for the clone, `schema_extract.py`
   for the schema. For a new layout, add a `PROFILES` entry (tables/chart) — generic
   field detection needs no config.
3. **Verify** (see [[fidelity-verification]]): pixel-diff the clone, render the
   detection overlay, eyeball it.
4. **File it**: write `sources/<slug>.md` (what it is, results, quirks, profile).
   If a *new technique or gotcha* was needed, write/append its page too — this is
   where methodology compounds.
5. **Entities**: fold the new form's fields into the domain model — extend existing
   [[entities/model|entity pages]] or add one, and update the field→entity map.
6. **Update** [[index]] and append a dated entry to [[log]].

### Query — answer a parsing question
Read [[index]] → drill into the relevant technique/source pages → answer with
citations to wiki pages and `forms/` symbols. **File good answers back** as a new
page (a comparison, a new decision rule) so exploration compounds.

### Lint — periodic health check
Scan for: contradictions between pages, stale numbers superseded by a newer run,
orphan pages (no inbound links), techniques used in code but lacking a page, missing
cross-refs. Propose fixes; apply on confirmation. Append a `lint` entry to [[log]].

## Log format

Append-only. Each entry starts with a grep-able prefix:
`## [YYYY-MM-DD] <op> | <subject>` where `<op>` ∈ `ingest | query | lint | build`.
`grep "^## \[" log.md | tail -5` → recent activity.
