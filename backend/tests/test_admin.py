"""Increment 4: the admin API (/admin/users, /admin/cases, /admin/documents, /admin/stats).

All data synthetic. Stored documents live in the per-test ``tmp_path`` root (conftest).
"""
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.application.admin_service import (
    LAST_ADMIN_DETAIL,
    SELF_GUARD_DETAIL,
    AdminService,
    day_start,
)
from app.application.case_service import CaseService
from app.application.identity import CurrentUser
from app.infrastructure.models import CaseModel, DocumentModel, UserModel
from app.infrastructure.repository import (
    SqlCaseRepository,
    SqlDocumentRepository,
    SqlUserRepository,
)

from .conftest import TEST_PASSWORD

API = "/api/v1"
A = f"{API}/admin"
SOME_ID = "51111111-2222-4333-8444-555555555555"


@pytest.fixture
def admin(admin_user, auth_headers):
    return admin_user, auth_headers(admin_user)


@pytest.fixture
def anest(anesthesiologist, auth_headers):
    return anesthesiologist, auth_headers(anesthesiologist)


def _login(client, username, password):
    return client.post(f"{API}/auth/login", json={"username": username, "password": password})


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


# --- 403 matrix ------------------------------------------------------------------------------

ADMIN_ROUTES = [
    ("get", "/users", None),
    ("post", "/users", {"username": "nuevo", "password": "Sint3tico-pass"}),
    ("get", "/users/{uid}", None),
    ("patch", "/users/{uid}", {"full_name": "X"}),
    ("post", "/users/{uid}/reset-password", {"password": "Otra-clave-1"}),
    ("delete", "/users/{uid}", None),
    ("get", "/cases", None),
    ("get", "/cases/{cid}", None),
    ("delete", "/cases/{cid}", None),
    ("post", "/cases/{cid}/reopen", None),
    ("get", "/documents", None),
    ("get", "/stats", None),
]


def _url(template: str, uid: str, cid: str) -> str:
    return A + template.format(uid=uid, cid=cid)


def test_matrix_covers_every_admin_route(client):
    spec = client.get("/openapi.json").json()
    published = {
        (method, path[len(A):].replace("{user_id}", "{uid}").replace("{case_id}", "{cid}"))
        for path, ops in spec["paths"].items() if path.startswith(A + "/")
        for method in ops
    }
    assert published == {(m, p) for m, p, _ in ADMIN_ROUTES}


@pytest.mark.parametrize("method, template, body", ADMIN_ROUTES,
                         ids=[f"{m} {p}" for m, p, _ in ADMIN_ROUTES])
def test_anesthesiologist_gets_403_on_every_admin_route(
    client, anest, admin_user, case_factory, method, template, body
):
    user, h = anest
    own = case_factory(user_id=user.id, status="finalized")
    kwargs = {"headers": h}
    if body is not None:
        kwargs["json"] = body
    # target ids that exist (their own case, the admin account): 403, not 404
    resp = getattr(client, method)(_url(template, admin_user.id, own.id), **kwargs)
    assert resp.status_code == 403, resp.text
    assert resp.json() == {"detail": "admin only"}
    # ...and without a token: 401
    kwargs.pop("headers")
    assert getattr(client, method)(_url(template, admin_user.id, own.id),
                                   **kwargs).status_code == 401
    # nothing changed
    assert client.get(f"{API}/cases/{own.id}", headers=h).json()["status"] == "finalized"


def test_gateway_user_is_forbidden_too(client, gateway_mode, tenant_headers):
    assert client.get(f"{A}/stats", headers=tenant_headers()).status_code == 403


# --- users -----------------------------------------------------------------------------------

def test_create_user_forces_password_change_and_can_log_in(client, admin):
    _, h = admin
    resp = client.post(f"{A}/users", headers=h, json={
        "username": "Dra.Nueva", "full_name": " Dra. Nueva Sintetica ", "clave": "NUE-9",
        "role": "anesthesiologist", "password": "Temporal-123"})
    assert resp.status_code == 200, resp.text
    u = resp.json()
    assert u["username"] == "dra.nueva" and u["full_name"] == "Dra. Nueva Sintetica"
    assert u["role"] == "anesthesiologist" and u["is_active"] is True
    assert u["must_change_password"] is True
    assert "password" not in u and "password_hash" not in u

    login = _login(client, "DRA.NUEVA", "Temporal-123")
    assert login.status_code == 200 and login.json()["user"]["must_change_password"] is True
    token = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.post(f"{API}/auth/change-password", headers=token, json={
        "current_password": "Temporal-123", "new_password": "Definitiva-456"}).status_code == 204
    assert client.get(f"{A}/users/{u['id']}", headers=h).json()["must_change_password"] is False


