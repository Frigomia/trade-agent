# Backend — Claude Code Conventions

FastAPI + SQLAlchemy + Alembic. Design spec: `../docs/ARCHITECTURE.md` §3-5, §11.

## Commands

    python -m venv .venv && source .venv/bin/activate   # .venv\Scripts\activate on Windows
    pip install -r requirements.txt
    cp .env.example .env
    alembic upgrade head
    uvicorn app.main:app --reload
    python -m pytest tests/ -v

## Conventions

- SQLAlchemy 2.0 style (`Mapped`, `mapped_column`), never the legacy `Column` API.
- Every query filters by `settings.default_user_id` — no auth yet, this is
  the placeholder single-user boundary.
- Pydantic v2 schemas in `app/schemas.py`; one `*In`/`*Out` pair per resource.
- New model field → `alembic revision --autogenerate -m "..."`, review the
  generated migration before applying.
