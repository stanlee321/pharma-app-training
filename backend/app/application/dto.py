"""Payload DTOs — the contract the Swift app binds to (rest-contract §3).

Wire is snake_case (the Swift side decodes with .convertFromSnakeCase). Fields marked
"derived" are server-stamped read-only. Mirrors PharmaApp/Models/ClinicalRecord.swift.
Coverage validated against the parsed schemas in
docs/wiki/reports/contract-reconciliation-2026-07-10.md.
"""
from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, timezone
from typing import Any, Literal, Optional, Union
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator, model_validator


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DTO(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class PatientProfileDTO(DTO):
    weight: float = 70
    height: float = 170
    age: float = 40
    gender: str = "male"  # male | female
    dilution: float = 10.0


class PatientRecordDTO(DTO):
    profile: PatientProfileDTO = Field(default_factory=PatientProfileDTO)
    registro: str = ""
    nombre: str = ""
    hb: Optional[float] = None
    hto: Optional[float] = None
    rh: str = ""
    grupo_sanguineo: str = ""
    cama: str = ""
    hab: str = ""
    # derived (server-stamped)
    imc: Optional[float] = None
    peso_ideal: Optional[float] = None
    vsc: Optional[float] = None
    vsc_25: Optional[float] = None
    vsc_15: Optional[float] = None


class PreanestheticAssessmentDTO(DTO):
    alergia: str = ""
    dentadura: str = ""
    cuello: str = ""
    via_aerea: str = ""
    estado_psiquico: str = ""
    aparato_respiratorio: str = ""
    aparato_cardiovascular: str = ""
    tegumentos: str = ""
    antecedentes_anestesicos: str = ""
    medicamentos_previos: str = ""
    analgesica_obstetrica: str = ""
    otros: str = ""
    premedicacion: str = ""
    ayuno: bool = False
    consentimiento: bool = False
    asa: Optional[int] = None
    raq: Optional[int] = None
    labs: dict[str, Union[str, float]] = Field(default_factory=dict)  # quantitative + qualitative (orina)
    notes: str = ""


class AnestheticTechniqueDTO(DTO):
    modality: str = ""
    # values_blob keyed by the canonical schema field id (e.g. "propofol_25").
    # checkbox_value fields carry a composite value (bool + Quantity + unit) — the value shape
    # convention is pinned in the field-crosswalk (see reconciliation report §2/§5.5).
    values: dict[str, Any] = Field(default_factory=dict)


class VitalPointDTO(DTO):
    t: float
    value: float


class VitalSeriesDTO(DTO):
    lane: str
    points: list[VitalPointDTO] = Field(default_factory=list)


class SurgicalEventDTO(DTO):
    marker: int          # 1..6 (Ingresa a quirófano … Sale de quirófano)
    t: float
    label: str = ""


class VitalSnapshotDTO(DTO):
    fc: Optional[float] = None
    fr: Optional[float] = None
    ta_sys: Optional[float] = None
    ta_dia: Optional[float] = None
    spo2: Optional[float] = None
    pvc: Optional[float] = None


class TransanestheticRecordDTO(DTO):
    series: list[VitalSeriesDTO] = Field(default_factory=list)
    events: list[SurgicalEventDTO] = Field(default_factory=list)
    monitoring: dict[str, bool] = Field(default_factory=dict)
    basal: VitalSnapshotDTO = Field(default_factory=VitalSnapshotDTO)
    termination: VitalSnapshotDTO = Field(default_factory=VitalSnapshotDTO)
    complicaciones: str = ""


class DrugAdministrationDTO(DTO):
    id: UUID = Field(default_factory=uuid4)
    label: str = ""
    farmaco: str = ""
    dose_value: Optional[float] = None
    dose_unit: str = "mg"
    via: str = "IV"
    time: Optional[datetime] = None
    rust_model_id: Optional[str] = None


class FluidBalanceDTO(DTO):
    matrix: dict[str, dict[str, float]] = Field(default_factory=dict)
    blood_components: dict[str, bool] = Field(default_factory=dict)
    # derived (server-stamped) — the form's named rows
    balance_parcial: dict[str, float] = Field(default_factory=dict)
    balance_total: dict[str, float] = Field(default_factory=dict)
    total_a_reponer: dict[str, float] = Field(default_factory=dict)
    gasto_urinario: dict[str, Optional[float]] = Field(default_factory=dict)
    tasa_fentanilo: Optional[float] = None


class RecoveryScoreDTO(DTO):
    aldrete: dict[str, dict[str, int]] = Field(default_factory=dict)
    otras: dict[str, int] = Field(default_factory=dict)
    alta_a_piso: str = ""
    medico_responsable: str = ""
    totals: dict[str, Optional[int]] = Field(default_factory=dict)  # derived


class NewbornRecordDTO(DTO):
    id: UUID = Field(default_factory=uuid4)
    sexo: str = ""
    peso_gramos: Optional[float] = None
    talla_cm: Optional[float] = None
    apgar1: Optional[int] = None
    apgar5: Optional[int] = None
    apgar10: Optional[int] = None
    expulsion_placenta: str = ""
    estado_general: str = ""


class ProviderDTO(DTO):
    nombre: str = ""
    clave: str = ""
    cedula: str = ""
    universidad: str = ""


class IsquemiaDTO(DTO):
    hr_inicio: Optional[str] = None
    hr_termino: Optional[str] = None
    sitio: str = ""


class NeumoperitoneoDTO(DTO):
    hr_inicio: Optional[str] = None


CaseStatus = Literal["draft", "finalized"]

# Server-owned, read-only fields of AnesthesiaCaseDTO. They live in `cases` columns (never in
# the JSON `data` blob) and are always stripped from client payloads (PUT /cases/{id}).
SERVER_FIELDS: frozenset[str] = frozenset({"status", "updated_at", "finalized_at", "user_id"})


class AnesthesiaCaseDTO(DTO):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=_now)
    owner: str = ""
    # server-owned (read-only; ignored on client writes — see SERVER_FIELDS)
    status: CaseStatus = "draft"
    updated_at: Optional[datetime] = None
    finalized_at: Optional[datetime] = None
    user_id: Optional[str] = None
    # envelope
    fecha: Optional[datetime] = None
    sala: str = ""
    servicio: str = ""
    turno: str = ""
    tipo_admision: str = ""     # urgencia | electiva
    tipo: str = ""              # I | II
    procedimiento: str = ""
    posicion: str = ""
    duracion_anestesia: str = ""
    diagnostico_preop: str = ""
    diagnostico_postop: str = ""
    operacion_propuesta: str = ""
    operacion_realizada: str = ""
    equipo_quirurgico: str = ""
    observaciones: str = ""
    complicaciones_post: str = ""
    asa: Optional[int] = None
    raq: Optional[int] = None
    isquemia: IsquemiaDTO = Field(default_factory=IsquemiaDTO)
    neumoperitoneo: NeumoperitoneoDTO = Field(default_factory=NeumoperitoneoDTO)
    anestesiologo: ProviderDTO = Field(default_factory=ProviderDTO)
    cirujano: ProviderDTO = Field(default_factory=ProviderDTO)
    # singleton children
    patient: PatientRecordDTO = Field(default_factory=PatientRecordDTO)
    pre_assessment: PreanestheticAssessmentDTO = Field(default_factory=PreanestheticAssessmentDTO)
    technique: AnestheticTechniqueDTO = Field(default_factory=AnestheticTechniqueDTO)
    trans_record: TransanestheticRecordDTO = Field(default_factory=TransanestheticRecordDTO)
    fluid_balance: FluidBalanceDTO = Field(default_factory=FluidBalanceDTO)
    recovery: RecoveryScoreDTO = Field(default_factory=RecoveryScoreDTO)
    # collections
    drugs: list[DrugAdministrationDTO] = Field(default_factory=list)
    newborns: list[NewbornRecordDTO] = Field(default_factory=list)


