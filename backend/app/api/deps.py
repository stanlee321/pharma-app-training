from fastapi import Depends
from sqlalchemy.orm import Session

from ..application.case_service import CaseService
from ..core.db import get_db
from ..infrastructure.repository import SqlCaseRepository


def get_case_service(db: Session = Depends(get_db)) -> CaseService:
    return CaseService(SqlCaseRepository(db))
