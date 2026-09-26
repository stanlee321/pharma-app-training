from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import CaseModel, DocumentModel, UserModel, _now


def _like(q: str) -> str:
    """A lower-cased ``%q%`` LIKE pattern; ``%``, ``_`` and the escape char are escaped."""
    esc = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{esc}%"


@dataclass(frozen=True)
class CaseFilter:
    """Admin case search. Dates are UTC instants: ``created_from <= created_at < created_to``."""

    status: str | None = None
    user_id: str | None = None
    q: str | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None


@dataclass(frozen=True)
class UserActivity:
    user: UserModel
    drafts: int
    finalized: int
    last_case_update: datetime | None


class SqlCaseRepository:
    """Implements the CaseRepository port (rest-contract §1) over SQLAlchemy."""

    def __init__(self, db: Session):
        self.db = db

    def list(self, user_id: str | None) -> list[tuple[CaseModel, UserModel | None]]:
        """Cases newest first with their owner row; ``user_id=None`` lists every tenant."""
        stmt = (
            select(CaseModel, UserModel)
            .outerjoin(UserModel, UserModel.id == CaseModel.user_id)
            .order_by(CaseModel.created_at.desc())
        )
        if user_id is not None:
            stmt = stmt.where(CaseModel.user_id == user_id)
        return [(c, u) for c, u in self.db.execute(stmt).all()]

    def get(self, case_id: str) -> CaseModel | None:
        return self.db.get(CaseModel, case_id)

    def add(self, model: CaseModel) -> CaseModel:
        model.updated_at = _now()
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def save_draft(self, case_id: str, *, data: dict, owner: str) -> bool:
        """Write the aggregate ONLY while the row is still a draft, and commit.

        A single conditional ``UPDATE … WHERE id=:id AND status='draft'`` (bumping ``version``
        and stamping ``updated_at``), so a write that was authorised before a concurrent
        finalize committed cannot land on the now-locked case. Returns False (and rolls back)
        when no draft row matched: the case was finalized or deleted in the meantime.

        The caller must NOT have mutated the ORM instance (it would be flushed on commit).
        """
        result = self.db.execute(
            update(CaseModel)
            .where(CaseModel.id == case_id, CaseModel.status == "draft")
            .values(data=data, owner=owner, updated_at=_now(), version=CaseModel.version + 1)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            self.db.rollback()
            return False
        self.db.commit()
        return True

    def delete(self, model: CaseModel) -> None:
        """Unconditional delete (admin). documents rows go with it (FK ON DELETE CASCADE);
        the caller removes the files."""
        self.db.delete(model)
        self.db.commit()

    def delete_draft(self, case_id: str) -> bool:
        """Delete the row only while it is a draft (owner delete), and commit. False (rolled
        back) when it was finalized or deleted concurrently."""
        result = self.db.execute(
            delete(CaseModel)
            .where(CaseModel.id == case_id, CaseModel.status == "draft")
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            self.db.rollback()
            return False
        self.db.commit()
        return True

    def set_status(self, case_id: str, *, expected: str, status: str,
                   finalized_at: datetime | None, expected_version: int | None = None) -> bool:
        """Compare-and-set the lifecycle status WITHOUT committing (the caller owns the
        transaction). With ``expected_version`` the row must also still be at that version
        (nothing wrote to it since it was loaded). Returns False when the row no longer matches
        (lost a race). Bumps ``version``."""
        conds = [CaseModel.id == case_id, CaseModel.status == expected]
        if expected_version is not None:
            conds.append(CaseModel.version == expected_version)
        result = self.db.execute(
            update(CaseModel)
            .where(*conds)
            .values(status=status, finalized_at=finalized_at, updated_at=_now(),
                    version=CaseModel.version + 1)
            .execution_options(synchronize_session=False)
        )
        return result.rowcount == 1

    # --- admin queries ---
    def _search_conditions(self, f: CaseFilter) -> list:
        conds = []
        if f.status:
            conds.append(CaseModel.status == f.status)
        if f.user_id:
            conds.append(CaseModel.user_id == f.user_id)
        if f.created_from is not None:
            conds.append(CaseModel.created_at >= f.created_from)
        if f.created_to is not None:
            conds.append(CaseModel.created_at < f.created_to)
        if f.q and f.q.strip():
            pattern = _like(f.q.strip())
            texts = [
                CaseModel.data["patient"]["nombre"].as_string(),
                CaseModel.data["patient"]["registro"].as_string(),
                CaseModel.data["diagnostico_preop"].as_string(),
                CaseModel.data["procedimiento"].as_string(),
                CaseModel.owner,
                CaseModel.id,
                UserModel.username,
                UserModel.full_name,
            ]
            conds.append(or_(*(func.lower(t).like(pattern, escape="\\") for t in texts)))
        return conds

    def search(self, f: CaseFilter, *, limit: int, offset: int
               ) -> tuple[list[tuple[CaseModel, UserModel | None]], int]:
        """One page of cases (newest first) with their owner row, and the filtered total."""
        conds = self._search_conditions(f)
        base = select(CaseModel, UserModel).outerjoin(UserModel, UserModel.id == CaseModel.user_id)
        total = self.db.scalar(
            select(func.count()).select_from(CaseModel)
            .outerjoin(UserModel, UserModel.id == CaseModel.user_id)
            .where(*conds)
        ) or 0
        rows = self.db.execute(
            base.where(*conds)
            .order_by(CaseModel.created_at.desc(), CaseModel.id.desc())
            .limit(limit).offset(offset)
        ).all()
        return [(c, u) for c, u in rows], total

    def count_by_status(self) -> dict[str, int]:
        rows = self.db.execute(
            select(CaseModel.status, func.count()).group_by(CaseModel.status)
        ).all()
        return {status: n for status, n in rows}

    def created_since(self, since: datetime) -> list[datetime]:
        """``created_at`` of every case created at/after ``since``. Bucketing into days happens
        in Python (UTC), which behaves identically on SQLite and Postgres (no dialect-specific
        date functions, no dependence on the DB session time zone)."""
        return list(self.db.scalars(
            select(CaseModel.created_at).where(CaseModel.created_at >= since)
        ))


class SqlUserRepository:
    """User accounts. Usernames are stored lower-cased (case-insensitive uniqueness)."""

    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def normalize(username: str) -> str:
        return username.strip().lower()

    def get(self, user_id: str) -> UserModel | None:
        return self.db.get(UserModel, user_id)

    def get_by_username(self, username: str) -> UserModel | None:
        return self.db.scalar(
            select(UserModel).where(UserModel.username == self.normalize(username))
        )

    def count_cases(self, user_id: str) -> int:
        return self.db.scalar(
            select(func.count()).select_from(CaseModel).where(CaseModel.user_id == user_id)
        ) or 0

    def add(self, model: UserModel) -> UserModel:
        model.username = self.normalize(model.username)
        now = _now()
        model.created_at = model.created_at or now
        model.updated_at = now
        self.db.add(model)
        self.db.commit()
        self.db.refresh(model)
        return model

    def add_if_absent(self, model: UserModel) -> UserModel:
        """Insert, or return the row another request inserted concurrently (JIT provisioning)."""
        try:
            return self.add(model)
        except IntegrityError:
            self.db.rollback()
            existing = self.get(model.id)
            if existing is None:
                raise
            return existing

    def save(self, model: UserModel) -> UserModel:
        model.updated_at = _now()
        self.db.commit()
        self.db.refresh(model)
        return model

    def delete(self, model: UserModel) -> None:
        """Hard delete. Raises IntegrityError (cases.user_id is ON DELETE RESTRICT) when the
        user still owns cases; the caller rolls back."""
        self.db.delete(model)
        self.db.commit()

    def search(self, *, q: str | None = None, role: str | None = None,
               is_active: bool | None = None) -> list[UserModel]:
        """Users ordered by username; ``q`` matches username / full_name / clave
        (case-insensitive substring)."""
        stmt = select(UserModel).order_by(UserModel.username)
        if role:
            stmt = stmt.where(UserModel.role == role)
        if is_active is not None:
            stmt = stmt.where(UserModel.is_active == is_active)
        if q and q.strip():
            pattern = _like(q.strip())
            stmt = stmt.where(or_(*(
                func.lower(col).like(pattern, escape="\\")
                for col in (UserModel.username, UserModel.full_name, UserModel.clave)
            )))
        return list(self.db.scalars(stmt))

    def lock_active_admins(self) -> None:
        """Serialise admin-roster changes inside the current transaction.

        A no-op ``UPDATE users SET role=role WHERE role='admin' AND is_active`` row-locks every
        active admin on Postgres and takes SQLite's single write lock, so two admins demoting
        each other concurrently cannot both pass the last-admin check (the second waits, then
        counts the committed result). Dialect-agnostic, unlike ``SELECT … FOR UPDATE``.
        """
        self.db.execute(
            update(UserModel)
            .where(UserModel.role == "admin", UserModel.is_active.is_(True))
            .values(role=UserModel.role)
            .execution_options(synchronize_session=False)
        )

    def count_active_admins(self) -> int:
        return self.db.scalar(
            select(func.count()).select_from(UserModel)
            .where(UserModel.role == "admin", UserModel.is_active.is_(True))
        ) or 0

    def activity(self) -> list[UserActivity]:
        """Per-user case counts: every anesthesiologist, plus any other user owning cases."""
        drafts = func.coalesce(func.sum(case((CaseModel.status == "draft", 1), else_=0)), 0)
        finalized = func.coalesce(
            func.sum(case((CaseModel.status == "finalized", 1), else_=0)), 0
        )
        n_cases = func.count(CaseModel.id)
        stmt = (
            select(UserModel, drafts, finalized, func.max(CaseModel.updated_at), n_cases)
            .outerjoin(CaseModel, CaseModel.user_id == UserModel.id)
            .group_by(UserModel.id)
            .having(or_(UserModel.role == "anesthesiologist", n_cases > 0))
            .order_by(n_cases.desc(), UserModel.username)
        )
        return [
            UserActivity(user=u, drafts=int(d), finalized=int(fz), last_case_update=last)
            for u, d, fz, last, _n in self.db.execute(stmt).all()
        ]

    def touch_login(self, model: UserModel) -> UserModel:
        """Record a successful login without moving ``updated_at`` (profile edits only)."""
        model.last_login_at = _now()
        self.db.commit()
        self.db.refresh(model)
        return model


class SqlDocumentRepository:
    """Stored-document rows. ``add`` does not commit: generation commits (or rolls back) the
    row together with its bytes (a blob in the same transaction, or the file it just wrote);
    finalize adds four rows plus the status change in a single transaction. No query here ever
    selects ``document_blobs.content`` (only ``DatabaseBlobStorage.open`` does)."""

    def __init__(self, db: Session):
        self.db = db

    def get(self, document_id: str) -> DocumentModel | None:
        return self.db.get(DocumentModel, document_id)

    def list_for_case(self, case_id: str) -> list[DocumentModel]:
        """Newest first (created_at, then id as a stable tie-breaker)."""
        return list(self.db.scalars(
            select(DocumentModel)
            .where(DocumentModel.case_id == case_id)
            .order_by(DocumentModel.created_at.desc(), DocumentModel.id.desc())
        ))

    def locations_for_case(self, case_id: str) -> list[tuple[str, str, str | None]]:
        """``(id, storage_backend, storage_path)`` of every document of the case (no content)."""
        return [tuple(r) for r in self.db.execute(
            select(DocumentModel.id, DocumentModel.storage_backend, DocumentModel.storage_path)
            .where(DocumentModel.case_id == case_id)
        ).all()]

    def search(self, *, case_id: str | None = None, form_id: str | None = None,
               limit: int, offset: int) -> tuple[list[DocumentModel], int]:
        """One page of documents across all cases (newest first) and the filtered total."""
        conds = []
        if case_id:
            conds.append(DocumentModel.case_id == case_id)
        if form_id:
            conds.append(DocumentModel.form_id == form_id)
        total = self.db.scalar(
            select(func.count()).select_from(DocumentModel).where(*conds)
        ) or 0
        rows = list(self.db.scalars(
            select(DocumentModel).where(*conds)
            .order_by(DocumentModel.created_at.desc(), DocumentModel.id.desc())
            .limit(limit).offset(offset)
        ))
        return rows, total

    def count(self) -> int:
        return self.db.scalar(select(func.count()).select_from(DocumentModel)) or 0

    def add(self, model: DocumentModel) -> None:
        self.db.add(model)

    def delete(self, model: DocumentModel) -> None:
        self.db.delete(model)

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()