def test_create_user_validation(client, admin):
    _, h = admin
    ok = {"username": "valido", "password": "Temporal-123"}
    assert client.post(f"{A}/users", headers=h, json=ok).status_code == 200
    assert client.post(f"{A}/users", headers=h,
                       json={**ok, "username": "VALIDO"}).status_code == 409
    for bad in ({**ok, "username": "otro", "password": "corta"},
                {**ok, "username": "con espacio"},
                {**ok, "username": "../x"},
                {**ok, "username": ""},
                {**ok, "username": "otro2", "role": "superuser"},
                {"password": "Temporal-123"}):
        assert client.post(f"{A}/users", headers=h, json=bad).status_code == 422, bad


def test_list_users_filters(client, admin, user_factory):
    _, h = admin
    user_factory(username="ana.lopez", full_name="Ana Lopez", clave="AL-1")
    user_factory(username="beto", full_name="Roberto Ruiz", clave="BR-2", is_active=False)
    user_factory(username="carla", full_name="Carla Diaz", clave="ZZ-3", role="admin")

    def names(**params):
        resp = client.get(f"{A}/users", headers=h, params=params)
        assert resp.status_code == 200, resp.text
        return [u["username"] for u in resp.json()]

    assert names() == ["admin1", "ana.lopez", "beto", "carla"]
    assert names(role="admin") == ["admin1", "carla"]
    assert names(is_active="false") == ["beto"]
    assert names(q="RUIZ") == ["beto"]          # full_name, case-insensitive
    assert names(q="zz-") == ["carla"]          # clave
    assert names(q="lo", role="anesthesiologist") == ["ana.lopez"]
    assert names(q="%") == []                   # LIKE wildcards are literal
    assert client.get(f"{A}/users", headers=h, params={"role": "x"}).status_code == 422


def test_get_and_patch_user(client, admin, user_factory):
    _, h = admin
    u = user_factory(username="editable", full_name="Viejo", clave="V-1")
    assert client.get(f"{A}/users/{uuid.uuid4()}", headers=h).status_code == 404
    got = client.get(f"{A}/users/{u.id}", headers=h).json()
    assert got["username"] == "editable"

    resp = client.patch(f"{A}/users/{u.id}", headers=h,
                        json={"full_name": "Nuevo Nombre", "clave": "N-2"})
    assert resp.status_code == 200
    assert (resp.json()["full_name"], resp.json()["clave"]) == ("Nuevo Nombre", "N-2")
    assert resp.json()["role"] == "anesthesiologist"

    promoted = client.patch(f"{A}/users/{u.id}", headers=h, json={"role": "admin"}).json()
    assert promoted["role"] == "admin"
    for bad in ({"role": None}, {"is_active": None}, {"role": "root"}, {"full_name": None}):
        assert client.patch(f"{A}/users/{u.id}", headers=h, json=bad).status_code == 422, bad
    assert client.patch(f"{A}/users/{uuid.uuid4()}", headers=h,
                        json={"clave": "x"}).status_code == 404


def test_demotion_takes_effect_on_the_next_request(client, admin, user_factory, auth_headers):
    _, h = admin
    other_admin = user_factory(username="admin2", role="admin")
    h2 = auth_headers(other_admin)
    assert client.get(f"{A}/stats", headers=h2).status_code == 200
    assert client.patch(f"{A}/users/{other_admin.id}", headers=h,
                        json={"role": "anesthesiologist"}).status_code == 200
    assert client.get(f"{A}/stats", headers=h2).status_code == 403


def test_deactivate_user_cuts_access(client, admin, anest):
    _, h = admin
    user, uh = anest
    assert client.get(f"{API}/cases", headers=uh).status_code == 200
    resp = client.patch(f"{A}/users/{user.id}", headers=h, json={"is_active": False})
    assert resp.status_code == 200 and resp.json()["is_active"] is False
    assert client.get(f"{API}/cases", headers=uh).status_code == 401
    assert _login(client, user.username, TEST_PASSWORD).status_code == 401
    client.patch(f"{A}/users/{user.id}", headers=h, json={"is_active": True})
    assert _login(client, user.username, TEST_PASSWORD).status_code == 200


