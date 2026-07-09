---
type: schema
domain: project
updated: 2026-07-09
tags: [wiki-config, pharma-app, parsing]
---

# Project Wiki — Schema & Conventions

Instantiates the LLM Wiki pattern ([`../llmwiki.md`](../llmwiki.md)) at the **project**
level. This is the schema layer: the config that makes the LLM a disciplined maintainer
rather than a generic chatbot. Read this first when operating on the wiki.

## Domain

The whole project: the **TivaTrainer** SwiftUI/iOS pharmacokinetic simulation app + its
PK engine, the **anesthesia-forms parsing / PDF-regeneration** pipeline, and the shared
clinical **domain model (entities)** that bridges them.

## Ground truth = SOURCE CODE

The wiki reflects what the code **actually does today**, not what design docs aspire to.

- Every claim traces to a source file; cite `path` + the symbol (type/func/property).
  Line numbers drift — cite symbols.
- When a design doc in `docs/reference/**` contradicts the code, **the code wins** —
  note the drift explicitly (e.g. "`RustPKEngine` is a `fatalError` stub, not
  implemented; `EngineProvider.useMock` must stay `true`").
- Unsure about intent? Read the source. Use `docs/reference/**` only for clarification.

## Three layers (per the pattern)

| Layer | Location |
|---|---|
| **Raw sources** (immutable) | `PharmaApp/**` (Swift), `notebooks/forms/**` (parsing), `docs/reference/**` (design specs + media), `notebooks/data/*.pdf` |
| **The wiki** (LLM-owned) | `docs/wiki/**` (this tree) + federated `notebooks/docs/parsing-wiki/**` |
| **The schema** (config) | this file + repo-root `CLAUDE.md` |

## Directory layout

```
docs/
  llmwiki.md            # the pattern (raw reference)
  wiki/                 # THIS wiki (project-level, LLM-owned)
    SCHEMA.md  index.md  log.md  cold-resume.md  architecture.md
    app/                # the Swift app + PK engine, grounded in PharmaApp/**
    parsing.md          # federation hub → the parsing sub-wiki + the app bridge
  reference/            # raw human-authored design specs (functional/technical/rust-engine-spec/uiux/media)
notebooks/docs/parsing-wiki/   # federated sub-wiki (forms parsing) — stays put, own SCHEMA
```

## Federation

The forms-parsing wiki lives at `notebooks/docs/parsing-wiki/` (co-located with the
`notebooks/forms/` code it documents; its relative links depend on that location). It is
a first-class sub-wiki with its own SCHEMA. This project wiki **federates** it:
`index.md` and `parsing.md` link into it (relative markdown links); we do **not**
duplicate its pages.

## Conventions

- **Frontmatter** on every page: `type`, `updated` (ISO date), `tags`. Types:
  `schema | index | log | resume | architecture | page`.
- **Wikilinks** by basename within this wiki: `[[engine]]`, `[[pk-engine-math]]`.
  Cross-wiki (into the parsing sub-wiki) uses relative markdown links.
- **Code refs**: `PharmaApp/Engine/MockPKEngine.swift` + symbol.
- Behaviors/numbers traceable to the file that establishes them.

## Workflows

- **Ingest** (code change / new source): read the affected source → update the
  subsystem page(s) → update [[index]] + append [[log]]. A change may touch several
  pages.
- **Query**: read [[index]] → drill in → answer with `path:symbol` citations. **File
  good answers back** as pages so exploration compounds.
- **Lint**: grounding (claims trace to code), doc-vs-code drift, dangling wikilinks,
  orphans, index completeness. Append a `lint` entry to [[log]].

## Log format

Append-only, grep-able prefix: `## [YYYY-MM-DD] <op> | <subject>`,
`<op>` ∈ `ingest | query | lint | build`.
