"""Increment 2: accounts, login, JWT verification, auth modes, admin bootstrap."""
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app import cli
from app import main as app_main
from app.core import security
from app.core.config import settings
from app.infrastructure.models import UserModel

from .conftest import TEST_PASSWORD


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _login(client, username, password=TEST_PASSWORD):
    return client.post("/api/v1/auth/login", json={"username": username, "password": password})


# --- login -------------------------------------------------------------------------------

def test_login_ok_returns_token_and_user(client, anesthesiologist):
    before = datetime.now(timezone.utc)
    resp = _login(client, "anest1")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    ttl = timedelta(minutes=settings.jwt_ttl_minutes)
    assert before + ttl - timedelta(seconds=5) <= _ts(body["expires_at"]) <= before + ttl + timedelta(seconds=5)
    user = body["user"]
    assert user["id"] == anesthesiologist.id
    assert user["username"] == "anest1"
    assert user["role"] == "anesthesiologist"
    assert user["full_name"] == "Dra. Ana Sintetica" and user["clave"] == "ANE-111"
    assert user["is_active"] is True and user["must_change_password"] is False
    assert user["last_login_at"] is not None
    assert "password" not in str(body).lower().replace("must_change_password", "")

    claims = jwt.decode(body["access_token"], settings.jwt_secret, algorithms=["HS256"])
    assert claims["sub"] == anesthesiologist.id and claims["role"] == "anesthesiologist"
    assert {"iat", "exp"} <= set(claims)

    me = client.get("/api/v1/auth/me",
                    headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200, me.text
    assert me.json()["id"] == anesthesiologist.id


@pytest.mark.parametrize("username", ["ANEST1", "Anest1", "  anest1 "])
def test_login_username_is_case_insensitive(client, anesthesiologist, username):
    resp = _login(client, username)
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["id"] == anesthesiologist.id


@pytest.mark.parametrize(
    "username,password",
    [("anest1", "wrong-password"), ("nobody", TEST_PASSWORD), ("anest1", TEST_PASSWORD.upper())],
)
def test_login_bad_credentials_401(client, anesthesiologist, username, password):
    resp = _login(client, username, password)
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid username or password"


def test_login_inactive_user_401(client, user_factory):
    user_factory(username="inactivo", is_active=False)
    resp = _login(client, "inactivo")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid username or password"


def test_gateway_jit_user_cannot_log_in_locally(client, gateway_mode, tenant_headers, db):
    headers = tenant_headers()
    assert client.post("/api/v1/cases", json={}, headers=headers).status_code == 200
    jit = db.get(UserModel, headers["X-User-Id"])
    assert jit.password_hash == security.UNUSABLE_PASSWORD
    gateway_mode.auth_mode = "local"  # login is disabled in gateway mode (restored after)
    for pw in ["!", "", TEST_PASSWORD]:
        assert _login(client, jit.username, pw or "x").status_code == 401


def test_login_validation_422(client):
    assert client.post("/api/v1/auth/login", json={"username": "a"}).status_code == 422


# --- token verification ------------------------------------------------------------------

def test_no_token_401_in_local_mode(client, anesthesiologist):
    for method, path in [("get", "/api/v1/cases"), ("post", "/api/v1/cases"),
                         ("get", "/api/v1/auth/me")]:
        resp = getattr(client, method)(path)
        assert resp.status_code == 401, (method, path)
        assert resp.headers.get("www-authenticate") == "Bearer"


def test_gateway_headers_ignored_in_local_mode(client, tenant_headers):
    assert client.get("/api/v1/cases", headers=tenant_headers()).status_code == 401


def test_expired_token_401(client, anesthesiologist):
    past = datetime.now(timezone.utc) - timedelta(minutes=settings.jwt_ttl_minutes + 1)
    token = security.create_access_token(anesthesiologist.id, "anesthesiologist", now=past)
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token.access_token}"})
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Invalid or expired token"


def _tampered_tokens(user_id: str) -> list[str]:
    good = security.create_access_token(user_id, "anesthesiologist").access_token
    head, payload, sig = good.split(".")
    flipped = sig[:-2] + ("AA" if sig[-2:] != "AA" else "BB")
    now = datetime.now(timezone.utc)
    claims = {"sub": user_id, "role": "admin", "iat": now, "exp": now + timedelta(hours=1)}
    other_secret = jwt.encode(claims, "another-secret-" + "y" * 40, algorithm="HS256")
    forged_payload = jwt.encode(claims, "irrelevant-" + "z" * 40, algorithm="HS256").split(".")[1]
    unsigned = jwt.encode(claims, None, algorithm="none")
    no_exp = jwt.encode({"sub": user_id, "iat": now}, settings.jwt_secret, algorithm="HS256")
    return [f"{head}.{payload}.{flipped}", other_secret, f"{head}.{forged_payload}.{sig}",
            unsigned, no_exp, "not-a-jwt"]