def test_reset_password(client, admin, anest):
    _, h = admin
    user, _ = anest
    assert _login(client, user.username, TEST_PASSWORD).status_code == 200
    resp = client.post(f"{A}/users/{user.id}/reset-password", headers=h,
                       json={"password": "Reiniciada-789"})
    assert resp.status_code == 204 and resp.content == b""
    assert _login(client, user.username, TEST_PASSWORD).status_code == 401
    login = _login(client, user.username, "Reiniciada-789")
    assert login.status_code == 200
    assert login.json()["user"]["must_change_password"] is True
    assert client.post(f"{A}/users/{user.id}/reset-password", headers=h,
                       json={"password": "corta"}).status_code == 422
    assert client.post(f"{A}/users/{uuid.uuid4()}/reset-password", headers=h,
                       json={"password": "Reiniciada-789"}).status_code == 404


@pytest.mark.parametrize("method, path_suffix, body", [
    ("delete", "", None),
    ("patch", "", {"is_active": False}),
    ("patch", "", {"role": "anesthesiologist"}),
], ids=["self-delete", "self-deactivate", "self-demote"])
def test_admin_cannot_remove_themself(client, admin, user_factory, method, path_suffix, body):
    me, h = admin
    user_factory(username="admin2", role="admin")  # not the last admin: the SELF guard fires
    kwargs = {"headers": h} if body is None else {"headers": h, "json": body}
    resp = getattr(client, method)(f"{A}/users/{me.id}{path_suffix}", **kwargs)
    assert resp.status_code == 409
    assert resp.json() == {"detail": SELF_GUARD_DETAIL}
    got = client.get(f"{A}/users/{me.id}", headers=h).json()
    assert (got["role"], got["is_active"]) == ("admin", True)


def test_self_edit_of_harmless_fields_is_allowed(client, admin):
    me, h = admin
    resp = client.patch(f"{A}/users/{me.id}", headers=h,
                        json={"full_name": "Admin Renombrado", "role": "admin", "is_active": True})
    assert resp.status_code == 200 and resp.json()["full_name"] == "Admin Renombrado"


def _admin_service(db, acting: UserModel) -> AdminService:
    cu = CurrentUser(id=acting.id, role="admin", username=acting.username)
    return AdminService(cu, SqlUserRepository(db),
                        CaseService(SqlCaseRepository(db), cu, SqlDocumentRepository(db)),
                        SqlDocumentRepository(db))


@pytest.mark.parametrize("action", ["delete", "deactivate", "demote"])
def test_last_active_admin_is_protected(db, user_factory, action):
    """The acting admin's request was authorised, then they lost admin rights (a concurrent
    demotion committed). The target is now the LAST active admin: 409, and nothing changes."""
    acting = user_factory(username="admin_a", role="admin")
    last = user_factory(username="admin_b", role="admin")
    user_factory(username="admin_c", role="admin", is_active=False)  # inactive: doesn't count
    acting.role = "anesthesiologist"
    db.commit()

    svc = _admin_service(db, acting)
    from app.application import dto
    with pytest.raises(HTTPException) as exc:
        if action == "delete":
            svc.delete_user(last.id)
        elif action == "deactivate":
            svc.update_user(last.id, dto.AdminUserUpdate(is_active=False))
        else:
            svc.update_user(last.id, dto.AdminUserUpdate(role="anesthesiologist"))
    assert exc.value.status_code == 409 and exc.value.detail == LAST_ADMIN_DETAIL
    db.expire_all()
    row = db.get(UserModel, last.id)
    assert row is not None and (row.role, row.is_active) == ("admin", True)


def test_other_admin_can_be_removed_while_another_remains(client, admin, user_factory):
    _, h = admin
    b = user_factory(username="admin_b", role="admin")
    c = user_factory(username="admin_c", role="admin")
    assert client.patch(f"{A}/users/{b.id}", headers=h,
                        json={"role": "anesthesiologist"}).status_code == 200
    assert client.patch(f"{A}/users/{c.id}", headers=h,
                        json={"is_active": False}).status_code == 200
    assert client.delete(f"{A}/users/{c.id}", headers=h).status_code == 204


