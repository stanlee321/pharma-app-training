"""Case aggregate use-cases: CRUD, singleton upsert, collection CRUD, and derivation stamping."""
from __future__ import annotations

from fastapi import HTTPException

from ..domain import derivations
from ..infrastructure.models import CaseModel
from ..infrastructure.repository import SqlCaseRepository
from . import dto


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


class CaseService:
    def __init__(self, repo: SqlCaseRepository):
        self.repo = repo

    # --- helpers ---
    def _model(self, case_id: str) -> CaseModel:
        m = self.repo.get(case_id)
        if not m:
            raise HTTPException(status_code=404, detail="Case not found")
        return m

    @staticmethod
    def _load(m: CaseModel) -> dto.AnesthesiaCaseDTO:
        return dto.AnesthesiaCaseDTO.model_validate(m.data)

    def _persist(self, m: CaseModel, case: dto.AnesthesiaCaseDTO) -> dto.AnesthesiaCaseDTO:
        m.data = case.model_dump(mode="json")
        m.owner = case.owner
        self.repo.save(m)
        return _derive(self._load(m))

    # --- root CRUD ---
    def create(self, owner: str) -> dto.AnesthesiaCaseDTO:
        case = dto.AnesthesiaCaseDTO(owner=owner)
        m = CaseModel(id=str(case.id), owner=owner, created_at=case.created_at,
                      data=case.model_dump(mode="json"))
        self.repo.add(m)
        return _derive(self._load(m))

    def list(self) -> list[dto.CaseSummaryDTO]:
        out: list[dto.CaseSummaryDTO] = []
        for m in self.repo.list():
            c = self._load(m)
            out.append(dto.CaseSummaryDTO(id=c.id, owner=c.owner, nombre=c.patient.nombre,
                                          diagnostico_preop=c.diagnostico_preop, created_at=c.created_at))
        return out

    def get(self, case_id: str) -> dto.AnesthesiaCaseDTO:
        return _derive(self._load(self._model(case_id)))

    def patch_envelope(self, case_id: str, patch: dto.CaseEnvelopePatch) -> dto.AnesthesiaCaseDTO:
        m = self._model(case_id)
        case = self._load(m)
        for k, v in patch.model_dump(exclude_none=True).items():
            setattr(case, k, v)
        return self._persist(m, case)

    def delete(self, case_id: str) -> None:
        self.repo.delete(self._model(case_id))

    # --- singleton children ---
    def get_child(self, case_id: str, name: str):
        attr, _ = dto.SINGLETONS[name]
        return getattr(self.get(case_id), attr)

    def put_child(self, case_id: str, name: str, payload: dict):
        attr, model = dto.SINGLETONS[name]
        m = self._model(case_id)
        case = self._load(m)
        setattr(case, attr, model.model_validate(payload))
        derived = self._persist(m, case)
        return getattr(derived, attr)

    # --- collection children ---
    def list_items(self, case_id: str, coll: str):
        attr, _ = dto.COLLECTIONS[coll]
        return getattr(self.get(case_id), attr)

    def add_item(self, case_id: str, coll: str, payload: dict):
        attr, model = dto.COLLECTIONS[coll]
        m = self._model(case_id)
        case = self._load(m)
        item = model.model_validate(payload)
        getattr(case, attr).append(item)
        self._persist(m, case)
        return item

    def update_item(self, case_id: str, coll: str, item_id: str, payload: dict):
        attr, model = dto.COLLECTIONS[coll]
        m = self._model(case_id)
        case = self._load(m)
        items = getattr(case, attr)
        for i, it in enumerate(items):
            if str(it.id) == str(item_id):
                merged = it.model_dump()
                merged.update(payload)
                merged["id"] = str(it.id)
                items[i] = model.model_validate(merged)
                self._persist(m, case)
                return items[i]
        raise HTTPException(status_code=404, detail="Item not found")

    def delete_item(self, case_id: str, coll: str, item_id: str) -> None:
        attr, _ = dto.COLLECTIONS[coll]
        m = self._model(case_id)
        case = self._load(m)
        items = getattr(case, attr)
        kept = [it for it in items if str(it.id) != str(item_id)]
        if len(kept) == len(items):
            raise HTTPException(status_code=404, detail="Item not found")
        setattr(case, attr, kept)
        self._persist(m, case)