def test_tampered_token_401(client, anesthesiologist):
    for token in _tampered_tokens(anesthesiologist.id):
        resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401, token


def test_token_for_deleted_or_deactivated_user_401(client, anesthesiologist, auth_headers, db):
    headers = auth_headers(anesthesiologist)
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    anesthesiologist.is_active = False
    db.commit()
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_role_comes_from_db_not_token(client, anesthesiologist, case_factory):
    token = security.create_access_token(anesthesiologist.id, "admin").access_token
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=headers).json()["role"] == "anesthesiologist"
    # an anesthesiologist holding an "admin"-role token still cannot read others' cases
    foreign = case_factory(user_id="other-tenant")
    assert client.get("/api/v1/cases", headers=headers).json() == []
    assert client.get(f"/api/v1/cases/{foreign.id}", headers=headers).status_code == 404


def test_token_refused_without_secret(monkeypatch, anesthesiologist, client, auth_headers):
    headers = auth_headers(anesthesiologist)
    monkeypatch.setattr(settings, "jwt_secret", "")
    with pytest.raises(security.JWTSecretMissing):
        security.create_access_token(anesthesiologist.id, "anesthesiologist")
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    with pytest.raises(RuntimeError, match="TIVA_JWT_SECRET"):
        app_main.check_auth_config()
    monkeypatch.setattr(settings, "auth_mode", "gateway")
    app_main.check_auth_config()  # gateway mode needs no secret


# --- gateway mode ------------------------------------------------------------------------

def test_gateway_mode_x_user_id_still_works(client, gateway_mode, tenant_headers, db):
    a, b = tenant_headers(), tenant_headers()
    case = client.post("/api/v1/cases", json={"owner": "gw"}, headers=a)
    assert case.status_code == 200, case.text
    cid = case.json()["id"]
    assert case.json()["user_id"] == a["X-User-Id"]
    assert client.get(f"/api/v1/cases/{cid}", headers=a).status_code == 200
    assert client.get(f"/api/v1/cases/{cid}", headers=b).status_code == 404
    assert [c["id"] for c in client.get("/api/v1/cases", headers=b).json()] == []
    jit = db.get(UserModel, a["X-User-Id"])
    assert jit is not None and jit.role == "anesthesiologist"
    me = client.get("/api/v1/auth/me", headers=a).json()
    assert me["id"] == a["X-User-Id"]


def test_gateway_guest_scopes_to_parent(client, gateway_mode, tenant_headers):
    parent = tenant_headers()
    cid = client.post("/api/v1/cases", json={}, headers=parent).json()["id"]
    guest = {"X-User-Id": "guest-1", "X-User-Role": "guest",
             "X-User-Created-By": parent["X-User-Id"]}
    assert client.get(f"/api/v1/cases/{cid}", headers=guest).status_code == 200


def test_gateway_rejects_oversized_identity(client, gateway_mode):
    resp = client.get("/api/v1/cases", headers={"X-User-Id": "x" * 37})
    assert resp.status_code == 401


# --- change password ---------------------------------------------------------------------

def test_change_password(client, user_factory, auth_headers, db):
    user = user_factory(username="cambia", must_change_password=True)
    headers = auth_headers(user)
    url = "/api/v1/auth/change-password"

    wrong = client.post(url, json={"current_password": "nope-nope", "new_password": "NuevaClave9"},
                        headers=headers)
    assert wrong.status_code == 400
    short = client.post(url, json={"current_password": TEST_PASSWORD, "new_password": "short7!"},
                        headers=headers)
    assert short.status_code == 422
    assert client.post(url, json={"current_password": TEST_PASSWORD,
                                  "new_password": "NuevaClave9"}).status_code == 401

    ok = client.post(url, json={"current_password": TEST_PASSWORD, "new_password": "NuevaClave9"},
                     headers=headers)
    assert ok.status_code == 204, ok.text
    assert ok.content == b""
    db.expire_all()
    assert db.get(UserModel, user.id).must_change_password is False
    assert _login(client, "cambia").status_code == 401
    assert _login(client, "cambia", "NuevaClave9").status_code == 200


