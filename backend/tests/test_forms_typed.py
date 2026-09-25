"""Must-fix from the increment-3 review: /forms routes are typed in openapi, and the typed
response still carries each schema file unchanged."""
import json
from pathlib import Path

import pytest

from app.core.config import settings

API = "/api/v1"


def _schema_files() -> list[Path]:
    d = Path(settings.schema_dir)
    return sorted(d.glob("*.schema.json")) if d.is_dir() else []


def test_forms_routes_have_typed_responses(client):
    spec = client.get("/openapi.json").json()
    listing = spec["paths"][f"{API}/forms"]["get"]["responses"]["200"]["content"][
        "application/json"]["schema"]
    assert listing["type"] == "array" and listing["items"]["$ref"].endswith("/FormInfoDTO")
    one = spec["paths"][f"{API}/forms/{{form_id}}/schema"]["get"]["responses"]["200"][
        "content"]["application/json"]["schema"]
    assert one["$ref"].endswith("/FormSchemaDTO")
    schemas = spec["components"]["schemas"]
    assert {"form_id", "title"} <= set(schemas["FormInfoDTO"]["properties"])
    props = schemas["FormSchemaDTO"]["properties"]
    assert props["fields"]["items"]["$ref"].endswith("/FormFieldDTO")
    assert props["tables"]["items"]["$ref"].endswith("/FormTableDTO")


@pytest.mark.skipif(not _schema_files(), reason="no form schemas in settings.schema_dir")
def test_schema_payload_is_the_file_unchanged(client):
    listed = client.get(f"{API}/forms").json()
    assert len(listed) == len(_schema_files())
    for path in _schema_files():
        raw = json.loads(path.read_text(encoding="utf-8"))
        resp = client.get(f"{API}/forms/{raw['form_id']}/schema")
        assert resp.status_code == 200
        assert resp.json() == raw, path.name


def test_unknown_form_schema_is_404(client):
    assert client.get(f"{API}/forms/no_such_form/schema").status_code == 404
