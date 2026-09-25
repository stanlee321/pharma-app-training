"""Operator CLI.

    python -m app.cli create-admin --username U --password P [--full-name N] [--clave C]

Idempotent: creates the admin, or (if the username exists) resets its password and forces
role=admin + active. Run from backend/ with TIVA_DATABASE_URL pointing at a migrated DB.
The password is never echoed. Prefer ``--password-stdin`` to keep it out of shell history.
"""
from __future__ import annotations

import argparse
import sys

from .application.auth_service import AuthService
from .core.db import SessionLocal
from .infrastructure import models  # noqa: F401 — register tables
from .infrastructure.repository import SqlUserRepository


def _create_admin(args: argparse.Namespace) -> int:
    password = args.password
    if args.password_stdin:
        password = sys.stdin.readline().rstrip("\n")
    if not password:
        print("error: --password or --password-stdin is required", file=sys.stderr)
        return 2
    with SessionLocal() as db:
        try:
            user, created = AuthService(SqlUserRepository(db)).ensure_admin(
                args.username, password, full_name=args.full_name, clave=args.clave
            )
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    print(f"admin {user.username!r} {'created' if created else 'updated'} (id {user.id})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("create-admin", help="create or reset an admin account (idempotent)")
    p.add_argument("--username", required=True)
    p.add_argument("--password")
    p.add_argument("--password-stdin", action="store_true",
                   help="read the password from the first line of stdin")
    p.add_argument("--full-name", default=None)
    p.add_argument("--clave", default=None)
    p.set_defaults(func=_create_admin)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
