"""Patients (historias clínicas): CRUD, unique registro, search, detail numbering, the case
create requirements, the draft snapshot refresh and the admin guards.
Plan: docs/wiki/plans/patients-historias.md. Every value is synthetic."""
from datetime import date, datetime, timedelta, timezone

import pytest

from app.application import patient_service
from app.infrastructure.models import CaseModel, PatientModel

from .conftest import IS_SQLITE

API = "/api/v1"
A = f"{API}/admin"
MISSING = "0badc0de-0000-4000-8000-000000000000"


@pytest.fixture
def anest(anesthesiologist, auth_headers):
    return anesthesiologist, auth_headers(anesthesiologist)


@pytest.fixture
def colleague(user_factory, auth_headers):
    u = user_factory(username="colega", full_name="Dr. Colega Sintetico", clave="COL-2")
    return u, auth_headers(u)


@pytest.fixture
def admin(admin_user, auth_headers):
    return admin_user, auth_headers(admin_user)


def _create(client, h, **body):
    payload = {"registro": "EXP-001", "nombre": "Paciente Uno", **body}
    return client.post(f"{API}/patients", json=payload, headers=h)


def _years_ago(years: int, days: int = 0) -> date:
    today = datetime.now(timezone.utc).date()
    return today.replace(year=today.year - years) - timedelta(days=days)


# --- create / read / validation ------------------------------------------------------------

def test_create_patient_trims_and_stamps(client, anest):
    user, h = anest
    birth = _years_ago(40, days=1)
    resp = _create(client, h, registro="  EXP-001 ", nombre=" Paciente Uno ", sexo="female",
                   fecha_nacimiento=birth.isoformat(), grupo_sanguineo=" O ", rh="+")
    assert resp.status_code == 200, resp.text
    p = resp.json()
    assert (p["registro"], p["nombre"], p["sexo"], p["grupo_sanguineo"], p["rh"]) == (
        "EXP-001", "Paciente Uno", "female", "O", "+")
    assert p["fecha_nacimiento"] == birth.isoformat() and p["edad"] == 40
    assert p["created_by"] == user.id and p["updated_by"] == user.id
    assert p["cases_count"] == 0
    got = client.get(f"{API}/patients/{p['id']}", headers=h).json()
    assert got["cases"] == [] and got["registro"] == "EXP-001"


def test_edad_is_null_without_birth_date(client, anest):
    _, h = anest
    assert _create(client, h).json()["edad"] is None


@pytest.mark.parametrize("body", [
    {"registro": "   "},
    {"nombre": ""},
    {"nombre": "  "},
    {"sexo": "x"},
    {"extra": 1},
    {"fecha_nacimiento": "2999-01-01"},
    {"registro": "R" * 256},
])
def test_create_validation_is_422(client, anest, body):
    _, h = anest
    assert _create(client, h, **body).status_code == 422


def test_create_requires_registro(client, anest):
    _, h = anest
    resp = client.post(f"{API}/patients", json={"nombre": "Sin Registro"}, headers=h)
    assert resp.status_code == 422


def test_patients_require_auth(client):
    assert client.get(f"{API}/patients").status_code == 401
    assert client.post(f"{API}/patients", json={"registro": "X", "nombre": "Y"}).status_code == 401


def test_unknown_patient_is_404(client, anest):
    _, h = anest
    assert client.get(f"{API}/patients/{MISSING}", headers=h).status_code == 404
    assert client.patch(f"{API}/patients/{MISSING}", json={"nombre": "X"},
                        headers=h).status_code == 404
    assert client.get(f"{API}/patients/not-a-uuid", headers=h).status_code == 422


# --- unique registro -----------------------------------------------------------------------

@pytest.mark.parametrize("variant", ["EXP-001", "exp-001", "  Exp-001  ", "EXP-001\t"])
def test_duplicate_registro_is_409_with_existing_id(client, anest, colleague, variant):
    _, h = anest
    _, hc = colleague
    first = _create(client, h).json()
    resp = _create(client, hc, registro=variant, nombre="Otro Nombre")
    assert resp.status_code == 409
    assert resp.json() == {"detail": "patient exists", "patient_id": first["id"]}
    assert client.get(f"{API}/patients", headers=h).json()["total"] == 1


