from fastapi import Depends, Header
from sqlalchemy.orm import Session

from ..application.case_service import CaseService
from ..core.config import settings
from ..core.db import get_db
from ..infrastructure.repository import SqlCaseRepository


def get_user_id(x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> str:
    return x_user_id or settings.mock_user_id


def get_case_service(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_user_id),
) -> CaseService:
    return CaseService(SqlCaseRepository(db), user_id)
