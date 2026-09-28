"""Create the first admin: python -m app.auth.bootstrap_admin <email> <supabase-uid>.

A CLI command rather than an endpoint so it cannot be reached remotely. It connects with
MIGRATION_DATABASE_URL (the owner role) and refuses to run if an admin already exists.
"""

import argparse
import sys
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppUser


def bootstrap_admin(db: Session, email: str, user_id: uuid.UUID) -> AppUser:
    if db.query(AppUser).filter_by(role="admin").first() is not None:
        raise ValueError("An admin already exists")
    admin = AppUser(id=user_id, email=email.strip().lower(), role="admin", status="active")
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create the first admin user")
    parser.add_argument("email", help="the admin's email address")
    parser.add_argument("user_id", type=uuid.UUID, help="the Supabase auth user id (uid)")
    args = parser.parse_args(argv)

    if not settings.migration_database_url:
        sys.stderr.write("MIGRATION_DATABASE_URL is not set\n")
        return 1

    engine = create_engine(settings.migration_database_url)
    try:
        with Session(engine) as db:
            admin = bootstrap_admin(db, args.email, args.user_id)
    except ValueError as exc:
        sys.stderr.write(f"{exc}\n")
        return 1
    finally:
        engine.dispose()

    sys.stdout.write(f"Created admin {admin.email} ({admin.id})\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
