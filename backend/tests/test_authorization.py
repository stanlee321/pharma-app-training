"""Increment 2: case authorization matrix — tenant isolation, admin read-only on /cases,
the finalized lock (409), and the anestesiologo prefill on create."""
import pytest

CASE_ID = "31111111-2222-4333-8444-555555555555"


def _writes(case_id: str, drug_id: str = "41111111-2222-4333-8444-555555555555"):
    """Every /cases write for one case, as (method, path, json)."""
    base = f"/api/v1/cases/{case_id}"
    return [
        ("put", base, {"owner": "x"}),
        ("patch", base, {"sala": "9"}),
        ("put", f"{base}/patient", {"nombre": "Otro"}),
        ("put", f"{base}/recovery-score", {}),
        ("post", f"{base}/drugs", {"farmaco": "Propofol"}),
        ("patch", f"{base}/drugs/{drug_id}", {"dose_value": 1}),
        ("delete", f"{base}/drugs/{drug_id}", None),
        ("delete", base, None),
    ]


def _call(client, method, path, body, headers):
    kwargs = {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    return getattr(client, method)(path, **kwargs)


@pytest.fixture
def two_anesthesiologists(user_factory, auth_headers):
    a = user_factory(username="dra_a", full_name="Dra. A Sintetica", clave="A-1")
    b = user_factory(username="dr_b", full_name="Dr. B Sintetico", clave="B-2")
    return (a, auth_headers(a)), (b, auth_headers(b))


def test_tenant_isolation_between_anesthesiologists(client, two_anesthesiologists):
    (a, ha), (b, hb) = two_anesthesiologists
    cid = client.post("/api/v1/cases", json={}, headers=ha).json()["id"]
    drug = client.post(f"/api/v1/cases/{cid}/drugs", json={"farmaco": "Propofol"}, headers=ha)
    drug_id = drug.json()["id"]

    assert [c["id"] for c in client.get("/api/v1/cases", headers=hb).json()] == []
    assert [c["id"] for c in client.get("/api/v1/cases", headers=ha).json()] == [cid]
    for path in [f"/api/v1/cases/{cid}", f"/api/v1/cases/{cid}/patient",
                 f"/api/v1/cases/{cid}/drugs"]:
        assert client.get(path, headers=hb).status_code == 404, path
    assert client.post(f"/api/v1/cases/{cid}/export/nota_postanestesica",
                       headers=hb).status_code == 404
    for method, path, body in _writes(cid, drug_id):
        resp = _call(client, method, path, body, hb)
        assert resp.status_code == 404, (method, path, resp.text)

    # nothing B tried changed A's case (incl. the PUT upsert hijack attempt)
    case = client.get(f"/api/v1/cases/{cid}", headers=ha).json()
    assert case["user_id"] == a.id and case["owner"] == "" and case["sala"] == ""
    assert len(case["drugs"]) == 1


def test_admin_reads_any_case_but_cannot_write(client, anesthesiologist, admin_user,
                                               auth_headers):
    ha, hadmin = auth_headers(anesthesiologist), auth_headers(admin_user)
    cid = client.post("/api/v1/cases", json={}, headers=ha).json()["id"]
    drug_id = client.post(f"/api/v1/cases/{cid}/drugs", json={"farmaco": "Propofol"},
                          headers=ha).json()["id"]

    listed = client.get("/api/v1/cases", headers=hadmin)
    assert listed.status_code == 200
    rows = listed.json()
    assert [r["id"] for r in rows] == [cid]
    assert rows[0]["owner_name"] == anesthesiologist.full_name
    assert client.get(f"/api/v1/cases/{cid}", headers=hadmin).status_code == 200
    assert client.get(f"/api/v1/cases/{cid}/drugs", headers=hadmin).status_code == 200
    exp = client.post(f"/api/v1/cases/{cid}/export/nota_postanestesica", headers=hadmin)
    assert exp.status_code == 200 and exp.headers["content-type"].startswith("application/pdf")

    assert client.post("/api/v1/cases", json={}, headers=hadmin).status_code == 403
    assert client.put(f"/api/v1/cases/{CASE_ID}", json={}, headers=hadmin).status_code == 403
    for method, path, body in _writes(cid, drug_id):
        resp = _call(client, method, path, body, hadmin)
        assert resp.status_code == 403, (method, path, resp.text)
    assert client.get(f"/api/v1/cases/{cid}", headers=ha).json()["drugs"][0]["id"] == drug_id


def test_admin_missing_case_404(client, admin_user, auth_headers):
    assert client.get(f"/api/v1/cases/{CASE_ID}",
                      headers=auth_headers(admin_user)).status_code == 404


def test_finalized_case_is_locked(client, anesthesiologist, auth_headers, case_factory):
    h = auth_headers(anesthesiologist)
    drug_id = "41111111-2222-4333-8444-555555555555"
    row = case_factory(user_id=anesthesiologist.id, status="finalized",
                       drugs=[{"id": drug_id, "farmaco": "Propofol"}])
    for method, path, body in _writes(row.id, drug_id):
        resp = _call(client, method, path, body, h)
        assert resp.status_code == 409, (method, path, resp.text)
        assert resp.json() == {"detail": "case is finalized"}

    # reads (and PDF export) still work
    got = client.get(f"/api/v1/cases/{row.id}", headers=h)
    assert got.status_code == 200 and got.json()["status"] == "finalized"
    assert len(got.json()["drugs"]) == 1 and got.json()["owner"] == "tester"
    assert client.post(f"/api/v1/cases/{row.id}/export/registro_transanestesico",
                       headers=h).status_code == 200


def test_draft_case_writes_still_allowed(client, anesthesiologist, auth_headers, case_factory):
    h = auth_headers(anesthesiologist)
    row = case_factory(user_id=anesthesiologist.id)
    assert client.patch(f"/api/v1/cases/{row.id}", json={"sala": "2"}, headers=h).status_code == 200
    assert client.delete(f"/api/v1/cases/{row.id}", headers=h).status_code == 204


def test_other_users_finalized_case_is_404_not_409(client, two_anesthesiologists, case_factory):
    (a, _), (_, hb) = two_anesthesiologists
    row = case_factory(user_id=a.id, status="finalized")
    assert client.patch(f"/api/v1/cases/{row.id}", json={"sala": "1"}, headers=hb).status_code == 404


# --- prefill -----------------------------------------------------------------------------

def test_post_create_prefills_anestesiologo(client, anesthesiologist, auth_headers):
    body = client.post("/api/v1/cases", json={}, headers=auth_headers(anesthesiologist)).json()
    assert body["anestesiologo"]["nombre"] == "Dra. Ana Sintetica"
    assert body["anestesiologo"]["clave"] == "ANE-111"


def test_put_create_prefills_only_when_empty(client, anesthesiologist, auth_headers):
    h = auth_headers(anesthesiologist)
    empty = client.put(f"/api/v1/cases/{CASE_ID}", json={"anestesiologo": {"cedula": "123"}},
                       headers=h).json()
    assert empty["anestesiologo"] == {"nombre": "Dra. Ana Sintetica", "clave": "ANE-111",
                                      "cedula": "123", "universidad": ""}

    other = "51111111-2222-4333-8444-555555555555"
    given = client.put(f"/api/v1/cases/{other}",
                       json={"anestesiologo": {"nombre": "Dr. Suplente", "clave": ""}},
                       headers=h).json()
    assert given["anestesiologo"]["nombre"] == "Dr. Suplente"
    assert given["anestesiologo"]["clave"] == ""

    # the replace path never re-prefills (the owner may clear the provider on purpose)
    cleared = client.put(f"/api/v1/cases/{CASE_ID}", json={"anestesiologo": {}}, headers=h).json()
    assert cleared["anestesiologo"]["nombre"] == ""
