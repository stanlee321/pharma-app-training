"""Case aggregate HTTP router: root CRUD, singleton children, collection children.

Every route is explicit and typed (request body model + ``response_model``) because the web
client is generated from openapi.json. The child routes are registered per resource from
``dto.SINGLETONS`` / ``dto.COLLECTIONS`` (literal path segments, so there is no generic
``{child}``/``{coll}`` template left to shadow another route). An unknown resource segment is
therefore a plain 404/405 from the router.

``case_id`` / ``item_id`` are declared as UUIDs: a non-UUID is a 422 at the edge, and the
canonical lower-case string is what reaches the service.

NOTE: no ``from __future__ import annotations`` here — the per-resource handlers are built in
closures whose annotations must be real classes for FastAPI to read them.
"""
import uuid

from fastapi import APIRouter, Depends, Response

from ..deps import get_case_service
from ...application import dto
from ...application.case_service import CaseService

router = APIRouter(tags=["cases"], responses=dto.ERROR_RESPONSES)


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
def get_case(case_id: uuid.UUID, svc: CaseService = Depends(get_case_service)):
    return svc.get(str(case_id))


@router.patch("/cases/{case_id}", response_model=dto.AnesthesiaCaseDTO)
def patch_case(
    case_id: uuid.UUID,
    body: dto.CaseEnvelopePatch,
    svc: CaseService = Depends(get_case_service),
):
    return svc.patch_envelope(str(case_id), body)


@router.put("/cases/{case_id}", response_model=dto.AnesthesiaCaseDTO)
def upsert_case(
    case_id: uuid.UUID,
    body: dto.AnesthesiaCaseWrite,
    svc: CaseService = Depends(get_case_service),
):
    """Full-aggregate create-or-replace (client-owned id). Used by the app's RestCaseStore save.
    Server-owned fields (status, updated_at, finalized_at, user_id) and ``id`` in the body are
    ignored; an upper-case path id addresses the same case as its lower-case form."""
    return svc.upsert(str(case_id), body.model_dump(exclude_unset=True, exclude={"id"}))


@router.delete("/cases/{case_id}", status_code=204, response_class=Response)
def delete_case(case_id: uuid.UUID, svc: CaseService = Depends(get_case_service)) -> Response:
    """Also deletes the case's stored documents (rows and files)."""
    svc.delete(str(case_id))
    return Response(status_code=204)


# --- singleton children: GET + PUT per resource ---
def _op(segment: str) -> str:
    return segment.replace("-", "_")


def _register_singleton(segment: str, model: type) -> None:
    def get_child(case_id: uuid.UUID, svc: CaseService = Depends(get_case_service)):
        return svc.get_child(str(case_id), segment)

    def put_child(
        case_id: uuid.UUID,
        body: model,  # type: ignore[valid-type]
        svc: CaseService = Depends(get_case_service),
    ):
        return svc.put_child(str(case_id), segment, body.model_dump())

    path = f"/cases/{{case_id}}/{segment}"
    router.add_api_route(path, get_child, methods=["GET"], response_model=model,
                         name=f"get_{_op(segment)}")
    router.add_api_route(path, put_child, methods=["PUT"], response_model=model,
                         name=f"put_{_op(segment)}")


# --- collection children: list / add / patch / delete per resource ---
def _register_collection(segment: str, model: type, patch_model: type) -> None:
    def list_items(case_id: uuid.UUID, svc: CaseService = Depends(get_case_service)):
        return svc.list_items(str(case_id), segment)

    def add_item(
        case_id: uuid.UUID,
        body: model,  # type: ignore[valid-type]
        svc: CaseService = Depends(get_case_service),
    ):
        return svc.add_item(str(case_id), segment, body.model_dump())

    def update_item(
        case_id: uuid.UUID,
        item_id: uuid.UUID,
        body: patch_model,  # type: ignore[valid-type]
        svc: CaseService = Depends(get_case_service),
    ):
        return svc.update_item(str(case_id), segment, str(item_id),
                               body.model_dump(exclude_unset=True))

    def delete_item(
        case_id: uuid.UUID,
        item_id: uuid.UUID,
        svc: CaseService = Depends(get_case_service),
    ) -> Response:
        svc.delete_item(str(case_id), segment, str(item_id))
        return Response(status_code=204)

    base = f"/cases/{{case_id}}/{segment}"
    item = f"{base}/{{item_id}}"
    op = _op(segment)
    router.add_api_route(base, list_items, methods=["GET"], response_model=list[model],
                         name=f"list_{op}")
    router.add_api_route(base, add_item, methods=["POST"], response_model=model,
                         name=f"add_{op}")
    router.add_api_route(item, update_item, methods=["PATCH"], response_model=model,
                         name=f"update_{op}")
    router.add_api_route(item, delete_item, methods=["DELETE"], status_code=204,
                         response_class=Response, name=f"delete_{op}")


for _segment, (_attr, _model) in dto.SINGLETONS.items():
    _register_singleton(_segment, _model)
for _segment, (_attr, _model) in dto.COLLECTIONS.items():
    _register_collection(_segment, _model, dto.COLLECTION_PATCHES[_segment])
