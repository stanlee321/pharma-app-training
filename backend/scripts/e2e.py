#!/usr/bin/env python
"""End-to-end smoke against a RUNNING TivaTrainer API.

Creates a case, populates every entity, checks server-derived values, and exports each of
the 4 forms to PDF. Run the server first (uvicorn app.main:app), then:
    TIVA_API=http://127.0.0.1:8000/api/v1 python backend/scripts/e2e.py
"""
import os
from pathlib import Path

import httpx

BASE = os.environ.get("TIVA_API", "http://127.0.0.1:8000/api/v1")
OUT = Path(os.environ.get("TIVA_OUT", Path(__file__).resolve().parents[2] / "notebooks/forms/out"))
OUT.mkdir(parents=True, exist_ok=True)

FORMS = [
    "registro_transanestesico",
    "nota_postanestesica",
    "imss_valoracion_preanestesica",
    "imss_registro_anestesia",
]


def main() -> None:
    c = httpx.Client(base_url=BASE, timeout=60)

    def show(label, r):
        print(f"  [{'OK' if r.status_code < 300 else 'FAIL'} {r.status_code}] {label}")
        r.raise_for_status()
        return r

    print("== create case ==")
    cid = show("POST /cases", c.post("/cases", json={"owner": "e2e"})).json()["id"]
    print("  case id:", cid)

    print("== envelope ==")
    show("PATCH /cases/{id}", c.patch(f"/cases/{cid}", json={
        "sala": "Q3", "servicio": "Cirugía General", "tipo_admision": "urgencia",
        "diagnostico_preop": "Colecistitis aguda",
        "operacion_propuesta": "Colecistectomía laparoscópica", "asa": 2, "raq": 2}))

    print("== patient ==")
    p = show("PUT patient", c.put(f"/cases/{cid}/patient", json={
        "nombre": "N. Pérez", "registro": "TU-2026-0481", "rh": "+", "grupo_sanguineo": "O",
        "hb": 13.2, "hto": 39.6, "cama": "204",
        "profile": {"weight": 72, "height": 161, "age": 54, "gender": "female"}})).json()
    print(f"  derived: imc={p['imc']} peso_ideal={p['peso_ideal']} vsc={p['vsc']}")

    print("== preanesthetic ==")
    show("PUT preanesthetic-assessment", c.put(f"/cases/{cid}/preanesthetic-assessment", json={
        "alergia": "Ninguna", "ayuno": True, "consentimiento": True, "asa": 2, "raq": 2,
        "labs": {"urea": 28, "creatinina": 0.8, "glucosa": 96, "hb": 13.2, "hto": 39.6},
        "premedicacion": "Midazolam 2 mg IV"}))

    print("== technique ==")
    show("PUT anesthetic-technique", c.put(f"/cases/{cid}/anesthetic-technique", json={
        "modality": "AGEV", "values": {"agib_7": False, "agev_8": True, "sevoflurano": True}}))

    print("== monitoring ==")
    show("PUT transanesthetic-record", c.put(f"/cases/{cid}/transanesthetic-record", json={
        "monitoring": {"ECG": True, "SpO2": True, "EtCO2": True, "BIS": True},
        "basal": {"fc": 78, "ta_sys": 120, "ta_dia": 80, "spo2": 98},
        "series": [{"lane": "FC", "points": [{"t": 0, "value": 78}, {"t": 30, "value": 72}]}],
        "events": [{"marker": 1, "t": 0, "label": "Ingresa a quirófano"}]}))

    print("== drugs ==")
    for d in [
        {"farmaco": "Propofol", "dose_value": 120, "dose_unit": "mg", "via": "IV", "rust_model_id": "marsh"},
        {"farmaco": "Fentanilo", "dose_value": 250, "dose_unit": "mcg", "via": "IV"},
        {"farmaco": "Rocuronio", "dose_value": 40, "dose_unit": "mg", "via": "IV"},
    ]:
        show(f"POST drugs · {d['farmaco']}", c.post(f"/cases/{cid}/drugs", json=d))

    print("== fluids (real control_fluidos rows) ==")
    fb = show("PUT fluid-balance", c.put(f"/cases/{cid}/fluid-balance", json={
        "matrix": {
            "Ingreso Critaloide": {"1hr": 500, "2hr": 300},
            "Ingreso Coloide": {"1hr": 250},
            "Sangrado": {"1hr": 100, "2hr": 50},
            "Diuresis": {"1hr": 80, "2hr": 120},
            "NCL": {"1hr": 120, "2hr": 120}},
        "blood_components": {"Concentrado globular": False}})).json()
    print(f"  derived: balance_parcial={fb['balance_parcial']} gasto_urinario={fb['gasto_urinario']}")

    print("== recovery (aldrete) ==")
    crit = ["Actividad", "Respiración", "Circulación", "Conciencia", "Coloración"]
    show("PUT recovery-score", c.put(f"/cases/{cid}/recovery-score", json={
        "aldrete": {k: {"0": 2, "20": 2, "60": 2} for k in crit},
        "alta_a_piso": "Habitación 204"}))

    print("== full case (server-derived) ==")
    full = show("GET /cases/{id}", c.get(f"/cases/{cid}")).json()
    print(f"  drugs={len(full['drugs'])}  aldrete_totals={full['recovery']['totals']}")

    print("== export each form ==")
    for fid in FORMS:
        r = c.post(f"/cases/{cid}/export/{fid}")
        path = OUT / f"e2e_{fid}.pdf"
        path.write_bytes(r.content)
        tag = "%PDF" if r.content[:4] == b"%PDF" else "NOT-PDF"
        print(f"  [{r.status_code} {r.headers.get('content-type','')}] {fid} -> {path.name} "
              f"({len(r.content)} bytes, {tag})")

    print("\nDONE. case:", cid)


if __name__ == "__main__":
    main()