def test_patch_to_a_taken_registro_is_409(client, anest):
    _, h = anest
    a = _create(client, h, registro="EXP-A").json()
    b = _create(client, h, registro="EXP-B", nombre="Paciente B").json()
    resp = client.patch(f"{API}/patients/{b['id']}", json={"registro": " exp-a "}, headers=h)
    assert resp.status_code == 409
    assert resp.json() == {"detail": "patient exists", "patient_id": a["id"]}
    # changing the case of its OWN registro is fine
    ok = client.patch(f"{API}/patients/{a['id']}", json={"registro": "exp-a"}, headers=h)
    assert ok.status_code == 200 and ok.json()["registro"] == "exp-a"


def test_registro_race_on_the_unique_index_is_409(client, anest, monkeypatch):
    """The pre-check lost the race: the unique index still answers 409 with the winner's id."""
    _, h = anest
    first = _create(client, h).json()
    monkeypatch.setattr(patient_service.PatientService, "_raise_if_taken",
                        lambda self, registro, other_than=None: None)
    resp = _create(client, h, registro="exp-001 ")
    assert resp.status_code == 409
    assert resp.json() == {"detail": "patient exists", "patient_id": first["id"]}


@pytest.mark.skipif(IS_SQLITE, reason="SQLite lower() is ASCII-only; Postgres is authoritative")
@pytest.mark.parametrize("skip_precheck", [False, True])
def test_registro_normalised_by_the_db_is_409_not_500(client, anest, monkeypatch, skip_precheck):
    """Python's 'İ'.lower() is 'i̇' but Postgres' lower('İ') is 'i': the conflict lookup must
    normalise in SQL like the unique index does, or the index violation surfaces as a 500."""
    _, h = anest
    first = _create(client, h, registro="i-7").json()
    if skip_precheck:
        monkeypatch.setattr(patient_service.PatientService, "_raise_if_taken",
                            lambda self, registro, other_than=None: None)
    resp = _create(client, h, registro="İ-7", nombre="Otro Nombre")
    assert resp.status_code == 409
    assert resp.json() == {"detail": "patient exists", "patient_id": first["id"]}


# --- update --------------------------------------------------------------------------------

def test_patch_records_updated_by_and_validates(client, anest, colleague):
    user, h = anest
    other, hc = colleague
    p = _create(client, h, fecha_nacimiento=_years_ago(30).isoformat()).json()
    resp = client.patch(f"{API}/patients/{p['id']}", json={"nombre": " Nuevo Nombre "},
                        headers=hc)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["nombre"] == "Nuevo Nombre"
    assert (body["created_by"], body["updated_by"]) == (user.id, other.id)
    # fecha_nacimiento may be cleared with null; other fields may not be null or blank
    cleared = client.patch(f"{API}/patients/{p['id']}", json={"fecha_nacimiento": None},
                           headers=h).json()
    assert cleared["fecha_nacimiento"] is None and cleared["edad"] is None
    for bad in ({"nombre": None}, {"registro": "  "}, {"sexo": None}, {"unknown": 1},
                {"fecha_nacimiento": "2999-01-01"}):
        assert client.patch(f"{API}/patients/{p['id']}", json=bad,
                            headers=h).status_code == 422, bad


def test_admin_may_edit_patients(client, anest, admin):
    _, h = anest
    au, ha = admin
    p = _create(client, h).json()
    resp = client.patch(f"{API}/patients/{p['id']}", json={"rh": "-"}, headers=ha)
    assert resp.status_code == 200 and resp.json()["updated_by"] == au.id


# --- search --------------------------------------------------------------------------------

def test_search_by_nombre_or_registro_with_paging(client, anest):
    _, h = anest
    for reg, name in [("EXP-10", "Ana Sintetica"), ("EXP-11", "beto sintetico"),
                      ("QX-99", "Carla Prueba"), ("50%_X", "Dora Porcentaje")]:
        assert _create(client, h, registro=reg, nombre=name).status_code == 200

    def names(**params):
        body = client.get(f"{API}/patients", params=params, headers=h).json()
        return [p["nombre"] for p in body["items"]], body["total"]

    assert names() == (["Ana Sintetica", "beto sintetico", "Carla Prueba",
                        "Dora Porcentaje"], 4)
    assert names(q="SINTETIC") == (["Ana Sintetica", "beto sintetico"], 2)
    assert names(q="qx-9") == (["Carla Prueba"], 1)
    assert names(q="%") == (["Dora Porcentaje"], 1)  # LIKE wildcards are literal
    assert names(q="_") == (["Dora Porcentaje"], 1)
    assert names(limit=2, offset=1) == (["beto sintetico", "Carla Prueba"], 4)
    assert client.get(f"{API}/patients", params={"limit": 0}, headers=h).status_code == 422


