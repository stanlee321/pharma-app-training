"""Form-schema discovery router.

Serves the field-schema JSON produced by the notebooks/forms parsing pipeline
(``notebooks/forms/schema/*.schema.json``). These schemas are the crosswalk source
the (later-phase) filled-PDF export will key against; here they are read-only.

``settings.schema_dir`` may be absent in some environments (e.g. a bare API deploy
without the notebooks tree) — every handler guards for that and degrades to an empty
list / 404 rather than raising.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ...application import dto
from ...core.config import settings

router = APIRouter(tags=["forms"], responses={404: dto.ERROR_RESPONSES[404]})

_GLOB = "*.schema.json"


def _schema_dir() -> Path:
    return Path(settings.schema_dir)


def _read_json(path: Path) -> dict | None:
    """Parse a schema file, returning None on any read/parse error (skip, don't crash)."""
    try:
        with path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _title_for(form_id: str, data: dict) -> str:
    title = data.get("title")
    if isinstance(title, str) and title.strip():
        return title
    return form_id.replace("_", " ").title()


@router.get("/forms", response_model=list[dto.FormInfoDTO])
def list_forms() -> list[dict]:
    """List available form schemas as ``{form_id, title}`` entries."""
    directory = _schema_dir()
    if not directory.is_dir():
        return []
    out: list[dict] = []
    for path in sorted(directory.glob(_GLOB)):
        data = _read_json(path)
        if data is None:
            continue
        form_id = data.get("form_id") or path.name[: -len(".schema.json")]
        out.append({"form_id": form_id, "title": _title_for(form_id, data)})
    return out


@router.get(
    "/forms/{form_id}/schema",
    response_model=dto.FormSchemaDTO,
    # keys the pipeline did not emit stay absent (the payload is the schema file as parsed)
    response_model_exclude_unset=True,
)
def get_form_schema(form_id: str) -> dict:
    """Return the parsed schema whose ``form_id`` matches; 404 if none. The common keys are
    typed (``FormSchemaDTO``); any other key in the file passes through unchanged."""
    directory = _schema_dir()
    if directory.is_dir():
        for path in sorted(directory.glob(_GLOB)):
            data = _read_json(path)
            if data is not None and data.get("form_id") == form_id:
                return data
    raise HTTPException(status_code=404, detail="Form schema not found")
