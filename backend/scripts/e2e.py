#!/usr/bin/env python
"""End-to-end gate against a RUNNING TivaTrainer API (local auth mode).

Drives the plan's e2e gate (docs/wiki/plans/auth-admin.md "Build and verification"):

  1. admin logs in                                   POST /auth/login
  2. admin creates an anesthesiologist               POST /admin/users (random temp password)
  3. the new user logs in (must_change_password)     POST /auth/login
     - any other route is 403 until the change        GET  /cases -> 403
  4. the new user changes the password, logs in again POST /auth/change-password (revokes the
                                                     old token) -> POST /auth/login
  5. the new user creates (or finds) a synthetic      POST /patients (409 -> the existing id),
     patient and writes a case under it              PUT  /cases/{id} (client-owned id,
                                                     patient_id) + the per-section routes,
                                                     GET  /patients/{id} lists it numbered
  6. stores a document, then finalizes               POST /cases/{id}/documents,
                                                     POST /cases/{id}/finalize
  7. admin checks the dashboard                      GET  /admin/stats, /admin/cases
                                                     (?patient_id=), /admin/patients,
                                                     GET /patients/{id} (admin view),
                                                     DELETE /admin/patients/{id} -> 409,
                                                     /admin/documents, GET /documents/{id}/file
                                                     (must start with %PDF-)
  8. legacy streaming export of the 4 forms          POST /cases/{id}/export/{form_id}, written
                                                     to notebooks/forms/out/e2e_<form>.pdf

Every value is synthetic. Run the server first (uvicorn app.main:app) with an admin account
(`python -m app.cli create-admin ...`), then:

    TIVA_API=http://127.0.0.1:8000/api/v1 \\
    TIVA_E2E_ADMIN_USERNAME=... TIVA_E2E_ADMIN_PASSWORD=... \\
        python backend/scripts/e2e.py

The created account (``e2e-<random>``), the synthetic patient (registro ``SYN-E2E-0000``, reused
across runs) and the case are left in place so they show up on the admin
dashboard; delete them from /admin afterwards if needed. Exits non-zero on the first failure.
"""
import os
import secrets
import uuid
from pathlib import Path

import httpx