# --- detail: numbering, authors, can_edit -------------------------------------------------

def test_detail_numbers_cases_and_flags_can_edit(client, anest, colleague, admin,
                                                 patient_factory, case_factory):
    user, h = anest
    other, hc = colleague
    _, ha = admin
    p = patient_factory(registro="EXP-NUM", nombre="Paciente Numerado")
    t0 = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
    # inserted out of order on purpose: numbering follows created_at
    third = case_factory(user_id=user.id, patient_id=p.id, at=t0 + timedelta(days=2),
                         diagnostico_preop="dx tres")
    first = case_factory(user_id=user.id, patient_id=p.id, at=t0, status="finalized")
    second = case_factory(user_id=other.id, patient_id=p.id, at=t0 + timedelta(days=1))
    unrelated = case_factory(user_id=user.id)  # another patient

    detail = client.get(f"{API}/patients/{p.id}", headers=h).json()
    assert detail["cases_count"] == 3
    rows = detail["cases"]
    assert [(c["id"], c["numero"]) for c in rows] == [(first.id, 1), (second.id, 2),
                                                      (third.id, 3)]
    assert unrelated.id not in {c["id"] for c in rows}
    assert rows[2]["diagnostico_preop"] == "dx tres"
    assert [c["status"] for c in rows] == ["finalized", "draft", "draft"]
    assert [c["author_name"] for c in rows] == [user.full_name, other.full_name,
                                                user.full_name]
    assert [c["user_id"] for c in rows] == [user.id, other.id, user.id]
    # own draft only
    assert [c["can_edit"] for c in rows] == [False, False, True]
    as_other = client.get(f"{API}/patients/{p.id}", headers=hc).json()["cases"]
    assert [c["can_edit"] for c in as_other] == [False, True, False]
    as_admin = client.get(f"{API}/patients/{p.id}", headers=ha).json()["cases"]
    assert [c["can_edit"] for c in as_admin] == [False, False, False]
    listed = client.get(f"{API}/patients", params={"q": "EXP-NUM"}, headers=h).json()
    assert listed["items"][0]["cases_count"] == 3


def test_others_case_readable_but_not_writable(client, anest, colleague, patient_factory,
                                               case_factory):
    user, h = anest
    _, hc = colleague
    p = patient_factory()
    draft = case_factory(user_id=user.id, patient_id=p.id)
    assert client.get(f"{API}/cases/{draft.id}", headers=hc).status_code == 200
    resp = client.put(f"{API}/cases/{draft.id}/patient", json={"hb": 12}, headers=hc)
    assert resp.status_code == 403
    assert client.delete(f"{API}/cases/{draft.id}", headers=hc).status_code == 403
    assert client.patch(f"{API}/cases/{draft.id}", json={"sala": "2"}, headers=h).status_code == 200


# --- case creation under a patient ---------------------------------------------------------

def test_case_create_requires_a_known_patient(client, anest):
    _, h = anest
    cid = "71111111-2222-4333-8444-555555555555"
    assert client.post(f"{API}/cases", json={}, headers=h).status_code == 422
    assert client.post(f"{API}/cases", json={"patient_id": None}, headers=h).status_code == 422
    assert client.post(f"{API}/cases", json={"patient_id": MISSING},
                       headers=h).status_code == 404
    put = client.put(f"{API}/cases/{cid}", json={"sala": "1"}, headers=h)
    assert put.status_code == 422
    assert put.json()["detail"][0]["loc"] == ["body", "patient_id"]
    assert client.put(f"{API}/cases/{cid}", json={"patient_id": MISSING},
                      headers=h).status_code == 404
    assert client.get(f"{API}/cases", headers=h).json() == []