def test_delete_user(client, admin, anest, user_factory, case_factory, db):
    au, h = admin
    user, uh = anest
    cid = case_factory(user_id=user.id).id
    resp = client.delete(f"{A}/users/{user.id}", headers=h)
    assert resp.status_code == 409 and "deactivate" in resp.json()["detail"]
    assert client.get(f"{A}/users/{user.id}", headers=h).status_code == 200

    # a user with no cases is hard-deleted; documents they generated keep existing (SET NULL)
    helper = user_factory(username="admin_helper", role="admin")
    helper_doc = client.post(f"{API}/cases/{cid}/documents", headers=_bearer(helper),
                             json={"form_id": "nota_postanestesica"}).json()
    assert helper_doc["generated_by"] == helper.id
    assert client.delete(f"{A}/users/{helper.id}", headers=h).status_code == 204
    assert client.get(f"{A}/users/{helper.id}", headers=h).status_code == 404
    assert client.delete(f"{A}/users/{helper.id}", headers=h).status_code == 404
    db.expire_all()
    assert db.get(DocumentModel, helper_doc["id"]).generated_by is None
    assert _login(client, "admin_helper", TEST_PASSWORD).status_code == 401


def _bearer(user):
    from app.core import security
    return {"Authorization": f"Bearer {security.create_access_token(user.id, user.role).access_token}"}


# --- cases -----------------------------------------------------------------------------------

@pytest.fixture
def seeded_cases(db, user_factory, case_factory):
    """8 cases across two anesthesiologists, one per day going back from today (UTC noon)."""
    ana = user_factory(username="ana", full_name="Ana Sintetica")
    beto = user_factory(username="beto", full_name="Beto Sintetico")
    today = datetime.now(timezone.utc).date()
    specs = [  # (owner, status, patient, days ago)
        (ana, "draft", "Paciente Uno", 0),
        (ana, "finalized", "Paciente Dos", 1),
        (beto, "draft", "Paciente Tres", 2),
        (ana, "draft", "Paciente Cuatro", 3),
        (beto, "finalized", "Paciente 100% Cinco", 4),
        (beto, "draft", "Paciente Seis", 5),
        (ana, "finalized", "Paciente Siete", 6),
        (beto, "draft", "Paciente Ocho", 7),
    ]
    rows = []
    for owner, status, nombre, ago in specs:
        m = case_factory(user_id=owner.id, status=status, nombre=nombre,
                         diagnostico_preop=f"dx {nombre.lower()}")
        m.created_at = day_start(today - timedelta(days=ago)) + timedelta(hours=12)
        rows.append(m)
    db.commit()
    return ana, beto, rows