# --- bootstrap ---------------------------------------------------------------------------

def test_cli_create_admin_is_idempotent(client, db, capsys):
    assert cli.main(["create-admin", "--username", "Root", "--password", "Primera-Clave1",
                     "--full-name", "Raiz Sintetica"]) == 0
    out = capsys.readouterr().out
    assert "created" in out and "Primera-Clave1" not in out
    assert _login(client, "root", "Primera-Clave1").json()["user"]["role"] == "admin"

    # demote + deactivate, then re-run: password reset, role admin, active again
    u = db.query(UserModel).filter_by(username="root").one()
    u.role, u.is_active = "anesthesiologist", False
    db.commit()
    assert cli.main(["create-admin", "--username", "ROOT", "--password", "Segunda-Clave2"]) == 0
    assert "updated" in capsys.readouterr().out
    db.expire_all()
    u = db.query(UserModel).filter_by(username="root").one()
    assert (u.role, u.is_active, u.full_name) == ("admin", True, "Raiz Sintetica")
    assert db.query(UserModel).count() == 1
    assert _login(client, "root", "Primera-Clave1").status_code == 401
    assert _login(client, "root", "Segunda-Clave2").status_code == 200


def test_cli_rejects_short_password(db, capsys):
    assert cli.main(["create-admin", "--username", "x", "--password", "short"]) == 2
    assert db.query(UserModel).count() == 0


def test_env_bootstrap_admin_creates_once(monkeypatch, client, db):
    monkeypatch.setattr(settings, "bootstrap_admin_username", "seed")
    monkeypatch.setattr(settings, "bootstrap_admin_password", "Seed-Clave1")
    app_main.bootstrap_admin()
    assert _login(client, "seed", "Seed-Clave1").json()["user"]["role"] == "admin"
    # an existing account is never modified by the env seed
    monkeypatch.setattr(settings, "bootstrap_admin_password", "Otra-Clave2")
    app_main.bootstrap_admin()
    assert _login(client, "seed", "Seed-Clave1").status_code == 200
    assert _login(client, "seed", "Otra-Clave2").status_code == 401


def test_openapi_documents_auth(client):
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    assert {"/api/v1/auth/login", "/api/v1/auth/me", "/api/v1/auth/change-password"} <= set(paths)
    assert paths["/api/v1/auth/login"]["post"]["responses"]["200"]["content"][
        "application/json"]["schema"]["$ref"].endswith("/LoginResponse")
    assert "HTTPBearer" in spec["components"]["securitySchemes"]
    user = spec["components"]["schemas"]["UserDTO"]["properties"]
    assert set(user["role"]["enum"]) == {"anesthesiologist", "admin"}
    assert "password_hash" not in user
    op_ids = [op["operationId"] for p in paths.values() for op in p.values()]
    assert len(op_ids) == len(set(op_ids))


# --- token revocation on password change (review fix 1) ----------------------------------

def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _old_token(user, seconds: int = 10) -> dict[str, str]:
    """A token issued ``seconds`` ago (before any password change made by the test)."""
    past = datetime.now(timezone.utc) - timedelta(seconds=seconds)
    return _bearer(security.create_access_token(user.id, user.role, now=past).access_token)


def test_change_password_revokes_older_tokens(client, user_factory, db):
    user = user_factory(username="revoca")
    old = _old_token(user)
    assert client.get("/api/v1/auth/me", headers=old).status_code == 200
    ok = client.post("/api/v1/auth/change-password", headers=old, json={
        "current_password": TEST_PASSWORD, "new_password": "NuevaClave9"})
    assert ok.status_code == 204, ok.text
    db.expire_all()
    stamp = db.get(UserModel, user.id).password_changed_at
    assert stamp is not None

    for path in ("/api/v1/auth/me", "/api/v1/cases"):
        resp = client.get(path, headers=old)
        assert resp.status_code == 401, path
        assert resp.json() == {"detail": "Invalid or expired token"}

    # a token issued right after the change (same second) works
    login = _login(client, "revoca", "NuevaClave9")
    assert login.status_code == 200
    assert client.get("/api/v1/auth/me",
                      headers=_bearer(login.json()["access_token"])).status_code == 200
    same_second = security.create_access_token(user.id, user.role, now=stamp).access_token
    assert client.get("/api/v1/cases", headers=_bearer(same_second)).status_code == 200