def _optional(annotation: Any) -> Any:
    return Optional[annotation]


# PUT /cases/{id} body: the aggregate WITHOUT the server-owned fields (any sent are ignored,
# as pydantic drops unknown keys). ``id`` is optional and ignored: the path id always wins.
AnesthesiaCaseWrite = create_model(
    "AnesthesiaCaseWrite",
    __base__=DTO,
    __doc__="Full-aggregate create-or-replace body (server-owned fields are not accepted).",
    id=(Optional[UUID], Field(default=None, description="Ignored; the path id wins.")),
    **{
        name: (f.annotation, f)
        for name, f in AnesthesiaCaseDTO.model_fields.items()
        if name not in SERVER_FIELDS and name != "id"
    },
)


class CaseSummaryDTO(DTO):
    id: UUID
    owner: str
    nombre: str
    diagnostico_preop: str
    created_at: datetime
    status: CaseStatus = "draft"
    updated_at: Optional[datetime] = None
    finalized_at: Optional[datetime] = None
    user_id: Optional[str] = None
    owner_name: Optional[str] = None  # the owning user's full_name, else username


class CreateCaseRequest(DTO):
    owner: str = ""


class CaseEnvelopePatch(DTO):
    sala: Optional[str] = None
    servicio: Optional[str] = None
    turno: Optional[str] = None
    tipo_admision: Optional[str] = None
    tipo: Optional[str] = None
    procedimiento: Optional[str] = None
    posicion: Optional[str] = None
    duracion_anestesia: Optional[str] = None
    diagnostico_preop: Optional[str] = None
    diagnostico_postop: Optional[str] = None
    operacion_propuesta: Optional[str] = None
    operacion_realizada: Optional[str] = None
    equipo_quirurgico: Optional[str] = None
    observaciones: Optional[str] = None
    complicaciones_post: Optional[str] = None
    asa: Optional[int] = None
    raq: Optional[int] = None