BASE = os.environ.get("TIVA_API", "http://127.0.0.1:8000/api/v1")
ADMIN_USERNAME = os.environ.get("TIVA_E2E_ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.environ.get("TIVA_E2E_ADMIN_PASSWORD", "")
PATIENT = {"registro": "SYN-E2E-0000", "nombre": "Paciente Sintetico E2E", "sexo": "female",
           "fecha_nacimiento": "1972-03-04", "grupo_sanguineo": "O", "rh": "+"}
OUT = Path(os.environ.get("TIVA_OUT", Path(__file__).resolve().parents[2] / "notebooks/forms/out"))

FORMS = [
    "registro_transanestesico",
    "nota_postanestesica",
    "imss_valoracion_preanestesica",
    "imss_registro_anestesia",
]


def show(label: str, r: httpx.Response, expect: int | None = None) -> httpx.Response:
    ok = r.status_code == expect if expect is not None else r.status_code < 300
    print(f"  [{'OK' if ok else 'FAIL'} {r.status_code}] {label}")
    if not ok:
        raise SystemExit(f"e2e failed at {label}: {r.status_code} {r.text[:500]}")
    return r


def check(cond: bool, what: str) -> None:
    print(f"  [{'OK' if cond else 'FAIL'}] {what}")
    if not cond:
        raise SystemExit(f"e2e check failed: {what}")


def login(c: httpx.Client, username: str, password: str, label: str) -> dict:
    return show(label, c.post("/auth/login",
                              json={"username": username, "password": password})).json()


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def fill_case(c: httpx.Client, h: dict[str, str], cid: str) -> None:
    """Populate every section with synthetic data (the old e2e body)."""
    show("PATCH /cases/{id} envelope", c.patch(f"/cases/{cid}", headers=h, json={
        "sala": "Q3", "servicio": "Cirugía General", "tipo_admision": "urgencia",
        "diagnostico_preop": "Colecistitis aguda",
        "operacion_propuesta": "Colecistectomía laparoscópica", "asa": 2, "raq": 2}))
    # identity (nombre, registro, sexo, grupo, Rh) comes from the patient; only the
    # per-encounter values are sent here
    current = show("GET /cases/{id}/patient", c.get(f"/cases/{cid}/patient", headers=h)).json()
    p = show("PUT patient", c.put(f"/cases/{cid}/patient", headers=h, json={
        **{k: current[k] for k in ("nombre", "registro", "rh", "grupo_sanguineo")},
        "hb": 13.2, "hto": 39.6, "cama": "000",
        "profile": {"weight": 72, "height": 161, "age": 54, "gender": "female"}})).json()
    print(f"    derived: imc={p['imc']} peso_ideal={p['peso_ideal']} vsc={p['vsc']}")
    show("PUT preanesthetic-assessment", c.put(
        f"/cases/{cid}/preanesthetic-assessment", headers=h, json={
            "alergia": "Ninguna", "ayuno": True, "consentimiento": True, "asa": 2, "raq": 2,
            "labs": {"urea": 28, "creatinina": 0.8, "glucosa": 96, "hb": 13.2, "hto": 39.6},
            "premedicacion": "Midazolam 2 mg IV"}))
    show("PUT anesthetic-technique", c.put(f"/cases/{cid}/anesthetic-technique", headers=h, json={
        "modality": "AGEV", "values": {"agib_7": False, "agev_8": True, "sevoflurano": True}}))
    show("PUT transanesthetic-record", c.put(
        f"/cases/{cid}/transanesthetic-record", headers=h, json={
            "monitoring": {"ECG": True, "SpO2": True, "EtCO2": True, "BIS": True},
            "basal": {"fc": 78, "ta_sys": 120, "ta_dia": 80, "spo2": 98},
            "series": [{"lane": "FC", "points": [{"t": 0, "value": 78}, {"t": 30, "value": 72}]}],
            "events": [{"marker": 1, "t": 0, "label": "Ingresa a quirófano"}]}))
    for d in [
        {"farmaco": "Propofol", "dose_value": 120, "dose_unit": "mg", "via": "IV",
         "rust_model_id": "marsh"},
        {"farmaco": "Fentanilo", "dose_value": 250, "dose_unit": "mcg", "via": "IV"},
        {"farmaco": "Rocuronio", "dose_value": 40, "dose_unit": "mg", "via": "IV"},
    ]:
        show(f"POST drugs · {d['farmaco']}", c.post(f"/cases/{cid}/drugs", headers=h, json=d))
    fb = show("PUT fluid-balance", c.put(f"/cases/{cid}/fluid-balance", headers=h, json={
        "matrix": {
            "Ingreso Critaloide": {"1hr": 500, "2hr": 300},
            "Ingreso Coloide": {"1hr": 250},
            "Sangrado": {"1hr": 100, "2hr": 50},
            "Diuresis": {"1hr": 80, "2hr": 120},
            "NCL": {"1hr": 120, "2hr": 120}},
        "blood_components": {"Concentrado globular": False}})).json()
    print(f"    derived: balance_parcial={fb['balance_parcial']} "
          f"gasto_urinario={fb['gasto_urinario']}")
    crit = ["Actividad", "Respiración", "Circulación", "Conciencia", "Coloración"]
    show("PUT recovery-score", c.put(f"/cases/{cid}/recovery-score", headers=h, json={
        "aldrete": {k: {"0": 2, "20": 2, "60": 2} for k in crit},
        "alta_a_piso": "Habitación 000"}))


def find_or_create_patient(c: httpx.Client, h: dict[str, str]) -> str:
    """POST /patients; a duplicate registro answers 409 with the existing patient's id."""
    r = c.post("/patients", headers=h, json=PATIENT)
    if r.status_code == 409:
        body = r.json()
        check(body.get("detail") == "patient exists" and bool(body.get("patient_id")),
              "duplicate registro -> 409 with the existing patient_id")
        print(f"  [OK 409] POST /patients (exists) -> {body['patient_id']}")
        return body["patient_id"]
    return show("POST /patients", r).json()["id"]


def main() -> None:
    if not (ADMIN_USERNAME and ADMIN_PASSWORD):
        raise SystemExit("set TIVA_E2E_ADMIN_USERNAME and TIVA_E2E_ADMIN_PASSWORD (an admin)")
    OUT.mkdir(parents=True, exist_ok=True)
    c = httpx.Client(base_url=BASE, timeout=120)

    print("== 1. admin login ==")
    admin = login(c, ADMIN_USERNAME, ADMIN_PASSWORD, "POST /auth/login (admin)")
    check(admin["user"]["role"] == "admin", "account is an admin")
    ah = bearer(admin["access_token"])

    print("== 2. admin creates an anesthesiologist ==")
    username = f"e2e-{secrets.token_hex(4)}"
    temp_password = "Tmp-" + secrets.token_urlsafe(12)
    created = show("POST /admin/users", c.post("/admin/users", headers=ah, json={
        "username": username, "full_name": "Dra. Sintetica E2E", "clave": "E2E-001",
        "role": "anesthesiologist", "password": temp_password})).json()
    check(created["must_change_password"] is True, "new account must change its password")

    print("== 3. first login (pending password change) ==")
    first = login(c, username, temp_password, "POST /auth/login (temporary password)")
    check(first["user"]["must_change_password"] is True, "login reports must_change_password")
    th = bearer(first["access_token"])
    show("GET /cases blocked while pending", c.get("/cases", headers=th), expect=403)
    show("GET /auth/me allowed while pending", c.get("/auth/me", headers=th))

    print("== 4. change password, log in again ==")
    new_password = "E2e-" + secrets.token_urlsafe(12)
    show("POST /auth/change-password", c.post("/auth/change-password", headers=th, json={
        "current_password": temp_password, "new_password": new_password}), expect=204)
    user = login(c, username, new_password, "POST /auth/login (new password)")
    check(user["user"]["must_change_password"] is False, "flag cleared")
    uh = bearer(user["access_token"])

    print("== 5. patient + PUT + fill a synthetic case ==")
    pid = find_or_create_patient(c, uh)
    again = c.post("/patients", headers=uh, json={**PATIENT, "registro": " syn-e2e-0000 "})
    check(again.status_code == 409 and again.json().get("patient_id") == pid,
          "registro is unique (trimmed, case-insensitive)")
    cid = str(uuid.uuid4())
    show("PUT /cases/{id} without patient_id -> 422", c.put(
        f"/cases/{cid}", headers=uh, json={"owner": "e2e"}), expect=422)
    put = show("PUT /cases/{id} (client-owned id)", c.put(f"/cases/{cid}", headers=uh, json={
        "owner": "e2e", "sala": "Q1", "patient_id": pid})).json()
    check(put["id"] == cid and put["status"] == "draft", "case created as draft")
    check(put["patient_id"] == pid and put["patient"]["registro"] == PATIENT["registro"],
          "case carries the patient's identity")
    print("  anestesiologo prefill:", put["anestesiologo"])
    fill_case(c, uh, cid)
    full = show("GET /cases/{id}", c.get(f"/cases/{cid}", headers=uh)).json()
    print(f"    drugs={len(full['drugs'])} aldrete_totals={full['recovery']['totals']}")
    detail = show("GET /patients/{id}", c.get(f"/patients/{pid}", headers=uh)).json()
    mine = next((x for x in detail["cases"] if x["id"] == cid), None)
    check(mine is not None and mine["can_edit"] and mine["numero"] == len(detail["cases"]),
          f"case listed as Caso {mine['numero'] if mine else '?'} of the patient")

    print("== 6. store a document, finalize ==")
    doc = show("POST /cases/{id}/documents", c.post(
        f"/cases/{cid}/documents", headers=uh, json={"form_id": FORMS[0]})).json()
    print(f"    document {doc['id']} ({doc['size_bytes']} bytes)")
    fin = show("POST /cases/{id}/finalize", c.post(f"/cases/{cid}/finalize", headers=uh)).json()
    check(fin["status"] == "finalized", "case finalized")
    docs = show("GET /cases/{id}/documents", c.get(f"/cases/{cid}/documents", headers=uh)).json()
    check(len(docs) >= 1 + len(FORMS), f"{len(docs)} stored documents (1 + {len(FORMS)} snapshot)")

    print("== 7. admin dashboard ==")
    stats = show("GET /admin/stats", c.get("/admin/stats", headers=ah)).json()
    row = next((u for u in stats["per_user"] if u["username"] == username), None)
    check(row is not None and row["finalized"] >= 1, "new user's finalized case in per_user")
    print(f"    patients_total={stats['patients_total']} cases_total={stats['cases_total']} "
          f"documents_total={stats['documents_total']}")
    cases = show("GET /admin/cases", c.get("/admin/cases", headers=ah,
                                             params={"user_id": created["id"]})).json()
    check(any(x["id"] == cid for x in cases["items"]), "case listed in /admin/cases")
    by_patient = show("GET /admin/cases?patient_id=", c.get(
        "/admin/cases", headers=ah, params={"patient_id": pid})).json()
    check(any(x["id"] == cid and x["patient_registro"] == PATIENT["registro"]
              for x in by_patient["items"]), "case listed under its patient")
    pats = show("GET /admin/patients", c.get("/admin/patients", headers=ah,
                                             params={"q": PATIENT["registro"]})).json()
    check(any(x["id"] == pid and x["cases_count"] >= 1 for x in pats["items"]),
          "patient listed with its cases_count")
    apat = show("GET /patients/{id} (admin)", c.get(f"/patients/{pid}", headers=ah)).json()
    check(any(x["id"] == cid for x in apat["cases"]) and not any(x["can_edit"] for x in apat["cases"]),
          "admin reads the patient's cases (none editable)")
    show("DELETE /admin/patients/{id} while it has cases -> 409",
         c.delete(f"/admin/patients/{pid}", headers=ah), expect=409)
    adocs = show("GET /admin/documents", c.get("/admin/documents", headers=ah,
                                                 params={"case_id": cid})).json()
    check(adocs["total"] >= 1 + len(FORMS), f"{adocs['total']} documents in /admin/documents")
    first_doc = adocs["items"][0]["id"]
    pdf = show("GET /documents/{id}/file (admin)",
               c.get(f"/documents/{first_doc}/file", headers=ah))
    check(pdf.content.startswith(b"%PDF-"), f"downloaded PDF ({len(pdf.content)} bytes)")

    print("== 8. legacy export of each form ==")
    for fid in FORMS:
        r = c.post(f"/cases/{cid}/export/{fid}", headers=uh)
        path = OUT / f"e2e_{fid}.pdf"
        path.write_bytes(r.content)
        tag = "%PDF" if r.content[:4] == b"%PDF" else "NOT-PDF"
        print(f"  [{r.status_code} {r.headers.get('content-type', '')}] {fid} -> {path.name} "
              f"({len(r.content)} bytes, {tag})")
        check(r.status_code == 200 and tag == "%PDF", f"export {fid}")

    print(f"\nDONE. user: {username}  case: {cid}")


if __name__ == "__main__":
    main()
