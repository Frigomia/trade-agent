"""revoke Supabase API roles from the public schema

Revision ID: a7c3e91d5b20
Revises: 5e1b7c0a94d2
Create Date: 2026-10-02 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7c3e91d5b20'
down_revision: Union[str, Sequence[str], None] = '5e1b7c0a94d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Supabase serves every public table through PostgREST (/rest/v1) to the `anon` and
# `authenticated` roles, using the public anon key. app_users and app_settings have no RLS, so
# unless these roles are stripped anyone could, for example, PATCH app_users to become admin.
# The app never uses PostgREST: it connects straight to Postgres as its own role.
#
# The block is a no-op where the roles do not exist (local Docker Postgres). Default privileges
# are changed for the migrating role (current_user) so tables created later are born closed;
# Supabase otherwise grants them to these roles automatically. Grants for trading_agent_app and
# the owner are not touched.
REVOKE_SQL = """
DO $$
DECLARE
    api_roles text;
BEGIN
    SELECT string_agg(quote_ident(rolname), ', ') INTO api_roles
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated');

    IF api_roles IS NULL THEN
        RETURN;
    END IF;

    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s', api_roles);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %s', api_roles);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %s', api_roles);

    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %s',
        current_user, api_roles);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %s',
        current_user, api_roles);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %s',
        current_user, api_roles);
END
$$;
"""


def upgrade() -> None:
    op.execute(REVOKE_SQL)


def downgrade() -> None:
    # Deliberately a no-op. Access that was revoked from the public API roles must never be
    # re-granted by rolling back: that would reopen app_users to anyone with the anon key.
    pass