# name (URL segment) -> (AnesthesiaCaseDTO attr, DTO model)
SINGLETONS: dict[str, tuple[str, type[DTO]]] = {
    "patient": ("patient", PatientRecordDTO),
    "preanesthetic-assessment": ("pre_assessment", PreanestheticAssessmentDTO),
    "anesthetic-technique": ("technique", AnestheticTechniqueDTO),
    "transanesthetic-record": ("trans_record", TransanestheticRecordDTO),
    "fluid-balance": ("fluid_balance", FluidBalanceDTO),
    "recovery-score": ("recovery", RecoveryScoreDTO),
}

COLLECTIONS: dict[str, tuple[str, type[DTO]]] = {
    "drugs": ("drugs", DrugAdministrationDTO),
    "newborns": ("newborns", NewbornRecordDTO),
}


def _partial(model: type[DTO], name: str) -> type[DTO]:
    """Every field optional (default None) except ``id``: the PATCH body of a collection item.
    The service merges only the keys the client actually sent (``exclude_unset``)."""
    return create_model(
        name,
        __base__=DTO,
        **{
            fname: (_optional(f.annotation), None)
            for fname, f in model.model_fields.items()
            if fname != "id"
        },
    )


DrugAdministrationPatch = _partial(DrugAdministrationDTO, "DrugAdministrationPatch")
NewbornRecordPatch = _partial(NewbornRecordDTO, "NewbornRecordPatch")

# URL segment -> PATCH body model for that collection's items
COLLECTION_PATCHES: dict[str, type[DTO]] = {
    "drugs": DrugAdministrationPatch,
    "newborns": NewbornRecordPatch,
}


# --- accounts / auth ---------------------------------------------------------------------

UserRole = Literal["anesthesiologist", "admin"]
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128  # bounds argon2 work per request


class UserDTO(DTO):
    id: str
    username: str
    full_name: str
    clave: str
    role: UserRole
    is_active: bool
    must_change_password: bool
    created_at: datetime
    updated_at: datetime
    last_login_at: Optional[datetime] = None


class LoginRequest(DTO):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)


class LoginResponse(DTO):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    user: UserDTO


class ChangePasswordRequest(DTO):
    current_password: str = Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)
    new_password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


# --- stored documents ---------------------------------------------------------------------

# The four fill-PDF templates (keys of infrastructure.render.renderer.FORM_MAP). A Literal so
# an unknown or path-like form_id is a 422 at the edge and the openapi enum lists them.
FormId = Literal[
    "registro_transanestesico",
    "nota_postanestesica",
    "imss_valoracion_preanestesica",
    "imss_registro_anestesia",
]
FORM_IDS: tuple[str, ...] = FormId.__args__  # type: ignore[attr-defined]


class GenerateDocumentRequest(DTO):
    form_id: FormId


class DocumentDTO(DTO):
    """A generated, stored PDF. ``storage_path`` is deliberately absent (admin DTO only)."""

    id: str
    case_id: str
    form_id: FormId
    size_bytes: int
    sha256: str
    generated_by: Optional[str] = None
    created_at: datetime
    is_fallback: bool = False  # True when the real form failed and the summary PDF was stored
    download_url: str


class AdminDocumentDTO(DocumentDTO):
    # Where the bytes live: "db" (document_blobs; storage_path is null) or "local" (file).
    storage_backend: str
    storage_path: str | None = None


# --- form schemas (GET /forms, GET /forms/{form_id}/schema) --------------------------------
# The schema JSON comes from the notebooks/forms parsing pipeline. The common keys are typed
# for the generated web client; anything else the pipeline emits passes through (extra=allow).

class FormInfoDTO(DTO):
    form_id: str
    title: str


