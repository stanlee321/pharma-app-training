from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import CaseModel


class SqlCaseRepository:
    """Implements the CaseRepository port (rest-contract §1) over SQLAlchemy."""

    def __init__(self, db: Session):
        self.db = db

    def list(self, user_id: str) -> list[CaseModel]:
        return list(self.db.scalars(
            select(CaseModel)
            .where(CaseModel.user_id == user_id)
            .order_by(CaseModel.created_at.desc())
        ))

    def get(self, case_id: str) -> CaseModel | None:
        return self.db.get(CaseModel, case_id)

    def add(self, model: CaseModel) -> CaseModel:
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def save(self, model: CaseModel) -> CaseModel:
        self.db.commit()
        self.db.refresh(model)
        return model

    def delete(self, model: CaseModel) -> None:
        self.db.delete(model)
        self.db.commit()
