"""Payload DTOs — the contract the Swift app binds to (rest-contract §3).

Wire is snake_case (the Swift side decodes with .convertFromSnakeCase). Fields marked
"derived" are server-stamped read-only. Mirrors PharmaApp/Models/ClinicalRecord.swift.
Coverage validated against the parsed schemas in
docs/wiki/reports/contract-reconciliation-2026-07-10.md.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Union
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


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


class AnesthesiaCaseDTO(DTO):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=_now)
    owner: str = ""
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


class CaseSummaryDTO(DTO):
    id: UUID
    owner: str
    nombre: str
    diagnostico_preop: str
    created_at: datetime


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