def test_admin_reset_password_revokes_older_tokens(client, admin_user, user_factory,
                                                    auth_headers):
    target = user_factory(username="reseteado")
    old = _old_token(target)
    assert client.get("/api/v1/cases", headers=old).status_code == 200
    resp = client.post(f"/api/v1/admin/users/{target.id}/reset-password",
                       headers=auth_headers(admin_user), json={"password": "Reiniciada-789"})
    assert resp.status_code == 204
    assert client.get("/api/v1/auth/me", headers=old).status_code == 401
    login = _login(client, "reseteado", "Reiniciada-789")
    assert login.status_code == 200
    fresh = _bearer(login.json()["access_token"])
    assert client.get("/api/v1/auth/me", headers=fresh).status_code == 200


def test_cli_create_admin_rerun_revokes_older_tokens(client, db):
    assert cli.main(["create-admin", "--username", "root2", "--password", "Primera-Clave1"]) == 0
    admin = db.query(UserModel).filter_by(username="root2").one()
    old = _old_token(admin)
    assert cli.main(["create-admin", "--username", "root2", "--password", "Segunda-Clave2"]) == 0
    assert client.get("/api/v1/auth/me", headers=old).status_code == 401
    token = _login(client, "root2", "Segunda-Clave2").json()["access_token"]
    assert client.get("/api/v1/admin/stats", headers=_bearer(token)).status_code == 200


def test_tokens_survive_when_password_never_changed(client, anesthesiologist):
    assert anesthesiologist.password_changed_at is None
    assert client.get("/api/v1/auth/me",
                      headers=_old_token(anesthesiologist, 3600)).status_code == 200


# --- pending password change is enforced server-side (review fix 2) -----------------------

from app.main import app as _fastapi_app  # noqa: E402  (conftest already configured the env)

PENDING_ALLOWED = {("get", "/api/v1/auth/me"), ("post", "/api/v1/auth/change-password")}
_SOME_UUID = "51111111-2222-4333-8444-555555555555"


def _secured_operations() -> list[tuple[str, str]]:
    """Every operation that requires an identity (declares the HTTPBearer scheme)."""
    return sorted(
        (method, path)
        for path, ops in _fastapi_app.openapi()["paths"].items()
        for method, op in ops.items()
        if op.get("security")
    )


SECURED_OPERATIONS = _secured_operations()


def test_secured_operations_include_every_protected_area():
    paths = {p for _, p in SECURED_OPERATIONS}
    assert PENDING_ALLOWED <= set(SECURED_OPERATIONS)
    for prefix in ("/api/v1/cases", "/api/v1/documents", "/api/v1/admin"):
        assert any(p.startswith(prefix) for p in paths), prefix
    assert ("post", "/api/v1/auth/login") not in SECURED_OPERATIONS


@pytest.mark.parametrize("role", ["anesthesiologist", "admin"])
@pytest.mark.parametrize("method, path", SECURED_OPERATIONS,
                         ids=[f"{m} {p}" for m, p in SECURED_OPERATIONS])
def test_pending_password_change_blocks_everything_else(
    client, user_factory, auth_headers, role, method, path
):
    user = user_factory(username=f"pend-{role[:5]}", role=role, must_change_password=True)
    url = path
    for name in ("case_id", "document_id", "user_id"):
        url = url.replace("{" + name + "}", _SOME_UUID)
    url = url.replace("{form_id}", "registro_transanestesico")
    kwargs = {"headers": auth_headers(user)}
    if method in ("post", "put", "patch"):
        kwargs["json"] = {}
    resp = client.request(method.upper(), url, **kwargs)
    if (method, path) in PENDING_ALLOWED:
        assert resp.status_code != 403, resp.text
        if (method, path) == ("get", "/api/v1/auth/me"):
            assert resp.status_code == 200 and resp.json()["must_change_password"] is True
    else:
        assert resp.status_code == 403, resp.text
        assert resp.json() == {"detail": "password change required"}


def test_pending_flag_clears_after_change(client, user_factory):
    user_factory(username="primera", must_change_password=True)
    token = _bearer(_login(client, "primera").json()["access_token"])
    assert client.get("/api/v1/cases", headers=token).status_code == 403
    assert client.post("/api/v1/auth/change-password", headers=token, json={
        "current_password": TEST_PASSWORD, "new_password": "Definitiva-456"}).status_code == 204
    fresh = _bearer(_login(client, "primera", "Definitiva-456").json()["access_token"])
    assert client.get("/api/v1/cases", headers=fresh).status_code == 200


# --- gateway identity hardening (review fix 4) --------------------------------------------