class _FormSchemaPart(BaseModel):
    model_config = ConfigDict(extra="allow")


class FormPageDTO(_FormSchemaPart):
    width: float
    height: float


class FormFieldDTO(_FormSchemaPart):
    id: str
    type: str
    label: Optional[str] = None
    unit: Optional[str] = None
    section: Optional[str] = None
    bbox: Optional[list[float]] = None
    checkbox_bbox: Optional[list[float]] = None
    blank_bbox: Optional[list[float]] = None


class FormTableDTO(_FormSchemaPart):
    id: str
    title: Optional[str] = None
    bbox: Optional[list[float]] = None
    rows: Optional[list[dict[str, Any]]] = None
    columns: Optional[list[dict[str, Any]]] = None
    row_cuts: Optional[list[float]] = None
    col_cuts: Optional[list[float]] = None


class FormSchemaDTO(_FormSchemaPart):
    form_id: str
    source: Optional[str] = None
    page: Optional[FormPageDTO] = None
    fields: list[FormFieldDTO] = Field(default_factory=list)
    tables: list[FormTableDTO] = Field(default_factory=list)
    charts: list[dict[str, Any]] = Field(default_factory=list)
    major_sections: list[Any] = Field(default_factory=list)
    subsections: list[Any] = Field(default_factory=list)


# --- admin API (/admin/*) ------------------------------------------------------------------

USERNAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._@-]*$"
# Reserved for gateway just-in-time users (mirrors auth_service.GATEWAY_USERNAME_PREFIX).
GATEWAY_USERNAME_PREFIX = "gw-"


class ErrorDTO(BaseModel):
    """Every non-422 error body (401/403/404/409/400): ``{"detail": "..."}``."""

    detail: str


# Router-level ``responses`` so openapi.json types the error bodies.
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorDTO, "description": desc}
    for code, desc in (
        (401, "Not authenticated (missing/invalid/expired/revoked token)"),
        (403, "Forbidden (role, inactive account, or password change required)"),
        (404, "Not found (or not visible to the caller)"),
        (409, "Conflict (state or uniqueness guard)"),
    )
}


class AdminUserCreate(DTO):
    """New account. The password is temporary: the user must change it at first login
    (``must_change_password`` is set). The username is stored lower-cased; the ``gw-``
    prefix is reserved for gateway users. Unknown fields are rejected (422)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    username: str = Field(min_length=1, max_length=64, pattern=USERNAME_PATTERN)
    full_name: str = Field(default="", max_length=255)
    clave: str = Field(default="", max_length=64)
    role: UserRole = "anesthesiologist"
    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)

    @field_validator("username")
    @classmethod
    def _not_gateway_prefix(cls, v: str) -> str:
        if v.strip().lower().startswith(GATEWAY_USERNAME_PREFIX):
            raise ValueError(f"usernames starting with {GATEWAY_USERNAME_PREFIX!r} are reserved")
        return v


class AdminUserUpdate(DTO):
    """Partial update: only the keys sent are applied (``null`` is rejected). Unknown fields
    are rejected (422)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    full_name: Optional[str] = Field(default=None, max_length=255)
    clave: Optional[str] = Field(default=None, max_length=64)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def _no_explicit_nulls(self) -> "AdminUserUpdate":
        nulls = sorted(k for k in self.model_fields_set if getattr(self, k) is None)
        if nulls:
            raise ValueError(f"fields cannot be null: {', '.join(nulls)}")
        return self


class ResetPasswordRequest(DTO):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    password: str = Field(min_length=PASSWORD_MIN_LENGTH, max_length=PASSWORD_MAX_LENGTH)


class AdminCasePage(DTO):
    items: list[CaseSummaryDTO]
    total: int
    limit: int
    offset: int


class AdminDocumentPage(DTO):
    items: list[AdminDocumentDTO]
    total: int
    limit: int
    offset: int


class CasesByStatusDTO(DTO):
    draft: int = 0
    finalized: int = 0


class DailyCountDTO(DTO):
    date: date_type  # UTC calendar day
    count: int


class UserActivityDTO(DTO):
    user_id: str
    username: str
    full_name: str
    drafts: int
    finalized: int
    # the latest of the user's last case write and last login (None if neither happened)
    last_activity: Optional[datetime] = None


class AdminStatsDTO(DTO):
    cases_total: int
    cases_by_status: CasesByStatusDTO
    cases_per_day: list[DailyCountDTO]  # the last 30 UTC days (today included), oldest first
    per_user: list[UserActivityDTO]
    documents_total: int
