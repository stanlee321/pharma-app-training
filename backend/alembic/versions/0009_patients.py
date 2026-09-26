"""patients table + cases.patient_id (historias clínicas), grouping existing cases

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-25

Plan: docs/wiki/plans/patients-historias.md.

Schema:

* ``patients(id, registro, nombre, sexo, fecha_nacimiento, grupo_sanguineo, rh, created_by,
  updated_by, created_at, updated_at)``; ``created_by``/``updated_by`` -> ``users.id``
  ON DELETE SET NULL. ``registro`` is unique on ``lower(trim(registro))`` (functional unique
  index ``uq_patients_registro_norm``); NULL is allowed (legacy rows only) and never collides.
* ``cases.patient_id`` -> ``patients.id`` ON DELETE RESTRICT, indexed, NOT NULL after the
  data step.

Data step (upgrade; every existing case gets a patient):

1. cases whose ``data.patient.registro`` is non-empty after trimming (and at most 255
   characters: a longer one is not a key and falls through to rule 2/3, the case keeping it in
   its snapshot) are grouped GLOBALLY by ``lower(trim(registro))`` -> one patient per registro.
   The key is computed by the DATABASE (the unique index's own expression), never by Python,
   whose case folding differs (e.g. ``'İ'``), so the insert can never violate the index;
2. else cases with a non-empty ``nombre`` are grouped by ``(user_id, lower(trim(nombre)))``
   -> one patient per owner + name (registro NULL);
3. else one patient per case, ``nombre = "Sin nombre"`` (registro NULL).

Each patient's identity (nombre, registro, sexo from ``profile.gender``, grupo_sanguineo, rh) is
copied from the MOST RECENT case of its group (``created_at``, then id), ``nombre`` cut to 255
characters; ``fecha_nacimiento`` is unknown (NULL). ``created_by`` = owner of the group's oldest case, ``updated_by`` = owner of the
most recent one; ``created_at``/``updated_at`` = the group's oldest ``created_at`` / newest
``updated_at``. Case data is not modified. Offline (``--sql``) upgrade is refused (the grouping
reads the rows).

Downgrade drops ``cases.patient_id`` (FK, index, column) and the ``patients`` table; the case
rows themselves are untouched (they still carry their name/registro snapshot).
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from alembic import context, op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

NO_NAME = "Sin nombre"
# Column widths (kept in sync with models.PatientModel / dto.REGISTRO_MAX_LENGTH). Case JSON has
# no length limits, so every copied value is bounded here: Postgres enforces varchar lengths.
REGISTRO_MAX = 255
NOMBRE_MAX = 255
_KEY_CHUNK = 200  # registros normalized per round trip in _db_registro_keys

_cases = sa.table(
    "cases",
    sa.column("id", sa.String),
    sa.column("user_id", sa.String),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
    sa.column("data", sa.JSON),
    sa.column("patient_id", sa.String),
)
_patients = sa.table(
    "patients",
    sa.column("id", sa.String),
    sa.column("registro", sa.String),
    sa.column("nombre", sa.String),
    sa.column("sexo", sa.String),
    sa.column("fecha_nacimiento", sa.Date),
    sa.column("grupo_sanguineo", sa.String),
    sa.column("rh", sa.String),
    sa.column("created_by", sa.String),
    sa.column("updated_by", sa.String),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _utc(value) -> datetime:
    """Row timestamps as aware UTC (SQLite may hand back naive values or strings)."""
    if value is None:
        return _EPOCH
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


def _text(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _patient_part(data) -> dict:
    if isinstance(data, str):  # defensive: a JSON column read back as text
        try:
            data = json.loads(data)
        except ValueError:
            data = {}
    if not isinstance(data, dict):
        return {}
    patient = data.get("patient")
    return patient if isinstance(patient, dict) else {}


def _group_key(case_id: str, user_id: str, patient: dict) -> tuple:
    """Provisional key; a ``("registro", <trimmed registro>)`` key is re-keyed by
    :func:`_db_registro_keys` before grouping."""
    registro = _text(patient.get("registro"))
    if registro and len(registro) <= REGISTRO_MAX:
        return ("registro", registro)
    # an over-long registro cannot be a patient key: fall through to the nombre / per-case
    # rules (the case keeps the full value in its own snapshot)
    nombre = _text(patient.get("nombre"))
    if nombre:
        return ("nombre", user_id, nombre.lower())
    return ("case", case_id)


def _db_registro_keys(conn, registros) -> dict[str, str]:
    """``{registro: lower(trim(registro))}`` computed BY THE DATABASE, i.e. exactly the key of
    the unique index ``uq_patients_registro_norm``. Python's ``lower()`` differs from the DB's
    (``'İ'.lower()`` is ``'i̇'`` in Python, ``'i'`` in Postgres), so grouping on a Python key
    could put two registros the index considers equal in separate patients and abort the
    upgrade with a UniqueViolation."""
    values = sorted(registros)
    keys: dict[str, str] = {}
    for start in range(0, len(values), _KEY_CHUNK):
        chunk = values[start:start + _KEY_CHUNK]
        row = conn.execute(sa.select(*[
            sa.func.lower(sa.func.trim(sa.literal(v, sa.String))).label(f"k{i}")
            for i, v in enumerate(chunk)
        ])).one()
        keys.update(zip(chunk, row))
    return keys


def _group_cases(conn) -> None:
    rows = conn.execute(
        sa.select(_cases.c.id, _cases.c.user_id, _cases.c.created_at, _cases.c.updated_at,
                  _cases.c.data)
    ).all()
    keyed = []
    for r in rows:
        patient = _patient_part(r.data)
        keyed.append((_group_key(r.id, r.user_id, patient), {
            "id": r.id, "user_id": r.user_id, "created_at": _utc(r.created_at),
            "updated_at": _utc(r.updated_at or r.created_at), "patient": patient,
        }))
    db_keys = _db_registro_keys(conn, {k[1] for k, _ in keyed if k[0] == "registro"})
    groups: dict[tuple, list[dict]] = {}
    for key, member in keyed:
        if key[0] == "registro":
            key = ("registro", db_keys[key[1]])
        groups.setdefault(key, []).append(member)
    for key, members in groups.items():
        members.sort(key=lambda m: (m["created_at"], m["id"]))
        oldest, newest = members[0], members[-1]
        ident = newest["patient"]
        profile = ident.get("profile") if isinstance(ident.get("profile"), dict) else {}
        gender = profile.get("gender")
        registro = _text(ident.get("registro")) if key[0] == "registro" else ""
        pid = str(uuid.uuid4())
        conn.execute(_patients.insert().values(
            id=pid,
            registro=registro or None,
            nombre=_text(ident.get("nombre"))[:NOMBRE_MAX] or NO_NAME,
            sexo=gender if gender in ("male", "female") else "",
            fecha_nacimiento=None,
            grupo_sanguineo=_text(ident.get("grupo_sanguineo"))[:16],
            rh=_text(ident.get("rh"))[:16],
            created_by=oldest["user_id"],
            updated_by=newest["user_id"],
            created_at=oldest["created_at"],
            updated_at=max(m["updated_at"] for m in members),
        ))
        ids = [m["id"] for m in members]
        for start in range(0, len(ids), 500):
            conn.execute(
                _cases.update().where(_cases.c.id.in_(ids[start:start + 500]))
                .values(patient_id=pid)
            )


def upgrade() -> None:
    if context.is_offline_mode():
        raise RuntimeError("0009 groups existing cases into patients; run it online")
    op.create_table(
        "patients",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("registro", sa.String(REGISTRO_MAX), nullable=True),
        sa.Column("nombre", sa.String(NOMBRE_MAX), nullable=False, server_default=""),
        sa.Column("sexo", sa.String(16), nullable=False, server_default=""),
        sa.Column("fecha_nacimiento", sa.Date(), nullable=True),
        sa.Column("grupo_sanguineo", sa.String(16), nullable=False, server_default=""),
        sa.Column("rh", sa.String(16), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(36),
                  sa.ForeignKey("users.id", name="fk_patients_created_by_users",
                                ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by", sa.String(36),
                  sa.ForeignKey("users.id", name="fk_patients_updated_by_users",
                                ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_patients_registro_norm", "patients",
        [sa.text("lower(trim(registro))")], unique=True,
    )
    with op.batch_alter_table("cases") as batch:
        batch.add_column(sa.Column("patient_id", sa.String(36), nullable=True))

    _group_cases(op.get_bind())

    with op.batch_alter_table("cases") as batch:
        batch.alter_column("patient_id", existing_type=sa.String(36), nullable=False)
        batch.create_foreign_key(
            "fk_cases_patient_id_patients", "patients", ["patient_id"], ["id"],
            ondelete="RESTRICT",
        )
        batch.create_index("ix_cases_patient_id", ["patient_id"])


def downgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.drop_index("ix_cases_patient_id")
        batch.drop_constraint("fk_cases_patient_id_patients", type_="foreignkey")
        batch.drop_column("patient_id")
    op.drop_index("uq_patients_registro_norm", table_name="patients")
    op.drop_table("patients")
