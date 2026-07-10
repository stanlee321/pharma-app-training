"""Payload DTOs — the contract the Swift app binds to (rest-contract §3).

Wire is snake_case (the Swift side decodes with .convertFromSnakeCase). Fields marked
"derived" are server-stamped read-only. Mirrors PharmaApp/Models/ClinicalRecord.swift.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
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
    # derived (server-stamped)
    imc: Optional[float] = None
    peso_ideal: Optional[float] = None
    vsc: Optional[float] = None


class PreanestheticAssessmentDTO(DTO):
    alergia: str = ""
    dentadura: str = ""
    cuello: str = ""
    via_aerea: str = ""
    estado_psiquico: str = ""
    premedicacion: str = ""
    ayuno: bool = False
    consentimiento: bool = False
    asa: Optional[int] = None
    raq: Optional[int] = None
    labs: dict[str, float] = Field(default_factory=dict)
    notes: str = ""


class AnestheticTechniqueDTO(DTO):
    modality: str = ""
    values: dict[str, Any] = Field(default_factory=dict)  # values_blob keyed by field id


class VitalPointDTO(DTO):
    t: float
    value: float


class VitalSeriesDTO(DTO):
    lane: str
    points: list[VitalPointDTO] = Field(default_factory=list)


class TransanestheticRecordDTO(DTO):
    series: list[VitalSeriesDTO] = Field(default_factory=list)
    monitoring: dict[str, bool] = Field(default_factory=dict)
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
    balance: dict[str, float] = Field(default_factory=dict)  # derived


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


class ProviderDTO(DTO):
    nombre: str = ""
    clave: str = ""


class AnesthesiaCaseDTO(DTO):
    id: UUID = Field(default_factory=uuid4)
    created_at: datetime = Field(default_factory=_now)
    owner: str = ""
    # envelope
    fecha: Optional[datetime] = None
    sala: str = ""
    servicio: str = ""
    turno: str = ""
    tipo_admision: str = ""
    diagnostico_preop: str = ""
    diagnostico_postop: str = ""
    operacion_propuesta: str = ""
    operacion_realizada: str = ""
    asa: Optional[int] = None
    raq: Optional[int] = None
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
    diagnostico_preop: Optional[str] = None
    diagnostico_postop: Optional[str] = None
    operacion_propuesta: Optional[str] = None
    operacion_realizada: Optional[str] = None
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
