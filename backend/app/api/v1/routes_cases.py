"""Case aggregate HTTP router: root CRUD, collection CRUD, and singleton upsert.

Route declaration order matters. The collection write routes ({coll}) are declared
BEFORE the generic singleton route ({child}) so FastAPI resolves 'drugs'/'newborns'
against the collection handlers rather than capturing them as a {child} segment.

The one place ordering alone is NOT enough is GET: the collection GET and the
singleton GET share the identical two-segment template `/cases/{case_id}/{seg}`,
so Starlette would always match whichever is declared first for EVERY value and
shadow the other. They are therefore served by a single GET dispatcher below that
resolves COLLECTIONS first, then SINGLETONS, then 404.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from ..deps import get_case_service
from ...application import dto
from ...application.case_service import CaseService

router = APIRouter()


# --- root CRUD ---
@router.post("/cases", response_model=dto.AnesthesiaCaseDTO)
def create_case(
    body: dto.CreateCaseRequest,
    svc: CaseService = Depends(get_case_service),
):
    return svc.create(body.owner)


@router.get("/cases", response_model=list[dto.CaseSummaryDTO])
def list_cases(svc: CaseService = Depends(get_case_service)):
    return svc.list()


@router.get("/cases/{case_id}", response_model=dto.AnesthesiaCaseDTO)
def get_case(case_id: str, svc: CaseService = Depends(get_case_service)):
    return svc.get(case_id)


@router.patch("/cases/{case_id}", response_model=dto.AnesthesiaCaseDTO)
def patch_case(
    case_id: str,
    body: dto.CaseEnvelopePatch,
    svc: CaseService = Depends(get_case_service),
):
    return svc.patch_envelope(case_id, body)


@router.put("/cases/{case_id}", response_model=dto.AnesthesiaCaseDTO)
def upsert_case(
    case_id: str,
    body: dict,
    svc: CaseService = Depends(get_case_service),
):
    """Full-aggregate create-or-replace (client-owned id). Used by the app's RestCaseStore save."""
    return svc.upsert(case_id, body)


@router.delete("/cases/{case_id}", status_code=204)
def delete_case(case_id: str, svc: CaseService = Depends(get_case_service)):
    svc.delete(case_id)
    return Response(status_code=204)


# --- collection children (declared BEFORE the generic singleton {child} route) ---
@router.post("/cases/{case_id}/{coll}")
def add_collection_item(
    case_id: str,
    coll: str,
    body: dict,
    svc: CaseService = Depends(get_case_service),
):
    if coll not in dto.COLLECTIONS:
        raise HTTPException(status_code=404, detail="Unknown resource")
    return svc.add_item(case_id, coll, body)


@router.patch("/cases/{case_id}/{coll}/{item_id}")
def update_collection_item(
    case_id: str,
    coll: str,
    item_id: str,
    body: dict,
    svc: CaseService = Depends(get_case_service),
):
    if coll not in dto.COLLECTIONS:
        raise HTTPException(status_code=404, detail="Unknown resource")
    return svc.update_item(case_id, coll, item_id, body)


@router.delete("/cases/{case_id}/{coll}/{item_id}", status_code=204)
def delete_collection_item(
    case_id: str,
    coll: str,
    item_id: str,
    svc: CaseService = Depends(get_case_service),
):
    if coll not in dto.COLLECTIONS:
        raise HTTPException(status_code=404, detail="Unknown resource")
    svc.delete_item(case_id, coll, item_id)
    return Response(status_code=204)


# --- singleton upsert (declared AFTER collections) ---
@router.put("/cases/{case_id}/{child}")
def put_singleton_child(
    case_id: str,
    child: str,
    body: dict,
    svc: CaseService = Depends(get_case_service),
):
    if child not in dto.SINGLETONS:
        raise HTTPException(status_code=404, detail="Unknown resource")
    return svc.put_child(case_id, child, body)


# --- shared GET dispatcher (collection LIST or singleton GET share one template) ---
@router.get("/cases/{case_id}/{resource}")
def get_child_or_collection(
    case_id: str,
    resource: str,
    svc: CaseService = Depends(get_case_service),
):
    if resource in dto.COLLECTIONS:
        return svc.list_items(case_id, resource)
    if resource in dto.SINGLETONS:
        return svc.get_child(case_id, resource)
    raise HTTPException(status_code=404, detail="Unknown resource")
