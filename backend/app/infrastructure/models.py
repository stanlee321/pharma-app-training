from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CaseModel(Base):
    """One row per AnesthesiaCase. The nested aggregate (envelope + 9 children) is stored as
    a JSON document keyed by the DTO field names — matches rest-contract §1's "JSONB blobs".
    Normalising into per-entity tables is a later migration."""

    __tablename__ = "cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(255), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
