"""Case aggregate use-cases: CRUD, singleton upsert, collection CRUD, and derivation stamping.

Authorization (plans: docs/wiki/plans/auth-admin.md phase 2, patients-historias.md):

* anesthesiologist — may READ every case (patients and their cases are shared hospital-wide);
  writes (PUT/PATCH/child writes/DELETE) only on their OWN cases: another user's case -> 403
  ``{"detail": "case belongs to another anesthesiologist"}``; their own ``finalized`` case -> 409
  ``{"detail": "case is finalized"}``. ``GET /cases`` still lists only the caller's own cases
  (a patient's screen, ``GET /patients/{id}``, is where everyone's cases appear).
* admin — may READ any case through ``/cases``; every ``/cases`` write -> 403 (admins act
  through ``/admin/*``). ``reopen`` (finalized -> draft) and ``admin_delete`` are admin-only.

Patients: creating a case (``POST /cases`` or the create path of ``PUT /cases/{id}``) requires
``patient_id`` (422 without, 404 unknown). The patient's identity (nombre, registro, and sexo /
grupo_sanguineo / rh when set) is copied into ``case.patient``, and the per-encounter profile
values the client left at their defaults (peso, talla, edad, dilución) come from the patient's
most recent case (edad from ``fecha_nacimiento`` when known). ``patient_id`` never changes
afterwards (a different value on a replace is ignored). The identity snapshot of a DRAFT always
equals its patient: every draft write (``_persist``), finalize and reopen re-copy it, so a client
can never diverge it or revert a ``PATCH /patients/{id}`` refresh.

Lock under concurrency: every data write is a conditional ``UPDATE … WHERE status='draft'``
(``SqlCaseRepository.save_draft``), and the owner's delete is conditional the same way, so a
write authorised just before a concurrent finalize committed is refused (409), never applied.

Case ids are canonicalised (lower-case hyphenated UUID) at every entry point, so an upper-case
id in a path can neither create a second row nor miss the existing one.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import TypeVar

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ValidationError

from ..domain import derivations
from sqlalchemy.exc import IntegrityError

from ..infrastructure.models import CaseModel, PatientModel, UserModel
from ..infrastructure.repository import SqlCaseRepository, SqlDocumentRepository
from ..infrastructure.storage import DocumentStores, StorageError
from . import dto
from .identity import CurrentUser

logger = logging.getLogger(__name__)

FINALIZED_DETAIL = "case is finalized"
NOT_FINALIZED_DETAIL = "case is not finalized"
ADMIN_READ_ONLY_DETAIL = "admins cannot modify cases through /cases; use /admin"
CASE_NOT_FOUND = "Case not found"
NOT_OWNER_DETAIL = "case belongs to another anesthesiologist"
PATIENT_NOT_FOUND = "Patient not found"
PATIENT_REQUIRED_ERROR = {
    "type": "missing", "loc": ["body", "patient_id"],
    "msg": "patient_id is required to create a case",
}

M = TypeVar("M", bound=BaseModel)


def canonical_id(value: object) -> str | None:
    """Lower-case hyphenated UUID string, or None if ``value`` is not a UUID."""
    try:
        return str(value if isinstance(value, uuid.UUID) else uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        return None


def validate_input(model: type[M], data: object) -> M:
    """Validate client input; a pydantic error becomes a 422 (never an unhandled 500)."""
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=jsonable_encoder(exc.errors(include_url=False, include_context=False)),
        ) from exc


def _utc(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on DateTime(timezone=True); every stored stamp is UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _blob(case: dto.AnesthesiaCaseDTO) -> dict:
    """The JSON `data` document: the aggregate minus the column fields."""
    return case.model_dump(mode="json", exclude=set(dto.COLUMN_FIELDS))


def apply_identity(record: dto.PatientRecordDTO, p: PatientModel) -> bool:
    """Copy the patient's identity into a case's snapshot: nombre always, registro when the
    patient has one (a legacy patient without registro leaves the case's own value), sexo
    (-> ``profile.gender``), grupo_sanguineo and rh when the patient has them. Returns True
    when the snapshot changed."""
    before = record.model_dump()
    record.nombre = p.nombre or ""
    if p.registro:
        record.registro = p.registro
    if p.sexo:
        record.profile.gender = p.sexo
    if p.grupo_sanguineo:
        record.grupo_sanguineo = p.grupo_sanguineo
    if p.rh:
        record.rh = p.rh
    return record.model_dump() != before


def _derive(case: dto.AnesthesiaCaseDTO) -> dto.AnesthesiaCaseDTO:
    """Stamp the computed read-only values (never accepted from the client)."""
    p = case.patient
    p.imc = derivations.imc(p.profile.weight, p.profile.height)
    p.peso_ideal = derivations.peso_ideal(p.profile.height, p.profile.gender == "male")
    p.vsc = derivations.vsc(p.profile.weight)
    p.vsc_25 = round(p.vsc * 0.25, 1)
    p.vsc_15 = round(p.vsc * 0.15, 1)
    case.recovery.totals = derivations.aldrete_total(case.recovery.aldrete)
    fentanyl = sum(
        (d.dose_value or 0)
        for d in case.drugs
        if "fentanil" in d.farmaco.lower() and d.dose_unit.lower() in ("mcg", "µg", "ug")
    )
    fb = derivations.fluid_balance(
        case.fluid_balance.matrix, weight_kg=p.profile.weight, fentanyl_mcg_total=fentanyl
    )
    case.fluid_balance.balance_parcial = fb["balance_parcial"]
    case.fluid_balance.balance_total = fb["balance_total"]
    case.fluid_balance.total_a_reponer = fb["total_a_reponer"]
    case.fluid_balance.gasto_urinario = fb["gasto_urinario"]
    case.fluid_balance.tasa_fentanilo = fb["tasa_fentanilo"]
    return case


def _owner_name(u: UserModel | None) -> str | None:
    if u is None:
        return None
    return u.full_name or u.username


def to_summary(m: CaseModel, owner: UserModel | None,
               patient: PatientModel | None = None) -> dto.CaseSummaryDTO:
    c = CaseService._load(m)
    return dto.CaseSummaryDTO(
        id=c.id, owner=c.owner, nombre=c.patient.nombre, registro=c.patient.registro or "",
        diagnostico_preop=c.diagnostico_preop, created_at=c.created_at,
        status=c.status, updated_at=c.updated_at, finalized_at=c.finalized_at,
        user_id=c.user_id, owner_name=_owner_name(owner),
        patient_id=m.patient_id,
        patient_nombre=patient.nombre if patient is not None else None,
        patient_registro=patient.registro if patient is not None else None,
    )


class CaseService:
    def __init__(
        self,
        repo: SqlCaseRepository,
        user: CurrentUser,
        documents: SqlDocumentRepository | None = None,
        stores: DocumentStores | None = None,
    ):
        self.repo = repo
        self.user = user
        # Needed only to remove stored PDF files (local backend) when a case is deleted;
        # database blobs go with the rows (ON DELETE CASCADE).
        self.documents = documents
        self.stores = stores

    @property
    def user_id(self) -> str:
        return self.user.id

    # --- authorization helpers ---
    def _require_writer(self) -> None:
        if self.user.is_admin:
            raise HTTPException(status_code=403, detail=ADMIN_READ_ONLY_DETAIL)

    @staticmethod
    def _cid(case_id: object) -> str:
        cid = canonical_id(case_id)
        if cid is None:
            raise HTTPException(status_code=404, detail=CASE_NOT_FOUND)
        return cid

    def _model(self, case_id: object) -> CaseModel:
        """Readable case row: every authenticated caller reads every case (shared
        hospital-wide); 404 only when it does not exist."""
        m = self.repo.get(self._cid(case_id))
        if not m:
            raise HTTPException(status_code=404, detail=CASE_NOT_FOUND)
        return m

    def _owned_or_admin(self, case_id: object) -> CaseModel:
        """Case row the caller owns (any status), or any case for an admin; 403 otherwise."""
        m = self._model(case_id)
        if not self.user.is_admin and m.user_id != self.user_id:
            raise HTTPException(status_code=403, detail=NOT_OWNER_DETAIL)
        return m

    def _writable(self, case_id: object) -> CaseModel:
        """Own, draft case row: 403 for admins and for another user's case, 409 if finalized."""
        self._require_writer()
        m = self._owned_or_admin(case_id)
        if m.status == "finalized":
            raise HTTPException(status_code=409, detail=FINALIZED_DETAIL)
        return m

    # Public aliases for the other application services (DocumentService).
    readable = _model
    owned_or_admin = _owned_or_admin
    writable = _writable

    def _patient(self, patient_id: object) -> PatientModel:
        pid = canonical_id(patient_id)
        p = self.repo.db.get(PatientModel, pid) if pid else None
        if p is None:
            raise HTTPException(status_code=404, detail=PATIENT_NOT_FOUND)
        return p

    def _seed_from_patient(self, case: dto.AnesthesiaCaseDTO, p: PatientModel) -> None:
        """New case: the patient's identity, and the per-encounter profile values the client
        left at their defaults taken from the patient's most recent case (edad from
        ``fecha_nacimiento`` when known)."""
        apply_identity(case.patient, p)
        prof = case.patient.profile
        defaults = dto.PatientProfileDTO()
        prev_m = self.repo.latest_for_patient(p.id)
        prev = self._load(prev_m).patient.profile if prev_m is not None else None
        for name in ("weight", "height", "age", "dilution"):
            if getattr(prof, name) != getattr(defaults, name):
                continue  # the client chose a value
            if name == "age" and p.fecha_nacimiento is not None:
                years = derivations.age_years(p.fecha_nacimiento)
                if years is not None:
                    prof.age = float(years)
                    continue
            if prev is not None:
                setattr(prof, name, getattr(prev, name))

    def _insert(self, case: dto.AnesthesiaCaseDTO, p: PatientModel) -> dto.AnesthesiaCaseDTO:
        m = CaseModel(id=str(case.id), owner=case.owner, user_id=self.user_id,
                      patient_id=p.id, created_at=case.created_at, data=_blob(case))
        try:
            self.repo.add(m)
        except IntegrityError:
            # the patient was deleted concurrently (FK) -> 404; anything else is a real error
            self.repo.db.rollback()
            if self.repo.db.get(PatientModel, p.id) is None:
                raise HTTPException(status_code=404, detail=PATIENT_NOT_FOUND) from None
            raise
        return _derive(self._load(m))

    def _prefill_provider(self, case: dto.AnesthesiaCaseDTO) -> None:
        """New case with an empty anestesiologo -> the caller's full_name / clave."""
        prov = case.anestesiologo
        if not prov.nombre.strip() and not prov.clave.strip():
            prov.nombre = self.user.full_name or ""
            prov.clave = self.user.clave or ""

    def load(self, m: CaseModel) -> dto.AnesthesiaCaseDTO:
        """The derived DTO for a row the caller has already been authorized for."""
        return _derive(self._load(m))

    @staticmethod
    def _load(m: CaseModel) -> dto.AnesthesiaCaseDTO:
        # Server-owned fields always come from the row columns, never from the JSON blob.
        # created_at too: the column drives ordering/filters, so the blob copy never wins.
        data = {k: v for k, v in (m.data or {}).items() if k not in dto.COLUMN_FIELDS}
        data.update(
            created_at=_utc(m.created_at),
            status=m.status or "draft",
            updated_at=_utc(m.updated_at),
            finalized_at=_utc(m.finalized_at),
            user_id=m.user_id or None,
            patient_id=m.patient_id or None,
        )
        return dto.AnesthesiaCaseDTO.model_validate(data)

    def sync_identity(self, m: CaseModel, case: dto.AnesthesiaCaseDTO) -> bool:
        """Overwrite ``case.patient``'s identity with the row's patient (the patient is the
        source of truth; whatever identity a client sent is ignored). True if it changed."""
        p = self.repo.db.get(PatientModel, m.patient_id) if m.patient_id else None
        return apply_identity(case.patient, p) if p is not None else False

    def _persist(self, m: CaseModel, case: dto.AnesthesiaCaseDTO) -> dto.AnesthesiaCaseDTO:
        """Conditional write: lands only while the row is still a draft. ``_writable`` checked
        the status in Python; a finalize that commits after that check makes the UPDATE match
        nothing, and the write is refused with 409 instead of mutating a locked case.

        Every draft write goes through here, so the identity snapshot is re-copied from the
        patient first: a client can neither change nombre/registro/sexo/grupo/rh on a case nor
        put back a stale copy after ``PATCH /patients/{id}`` refreshed it."""
        self.sync_identity(m, case)
        if not self.repo.save_draft(m.id, data=_blob(case), owner=case.owner):
            self._raise_lost_write(m.id)
        self.repo.db.refresh(m)
        return _derive(self._load(m))

    def _raise_lost_write(self, case_id: str) -> None:
        """A conditional write matched no draft row: 404 if the case is gone, else 409."""
        self.repo.db.expire_all()
        if self.repo.get(case_id) is None:
            raise HTTPException(status_code=404, detail=CASE_NOT_FOUND)
        raise HTTPException(status_code=409, detail=FINALIZED_DETAIL)

    # --- root CRUD ---
    def create(self, owner: str, patient_id: object) -> dto.AnesthesiaCaseDTO:
        self._require_writer()
        p = self._patient(patient_id)
        case = dto.AnesthesiaCaseDTO(owner=owner)
        self._prefill_provider(case)
        self._seed_from_patient(case, p)
        return self._insert(case, p)

    def list(self) -> list[dto.CaseSummaryDTO]:
        """The caller's own cases (every case for an admin), newest first."""
        scope = None if self.user.is_admin else self.user_id
        return [to_summary(m, owner, p) for m, owner, p in self.repo.list(scope)]

    def get(self, case_id: str) -> dto.AnesthesiaCaseDTO:
        return _derive(self._load(self._model(case_id)))

    def patch_envelope(self, case_id: str, patch: dto.CaseEnvelopePatch) -> dto.AnesthesiaCaseDTO:
        m = self._writable(case_id)
        case = self._load(m)
        for k, v in patch.model_dump(exclude_none=True).items():
            setattr(case, k, v)
        return self._persist(m, case)

    def delete(self, case_id: str) -> None:
        """Owner delete of a draft case (conditional on ``status='draft'`` at delete time)."""
        self._delete_with_documents(self._writable(case_id), draft_only=True)

    def admin_delete(self, case_id: str) -> None:
        """Admin only: delete any case (draft or finalized) with its document rows and files."""
        if not self.user.is_admin:
            raise HTTPException(status_code=403, detail="admin only")
        self._delete_with_documents(self._model(case_id), draft_only=False)

    def _delete_with_documents(self, m: CaseModel, *, draft_only: bool) -> None:
        """Delete the row (documents rows and their database blobs cascade in the same
        statement), THEN any files of ``local`` documents. A file that cannot be removed is
        logged and left orphaned rather than failing an already-committed delete.
        ``draft_only``: the DELETE carries ``status='draft'`` so a concurrent finalize wins."""
        case_id = m.id
        locations = (
            self.documents.locations_for_case(case_id) if self.documents is not None else []
        )
        if draft_only:
            if not self.repo.delete_draft(case_id):
                self._raise_lost_write(case_id)
        else:
            self.repo.delete(m)
        if self.stores is None:
            return
        for doc_id, backend, path in locations:
            try:
                store = self.stores.for_backend(backend)
                if not store.transactional:  # transactional stores went with the rows
                    store.delete(path, document_id=doc_id)
            except (OSError, StorageError):
                logger.warning("could not delete stored document file of case %s", case_id,
                               exc_info=True)

    def reopen(self, case_id: str) -> dto.AnesthesiaCaseDTO:
        """Admin only: finalized -> draft (clears finalized_at; stored documents are kept).
        403 for non-admins, 404 if missing, 409 if the case is not finalized."""
        if not self.user.is_admin:
            raise HTTPException(status_code=403, detail="admin only")
        m = self._model(case_id)
        if m.status != "finalized" or not self.repo.set_status(
            m.id, expected="finalized", status="draft", finalized_at=None
        ):
            self.repo.db.rollback()
            raise HTTPException(status_code=409, detail=NOT_FINALIZED_DETAIL)
        self.repo.db.commit()
        self.repo.db.refresh(m)
        # The patient may have been edited while the case was locked: the draft follows it.
        case = self._load(m)
        if self.sync_identity(m, case):
            if self.repo.replace_draft_data(m.id, data=_blob(case), expected_version=m.version):
                self.repo.db.commit()
                self.repo.db.refresh(m)
            else:  # written concurrently; the next write re-syncs it anyway
                self.repo.db.rollback()
        return self.load(m)

    def upsert(self, case_id: str, payload: dict) -> dto.AnesthesiaCaseDTO:
        """Full-aggregate create-or-replace with a client-owned id (PUT /cases/{id}).

        Lets an offline-first client mint the UUID and persist the whole case in one call.
        ``case_id`` is canonicalised, so ``ABC…`` and ``abc…`` address the same row.
        """
        self._require_writer()
        case_id = self._cid(case_id)
        # Server-owned fields (status/updated_at/finalized_at/user_id) are ignored on input.
        data = {k: v for k, v in payload.items() if k not in dto.SERVER_FIELDS}
        data["id"] = case_id
        m = self.repo.get(case_id)
        if m is None:
            # Create path: patient_id is required; the client-minted created_at is accepted
            # (offline-first).
            if data.get("patient_id") is None:
                raise HTTPException(status_code=422, detail=[PATIENT_REQUIRED_ERROR])
            p = self._patient(data["patient_id"])
            case = validate_input(dto.AnesthesiaCaseDTO, data)
            self._prefill_provider(case)
            self._seed_from_patient(case, p)
            return self._insert(case, p)
        # Existing row: 403 if it belongs to another user, 409 if finalized. user_id and
        # patient_id are kept (_persist never overwrites them) and so is the stored created_at
        # (never client-forged).
        m = self._writable(case_id)
        data["created_at"] = _utc(m.created_at)
        case = validate_input(dto.AnesthesiaCaseDTO, data)
        return self._persist(m, case)

    # --- singleton children ---
    def get_child(self, case_id: str, name: str):
        attr, _ = dto.SINGLETONS[name]
        return getattr(self.get(case_id), attr)

    def put_child(self, case_id: str, name: str, payload: dict):
        attr, model = dto.SINGLETONS[name]
        m = self._writable(case_id)
        case = self._load(m)
        setattr(case, attr, validate_input(model, payload))
        derived = self._persist(m, case)
        return getattr(derived, attr)

    # --- collection children ---
    def list_items(self, case_id: str, coll: str):
        attr, _ = dto.COLLECTIONS[coll]
        return getattr(self.get(case_id), attr)

    def add_item(self, case_id: str, coll: str, payload: dict):
        attr, model = dto.COLLECTIONS[coll]
        m = self._writable(case_id)
        case = self._load(m)
        item = validate_input(model, payload)
        getattr(case, attr).append(item)
        self._persist(m, case)
        return item

    def update_item(self, case_id: str, coll: str, item_id: str, payload: dict):
        attr, model = dto.COLLECTIONS[coll]
        m = self._writable(case_id)
        case = self._load(m)
        items = getattr(case, attr)
        for i, it in enumerate(items):
            if str(it.id) == str(item_id):
                merged = it.model_dump()
                merged.update(payload)
                merged["id"] = str(it.id)
                items[i] = validate_input(model, merged)
                self._persist(m, case)
                return items[i]
        raise HTTPException(status_code=404, detail="Item not found")

    def delete_item(self, case_id: str, coll: str, item_id: str) -> None:
        attr, _ = dto.COLLECTIONS[coll]
        m = self._writable(case_id)
        case = self._load(m)
        items = getattr(case, attr)
        kept = [it for it in items if str(it.id) != str(item_id)]
        if len(kept) == len(items):
            raise HTTPException(status_code=404, detail="Item not found")
        setattr(case, attr, kept)
        self._persist(m, case)