def test_new_case_copies_identity_and_previous_profile(client, anest, patient_factory,
                                                       case_factory):
    user, h = anest
    p = patient_factory(registro="EXP-COPY", nombre="Paciente Copia", sexo="female",
                        grupo_sanguineo="O", rh="+", fecha_nacimiento=_years_ago(33))
    case_factory(user_id=user.id, patient_id=p.id, patient={
        "nombre": "viejo", "profile": {"weight": 61.5, "height": 152, "age": 30,
                                       "gender": "female", "dilution": 5}})

    body = client.post(f"{API}/cases", json={"patient_id": p.id}, headers=h).json()
    assert body["patient_id"] == p.id
    pt = body["patient"]
    assert (pt["nombre"], pt["registro"], pt["grupo_sanguineo"], pt["rh"]) == (
        "Paciente Copia", "EXP-COPY", "O", "+")
    assert pt["profile"] == {"weight": 61.5, "height": 152, "age": 33, "gender": "female",
                             "dilution": 5}
    assert pt["imc"] is not None

    # values the client chose win over the copied defaults; identity always comes from the
    # patient; a replace never moves the case to another patient
    cid = "81111111-2222-4333-8444-555555555555"
    other = patient_factory(registro="EXP-OTRO")
    put = client.put(f"{API}/cases/{cid}", headers=h, json={
        "patient_id": p.id, "patient": {"nombre": "cliente", "profile": {"weight": 80}}})
    assert put.status_code == 200, put.text
    prof = put.json()["patient"]["profile"]
    assert (prof["weight"], prof["height"], prof["age"]) == (80, 152, 33)
    assert put.json()["patient"]["nombre"] == "Paciente Copia"
    moved = client.put(f"{API}/cases/{cid}", json={"patient_id": other.id, "sala": "5"},
                       headers=h)
    assert moved.status_code == 200 and moved.json()["patient_id"] == p.id


def test_first_case_without_history_keeps_client_defaults(client, anest, patient_factory):
    _, h = anest
    p = patient_factory()
    prof = client.post(f"{API}/cases", json={"patient_id": p.id},
                       headers=h).json()["patient"]["profile"]
    assert (prof["weight"], prof["height"], prof["age"], prof["dilution"]) == (70, 170, 40, 10)


# --- snapshot refresh ----------------------------------------------------------------------