def _page(client, h, **params):
    resp = client.get(f"{A}/cases", headers=h, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_admin_case_list_filters_pagination_total(client, admin, seeded_cases):
    _, h = admin
    ana, beto, rows = seeded_cases
    ids = [m.id for m in rows]  # already newest first

    page = _page(client, h)
    assert page["total"] == 8 and [c["id"] for c in page["items"]] == ids
    assert (page["limit"], page["offset"]) == (50, 0)
    assert page["items"][0]["owner_name"] == "Ana Sintetica"

    # pagination: disjoint pages, stable order, the total is the filtered count
    p1, p2, p3 = (_page(client, h, limit=3, offset=o) for o in (0, 3, 6))
    assert [c["id"] for c in p1["items"] + p2["items"] + p3["items"]] == ids
    assert {p["total"] for p in (p1, p2, p3)} == {8}
    assert _page(client, h, limit=3, offset=30)["items"] == []

    assert _page(client, h, status="finalized")["total"] == 3
    drafts = _page(client, h, status="draft", user_id=beto.id)
    assert drafts["total"] == 3 and {c["user_id"] for c in drafts["items"]} == {beto.id}
    assert all(c["status"] == "draft" for c in drafts["items"])

    assert [c["nombre"] for c in _page(client, h, q="SIETE")["items"]] == ["Paciente Siete"]
    assert _page(client, h, q="100%")["total"] == 1           # literal %, not a wildcard
    assert _page(client, h, q="beto sint")["total"] == 4      # owner full name
    assert _page(client, h, q="dx paciente tres")["total"] == 1  # diagnosis
    assert _page(client, h, q=ids[3][:8])["items"][0]["id"] == ids[3]  # case id

    today = datetime.now(timezone.utc).date()
    ranged = _page(client, h, date_from=str(today - timedelta(days=3)),
                   date_to=str(today - timedelta(days=1)))
    assert [c["id"] for c in ranged["items"]] == ids[1:4]      # both ends inclusive
    assert _page(client, h, date_from=str(today))["total"] == 1
    assert _page(client, h, date_to=str(today - timedelta(days=7)))["total"] == 1
    combined = _page(client, h, status="draft", date_from=str(today - timedelta(days=5)),
                     limit=2)
    assert combined["total"] == 4 and len(combined["items"]) == 2

    for bad in ({"limit": 0}, {"limit": 201}, {"offset": -1}, {"status": "open"},
                {"date_from": "not-a-date"},
                {"date_from": str(today), "date_to": str(today - timedelta(days=1))}):
        assert client.get(f"{A}/cases", headers=h, params=bad).status_code == 422, bad


def test_admin_case_detail_and_404(client, admin, seeded_cases):
    _, h = admin
    _, _, rows = seeded_cases
    got = client.get(f"{A}/cases/{rows[1].id.upper()}", headers=h)
    assert got.status_code == 200 and got.json()["patient"]["nombre"] == "Paciente Dos"
    assert client.get(f"{A}/cases/{SOME_ID}", headers=h).status_code == 404
    assert client.get(f"{A}/cases/not-a-uuid", headers=h).status_code == 422


def test_admin_delete_finalized_case_removes_files(client, admin, anest, db, documents_dir):
    _, h = admin
    _, uh = anest
    cid = client.post(f"{API}/cases", json={}, headers=uh).json()["id"]
    assert client.post(f"{API}/cases/{cid}/finalize", headers=uh).status_code == 200
    assert len(_files(documents_dir)) == 4

    assert client.delete(f"{A}/cases/{cid}", headers=h).status_code == 204
    assert _files(documents_dir) == []
    db.expire_all()
    assert db.get(CaseModel, cid) is None
    assert SqlDocumentRepository(db).list_for_case(cid) == []
    assert client.get(f"{API}/cases/{cid}", headers=uh).status_code == 404
    assert client.delete(f"{A}/cases/{cid}", headers=h).status_code == 404


def test_admin_reopen_then_owner_can_edit(client, admin, anest):
    _, h = admin
    _, uh = anest
    cid = client.post(f"{API}/cases", json={}, headers=uh).json()["id"]
    assert client.post(f"{A}/cases/{cid}/reopen", headers=h).status_code == 409  # a draft
    client.post(f"{API}/cases/{cid}/finalize", headers=uh)
    assert client.patch(f"{API}/cases/{cid}", json={"sala": "4"}, headers=uh).status_code == 409

    resp = client.post(f"{A}/cases/{cid}/reopen", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "draft" and resp.json()["finalized_at"] is None

    edited = client.patch(f"{API}/cases/{cid}", json={"sala": "4"}, headers=uh)
    assert edited.status_code == 200 and edited.json()["sala"] == "4"
    # documents from the first finalize are kept; a second finalize adds four more
    assert len(client.get(f"{API}/cases/{cid}/documents", headers=uh).json()) == 4
    assert client.post(f"{API}/cases/{cid}/finalize", headers=uh).status_code == 200
    assert len(client.get(f"{API}/cases/{cid}/documents", headers=uh).json()) == 8
    assert client.post(f"{A}/cases/{SOME_ID}/reopen", headers=h).status_code == 404


def test_admin_cannot_edit_case_content(client, admin, anest):
    """Admin on cases = view + PDFs + delete + reopen; editing stays 403 on /cases."""
    _, h = admin
    _, uh = anest
    cid = client.post(f"{API}/cases", json={}, headers=uh).json()["id"]
    assert client.patch(f"{API}/cases/{cid}", json={"sala": "9"}, headers=h).status_code == 403
    spec = client.get("/openapi.json").json()
    admin_case_methods = {m for p, ops in spec["paths"].items()
                          if p.startswith(f"{A}/cases/") for m in ops}
    assert not admin_case_methods & {"put", "patch"}


# --- documents -------------------------------------------------------------------------------

def test_admin_documents_index(client, admin, anest, user_factory, auth_headers, documents_dir):
    _, h = admin
    _, uh = anest
    other = user_factory(username="otra")
    oh = auth_headers(other)
    c1 = client.post(f"{API}/cases", json={}, headers=uh).json()["id"]
    c2 = client.post(f"{API}/cases", json={}, headers=oh).json()["id"]
    client.post(f"{API}/cases/{c1}/finalize", headers=uh)                        # 4 docs
    extra = client.post(f"{API}/cases/{c2}/documents", headers=oh,
                        json={"form_id": "nota_postanestesica"}).json()           # 1 doc

    page = client.get(f"{A}/documents", headers=h).json()
    assert page["total"] == 5 and len(page["items"]) == 5
    newest = page["items"][0]
    assert newest["id"] == extra["id"]
    assert Path(newest["storage_path"]).is_absolute()
    assert Path(newest["storage_path"]).parent == documents_dir / c2
    stamps = [d["created_at"] for d in page["items"]]
    assert stamps == sorted(stamps, reverse=True)

    assert client.get(f"{A}/documents", headers=h, params={"case_id": c1}).json()["total"] == 4
    by_form = client.get(f"{A}/documents", headers=h,
                         params={"form_id": "nota_postanestesica"}).json()
    assert by_form["total"] == 2 and {d["case_id"] for d in by_form["items"]} == {c1, c2}
    p = client.get(f"{A}/documents", headers=h, params={"limit": 2, "offset": 4}).json()
    assert p["total"] == 5 and len(p["items"]) == 1
    assert client.get(f"{A}/documents", headers=h,
                      params={"form_id": "../x"}).status_code == 422
    assert client.get(f"{A}/documents", headers=h,
                      params={"case_id": "nope"}).status_code == 422
    # the admin downloads any of them through the shared route
    dl = client.get(newest["download_url"], headers=h)
    assert dl.status_code == 200 and dl.content.startswith(b"%PDF-")


# --- stats -----------------------------------------------------------------------------------

def test_admin_stats_on_seeded_dataset(client, admin, db, user_factory, case_factory):
    _, h = admin
    today = datetime.now(timezone.utc).date()
    ana = user_factory(username="ana", full_name="Ana Sintetica")
    beto = user_factory(username="beto", full_name="Beto Sintetico")
    user_factory(username="carla", full_name="Carla Sin Casos")        # anesthesiologist, 0 cases
    user_factory(username="admin9", role="admin")                       # admin, 0 cases: excluded

    seed = [  # (owner, status, days ago)
        (ana, "draft", 0), (ana, "draft", 0), (ana, "finalized", 1),
        (beto, "finalized", 1), (beto, "draft", 29),
        (beto, "draft", 30), (ana, "finalized", 45),                   # outside the 30-day window
    ]
    rows = []
    for owner, status, ago in seed:
        m = case_factory(user_id=owner.id, status=status)
        stamp = day_start(today - timedelta(days=ago)) + timedelta(hours=10)
        m.created_at = stamp
        m.updated_at = stamp
        rows.append(m)
    db.commit()
    for i, m in enumerate(rows[:3]):                                    # 3 documents
        db.add(DocumentModel(id=str(uuid.uuid4()), case_id=m.id, form_id="nota_postanestesica",
                             storage_path=f"/nonexistent/{i}.pdf", size_bytes=1, sha256="0" * 64,
                             generated_by=ana.id, created_at=datetime.now(timezone.utc)))
    db.commit()

    resp = client.get(f"{A}/stats", headers=h)
    assert resp.status_code == 200, resp.text
    s = resp.json()
    assert s["cases_total"] == 7
    assert s["cases_by_status"] == {"draft": 4, "finalized": 3}
    assert s["documents_total"] == 3

    series = s["cases_per_day"]
    assert len(series) == 30
    assert series[-1]["date"] == str(today)
    assert series[0]["date"] == str(today - timedelta(days=29))
    assert [d["date"] for d in series] == sorted(d["date"] for d in series)
    counts = {d["date"]: d["count"] for d in series}
    assert counts[str(today)] == 2
    assert counts[str(today - timedelta(days=1))] == 2
    assert counts[str(today - timedelta(days=29))] == 1
    assert sum(counts.values()) == 5                                    # zero-filled elsewhere
    assert Counter(counts.values())[0] == 27

    per_user = {u["username"]: u for u in s["per_user"]}
    assert set(per_user) == {"ana", "beto", "carla"}
    assert (per_user["ana"]["drafts"], per_user["ana"]["finalized"]) == (2, 2)
    assert (per_user["beto"]["drafts"], per_user["beto"]["finalized"]) == (2, 1)
    assert (per_user["carla"]["drafts"], per_user["carla"]["finalized"]) == (0, 0)
    assert per_user["carla"]["last_activity"] is None
    assert per_user["ana"]["full_name"] == "Ana Sintetica"
    last_ana = datetime.fromisoformat(per_user["ana"]["last_activity"])
    assert last_ana == day_start(today) + timedelta(hours=10)
    assert [u["username"] for u in s["per_user"]][-1] == "carla"         # most cases first


def test_admin_stats_empty_and_login_counts_as_activity(client, admin, user_factory):
    _, h = admin
    u = user_factory(username="solo_login")
    _login(client, "solo_login", TEST_PASSWORD)
    s = client.get(f"{A}/stats", headers=h).json()
    assert s["cases_total"] == 0 and s["documents_total"] == 0
    assert s["cases_by_status"] == {"draft": 0, "finalized": 0}
    assert len(s["cases_per_day"]) == 30 and all(d["count"] == 0 for d in s["cases_per_day"])
    row = next(x for x in s["per_user"] if x["user_id"] == u.id)
    assert row["last_activity"] is not None


# --- openapi ---------------------------------------------------------------------------------

def test_admin_routes_are_typed(client):
    spec = client.get("/openapi.json").json()
    for path, ops in spec["paths"].items():
        if not path.startswith(A + "/"):
            continue
        for method, op in ops.items():
            assert "admin" in op["tags"]
            if "204" in op["responses"]:
                continue
            schema = op["responses"]["200"]["content"]["application/json"]["schema"]
            assert schema.get("$ref") or schema.get("items", {}).get("$ref"), (method, path)
            if method in ("post", "patch") and not path.endswith("/reopen"):
                body = op["requestBody"]["content"]["application/json"]["schema"]
                assert body.get("$ref"), (method, path)
    schemas = spec["components"]["schemas"]
    assert set(schemas["AdminCasePage"]["properties"]) >= {"items", "total"}
    assert "storage_path" in schemas["AdminDocumentDTO"]["properties"]
    assert set(schemas["AdminStatsDTO"]["properties"]) == {
        "cases_total", "cases_by_status", "cases_per_day", "per_user", "documents_total"}
    assert "password" not in schemas["UserDTO"]["properties"]
    op_ids = [op["operationId"] for p in spec["paths"].values() for op in p.values()]
    assert len(op_ids) == len(set(op_ids))


# --- review fixes: unknown fields and the reserved gateway prefix -------------------------------

def test_admin_bodies_reject_unknown_fields(client, admin, anest):
    _, h = admin
    user, _ = anest
    create = client.post(f"{A}/users", headers=h, json={
        "username": "extra1", "password": "Temporal-123", "must_change_password": False})
    assert create.status_code == 422, create.text
    assert create.json()["detail"][0]["type"] == "extra_forbidden"
    assert client.post(f"{A}/users", headers=h, json={
        "username": "extra2", "password": "Temporal-123", "id": SOME_ID}).status_code == 422
    for bad in ({"username": "renombrado"}, {"password_hash": "x"}, {"full_name": "Ok", "x": 1}):
        assert client.patch(f"{A}/users/{user.id}", headers=h, json=bad).status_code == 422, bad
    assert client.post(f"{A}/users/{user.id}/reset-password", headers=h, json={
        "password": "Reiniciada-789", "must_change_password": False}).status_code == 422
    got = client.get(f"{A}/users/{user.id}", headers=h).json()
    assert got["username"] == user.username and got["must_change_password"] is False
    assert _login(client, user.username, TEST_PASSWORD).status_code == 200  # not reset


@pytest.mark.parametrize("username", ["gw-nuevo", "GW-Nuevo", "gw-51111111"])
def test_create_user_rejects_gateway_prefix(client, admin, username):
    _, h = admin
    resp = client.post(f"{A}/users", headers=h,
                       json={"username": username, "password": "Temporal-123"})
    assert resp.status_code == 422, resp.text
    assert "reserved" in resp.text
    assert client.post(f"{A}/users", headers=h, json={
        "username": "gwx-ok", "password": "Temporal-123"}).status_code == 200