def test_gateway_cannot_impersonate_local_accounts(client, admin_user, anesthesiologist,
                                                   gateway_mode):
    for local in (admin_user, anesthesiologist):
        resp = client.get("/api/v1/auth/me", headers={"X-User-Id": local.id})
        assert resp.status_code == 401, resp.text
        assert resp.json() == {"detail": "Invalid gateway identity"}
    assert client.get("/api/v1/admin/stats",
                      headers={"X-User-Id": admin_user.id}).status_code == 401


def test_gateway_guest_parent_must_be_gateway_user(client, admin_user, gateway_mode):
    guest = {"X-User-Id": "guest-2", "X-User-Role": "guest",
             "X-User-Created-By": admin_user.id}
    assert client.get("/api/v1/cases", headers=guest).status_code == 401
    assert client.get("/api/v1/admin/users", headers=guest).status_code == 401


def test_gateway_username_collision_is_401(client, user_factory, gateway_mode, db):
    tenant = "a1b2c3d4-0000-4000-8000-00000000abcd"
    # a pre-existing row squats the JIT username gw-<tenant> under a different id
    user_factory(username=f"gw-{tenant}", user_id=str(uuid.uuid4()))
    resp = client.get("/api/v1/cases", headers={"X-User-Id": tenant})
    assert resp.status_code == 401
    assert db.get(UserModel, tenant) is None
    # the session is still usable afterwards
    assert client.get("/api/v1/cases", headers={"X-User-Id": str(uuid.uuid4())}).status_code == 200


def test_gateway_jit_row_is_accepted_again(client, gateway_mode, tenant_headers):
    h = tenant_headers()
    assert client.get("/api/v1/cases", headers=h).status_code == 200
    assert client.get("/api/v1/cases", headers=h).status_code == 200  # existing gw- row


def test_login_disabled_in_gateway_mode(client, anesthesiologist, gateway_mode):
    resp = _login(client, "anest1")
    assert resp.status_code == 404
    assert resp.json() == {"detail": "local login disabled in gateway mode"}


@pytest.mark.parametrize("username", ["gw-root", "GW-Root", " gw-x"])
def test_cli_rejects_gateway_prefix(db, capsys, username):
    assert cli.main(["create-admin", "--username", username,
                     "--password", "Primera-Clave1"]) == 2
    assert "reserved" in capsys.readouterr().err
    assert db.query(UserModel).count() == 0


# --- 422 bodies never echo passwords (review extra a) -------------------------------------

def test_validation_errors_do_not_echo_passwords(client, user_factory, auth_headers,
                                                 admin_user):
    h = auth_headers(user_factory(username="eco"))
    url = "/api/v1/auth/change-password"
    secret_current = "Actual-Secreta-1"
    for body in (
        {"current_password": secret_current, "new_password": "short7!"},   # too short
        {"current_password": secret_current},                             # missing -> body echo
        {"current_password": secret_current, "new_password": 12345678},  # wrong type
    ):
        resp = client.post(url, headers=h, json=body)
        assert resp.status_code == 422
        text_ = resp.text
        assert secret_current not in text_ and "short7!" not in text_, text_
        for err in resp.json()["detail"]:
            assert "input" not in err, err

    login = client.post("/api/v1/auth/login", json={"username": "", "password": "x" * 200})
    assert login.status_code == 422 and "x" * 200 not in login.text

    ah = auth_headers(admin_user)
    create = client.post("/api/v1/admin/users", headers=ah,
                         json={"username": "con espacio", "password": "corta"})
    assert create.status_code == 422 and "corta" not in create.text
    # non-password errors keep their echoed input
    by_field = {e["loc"][-1]: e for e in create.json()["detail"]}
    assert by_field["username"]["input"] == "con espacio"
    assert "input" not in by_field["password"]


# --- typed error bodies (review extra b) --------------------------------------------------

def test_openapi_types_error_responses(client):
    spec = client.get("/openapi.json").json()
    assert spec["components"]["schemas"]["ErrorDTO"]["properties"]["detail"]["type"] == "string"
    op = spec["paths"]["/api/v1/cases/{case_id}"]["get"]
    for code in ("401", "403", "404", "409"):
        ref = op["responses"][code]["content"]["application/json"]["schema"]["$ref"]
        assert ref.endswith("/ErrorDTO"), code
    assert spec["paths"]["/api/v1/admin/stats"]["get"]["responses"]["403"]["content"][
        "application/json"]["schema"]["$ref"].endswith("/ErrorDTO")
    assert "404" in spec["paths"]["/api/v1/auth/login"]["post"]["responses"]