def test_patch_refreshes_draft_snapshots_only(client, anest, colleague, patient_factory,
                                              case_factory, db):
    user, h = anest
    other, _ = colleague
    p = patient_factory(registro="EXP-SNAP", nombre="Antes")
    snap = {"nombre": "Antes", "registro": "EXP-SNAP", "hb": 11.5,
            "profile": {"weight": 66, "gender": "male"}}
    mine = case_factory(user_id=user.id, patient_id=p.id, patient=snap)
    theirs = case_factory(user_id=other.id, patient_id=p.id, patient=snap)
    locked = case_factory(user_id=user.id, patient_id=p.id, status="finalized", patient=snap)
    versions = {m.id: m.version for m in (mine, theirs, locked)}

    resp = client.patch(f"{API}/patients/{p.id}", headers=h, json={
        "nombre": "Despues", "registro": "EXP-SNAP-2", "sexo": "female", "rh": "-"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["cases_count"] == 3

    db.expire_all()
    for m in (mine, theirs):
        row = db.get(CaseModel, m.id)
        pt = row.data["patient"]
        assert (pt["nombre"], pt["registro"], pt["rh"], pt["profile"]["gender"]) == (
            "Despues", "EXP-SNAP-2", "-", "female")
        # per-encounter values untouched
        assert pt["hb"] == 11.5 and pt["profile"]["weight"] == 66
        assert row.version == versions[m.id] + 1
    row = db.get(CaseModel, locked.id)
    assert row.data["patient"] == snap and row.version == versions[locked.id]
    got = client.get(f"{API}/cases/{locked.id}", headers=h).json()["patient"]
    assert got["nombre"] == "Antes" and got["registro"] == "EXP-SNAP"


# --- delete guards -------------------------------------------------------------------------

def test_delete_patient_is_admin_only_and_needs_no_cases(client, anest, admin,
                                                         patient_factory, case_factory, db):
    user, h = anest
    _, ha = admin
    busy = patient_factory().id
    case_factory(user_id=user.id, patient_id=busy)
    empty, empty2 = patient_factory().id, patient_factory().id

    assert client.delete(f"{API}/patients/{empty}", headers=h).status_code == 403
    assert client.delete(f"{A}/patients/{empty}", headers=h).status_code == 403
    for url in (f"{API}/patients/{busy}", f"{A}/patients/{busy}"):
        resp = client.delete(url, headers=ha)
        assert resp.status_code == 409 and "cases" in resp.json()["detail"]
    assert client.delete(f"{API}/patients/{empty}", headers=ha).status_code == 204
    assert client.delete(f"{A}/patients/{empty2}", headers=ha).status_code == 204
    assert client.delete(f"{A}/patients/{MISSING}", headers=ha).status_code == 404
    db.expire_all()
    assert db.get(PatientModel, busy) is not None
    assert db.get(PatientModel, empty) is None and db.get(PatientModel, empty2) is None


# --- admin views + case summaries ----------------------------------------------------------

def test_admin_patient_list_case_filter_and_stats(client, anest, admin, patient_factory,
                                                  case_factory):
    user, h = anest
    _, ha = admin
    p1 = patient_factory(registro="EXP-ADM-1", nombre="Paciente Admin Uno")
    p2 = patient_factory(registro="EXP-ADM-2", nombre="Paciente Admin Dos")
    c1 = case_factory(user_id=user.id, patient_id=p1.id)
    c2 = case_factory(user_id=user.id, patient_id=p1.id)
    c3 = case_factory(user_id=user.id, patient_id=p2.id)

    page = client.get(f"{A}/patients", params={"q": "admin"}, headers=ha).json()
    assert page["total"] == 2
    assert {i["id"]: i["cases_count"] for i in page["items"]} == {p1.id: 2, p2.id: 1}

    rows = client.get(f"{A}/cases", params={"patient_id": p1.id}, headers=ha).json()
    assert rows["total"] == 2 and {r["id"] for r in rows["items"]} == {c1.id, c2.id}
    assert {(r["patient_id"], r["patient_nombre"], r["patient_registro"])
            for r in rows["items"]} == {(p1.id, "Paciente Admin Uno", "EXP-ADM-1")}
    by_q = client.get(f"{A}/cases", params={"q": "exp-adm-2"}, headers=ha).json()
    assert [r["id"] for r in by_q["items"]] == [c3.id]
    assert client.get(f"{A}/cases", params={"patient_id": "nope"},
                      headers=ha).status_code == 422

    stats = client.get(f"{A}/stats", headers=ha).json()
    assert stats["patients_total"] == 2 and stats["cases_total"] == 3

    own = client.get(f"{API}/cases", headers=h).json()
    assert {r["patient_id"] for r in own} == {p1.id, p2.id}
    assert all(r["patient_registro"] in ("EXP-ADM-1", "EXP-ADM-2") for r in own)


def test_case_summaries_carry_the_snapshot_registro(client, anest, admin, patient_factory,
                                                   case_factory):
    """A legacy patient without a registro: the admin list falls back to the case's own
    snapshot registro (``registro``), like ``nombre`` falls back to the snapshot name."""
    user, h = anest
    _, ha = admin
    legacy = patient_factory(registro="", nombre="Paciente Legado")
    c = case_factory(user_id=user.id, patient_id=legacy.id,
                     patient={"nombre": "Paciente Legado", "registro": "LEG-SNAP-9"})
    bare = case_factory(user_id=user.id, patient_id=legacy.id)
    rows = {r["id"]: r for r in client.get(f"{A}/cases", params={"patient_id": legacy.id},
                                           headers=ha).json()["items"]}
    assert (rows[c.id]["patient_registro"], rows[c.id]["registro"]) == ("", "LEG-SNAP-9")
    assert rows[bare.id]["registro"] == ""
    own = {r["id"]: r for r in client.get(f"{API}/cases", headers=h).json()}
    assert own[c.id]["registro"] == "LEG-SNAP-9"


def test_deleting_the_creator_keeps_the_patient(client, admin, user_factory, auth_headers, db):
    """patients.created_by/updated_by are ON DELETE SET NULL: a user without cases can still be
    deleted after creating patients."""
    _, ha = admin
    creator = user_factory(username="creadora")
    pid = _create(client, auth_headers(creator)).json()["id"]
    assert client.delete(f"{A}/users/{creator.id}", headers=ha).status_code == 204
    got = client.get(f"{API}/patients/{pid}", headers=ha).json()
    assert got["created_by"] is None and got["updated_by"] is None


# --- the patient owns the identity of every draft (review must-fix) --------------------------

def test_owner_write_cannot_change_the_identity(client, anest, patient_factory, new_case):
    _, h = anest
    p = patient_factory(registro="EXP-OWN", nombre="Paciente Propio", sexo="female",
                        grupo_sanguineo="B", rh="+")
    case = new_case(h, patient_id=p.id)
    cid = case["id"]

    child = client.put(f"{API}/cases/{cid}/patient", headers=h, json={
        **case["patient"], "registro": "ZZZ", "nombre": "Otro", "grupo_sanguineo": "AB",
        "rh": "-", "hb": 12.5, "profile": {**case["patient"]["profile"], "gender": "male",
                                           "weight": 77}})
    assert child.status_code == 200, child.text
    pt = child.json()
    assert (pt["registro"], pt["nombre"], pt["grupo_sanguineo"], pt["rh"],
            pt["profile"]["gender"]) == ("EXP-OWN", "Paciente Propio", "B", "+", "female")
    # per-encounter values are the client's
    assert pt["hb"] == 12.5 and pt["profile"]["weight"] == 77

    full = client.put(f"{API}/cases/{cid}", headers=h, json={
        **case, "patient": {**case["patient"], "registro": "ZZZ", "nombre": ""}})
    assert full.status_code == 200, full.text
    assert (full.json()["patient"]["registro"], full.json()["patient"]["nombre"]) == (
        "EXP-OWN", "Paciente Propio")


def test_stale_full_put_after_patient_patch_keeps_the_new_identity(client, anest, colleague,
                                                                   patient_factory, new_case):
    _, h = anest
    _, hc = colleague
    p = patient_factory(registro="EXP-STALE", nombre="Nombre Viejo")
    stale = new_case(h, patient_id=p.id)  # the owner's copy, read before the edit
    assert stale["patient"]["nombre"] == "Nombre Viejo"

    assert client.patch(f"{API}/patients/{p.id}", headers=hc,
                        json={"nombre": "Nombre Nuevo"}).status_code == 200
    resp = client.put(f"{API}/cases/{stale['id']}", headers=h,
                      json={**stale, "sala": "3"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["patient"]["nombre"] == "Nombre Nuevo"
    assert resp.json()["sala"] == "3"
    got = client.get(f"{API}/cases/{stale['id']}", headers=h).json()
    assert got["patient"]["nombre"] == "Nombre Nuevo"


def test_finalize_and_reopen_resync_a_stale_snapshot(client, anest, admin, patient_factory,
                                                     case_factory, db):
    user, h = anest
    _, ha = admin
    p = patient_factory(registro="EXP-FIN", nombre="Identidad Actual")
    # a draft whose stored snapshot diverged (e.g. written before this rule existed)
    m = case_factory(user_id=user.id, patient_id=p.id,
                     patient={"nombre": "Vieja", "registro": "VIEJO"})
    resp = client.post(f"{API}/cases/{m.id}/finalize", headers=h)
    assert resp.status_code == 200, resp.text
    assert (resp.json()["patient"]["nombre"], resp.json()["patient"]["registro"]) == (
        "Identidad Actual", "EXP-FIN")

    # edited while locked: the finalized case keeps its snapshot, reopen re-syncs it
    assert client.patch(f"{API}/patients/{p.id}", headers=h,
                        json={"nombre": "Tras Reabrir"}).status_code == 200
    assert client.get(f"{API}/cases/{m.id}",
                      headers=h).json()["patient"]["nombre"] == "Identidad Actual"
    reopened = client.post(f"{A}/cases/{m.id}/reopen", headers=ha)
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["patient"]["nombre"] == "Tras Reabrir"
    db.expire_all()
    assert db.get(CaseModel, m.id).data["patient"]["nombre"] == "Tras Reabrir"
