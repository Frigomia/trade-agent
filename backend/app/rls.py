"""Row Level Security definitions: the one source of truth for the migration and the tests.

Every table with a user_id column gets an owner-only policy keyed on the transaction-local
setting app.current_user_id (set by app.db for each request or job). A test fails if a table
with a user_id column is missing from USER_TABLES, so a new table cannot ship unprotected.
"""

RUNTIME_ROLE = "trading_agent_app"

USER_TABLES: tuple[str, ...] = (
    "holdings",
    "watchlist_items",
    "trades",
    "recommendations",
    "chat_messages",
    "backtest_results",
    "investment_preferences",
    "portfolio_snapshots",
    "user_api_keys",
    "telegram_links",
)

# Every table the runtime role may touch: the user tables, the auth table and the settings row.
RUNTIME_TABLES: tuple[str, ...] = (*USER_TABLES, "app_users", "app_settings")

# The auth table is deliberately not writable wholesale: the runtime role cannot UPDATE id,
# email, or role, so no application bug can change an existing user's role (for example promote
# someone to admin). Role is set only by the bootstrap command on the owner connection. The role
# can still INSERT rows with any role value: that is by design for the invite flow, and a known
# defense-in-depth gap.
APP_USERS_UPDATABLE_COLUMNS: tuple[str, ...] = (
    "status",
    "accepted_terms_at",
    "last_seen_at",
    "invited_at",
    "monthly_analysis_limit",
    "monthly_chat_limit",
    "claude_key_state",
)

# NULLIF: once a transaction that set the variable ends, current_setting() can return an empty
# string instead of NULL on a reused connection, and ''::uuid raises. NULL compares false, so
# an unset variable means "no rows" (default deny).
_OWNER_PREDICATE = "user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid"


def create_role_sql() -> str:
    """Creates the runtime role NOLOGIN if missing. Login and password are set by hand."""
    # B608 is a false positive: RUNTIME_ROLE is a module constant, never user input.
    return f"""
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '{RUNTIME_ROLE}') THEN
        CREATE ROLE {RUNTIME_ROLE} NOLOGIN;
    END IF;
END
$$;
"""  # nosec B608


def grant_schema_sql() -> str:
    return f"GRANT USAGE ON SCHEMA public TO {RUNTIME_ROLE}"


def grant_table_sql(table: str) -> list[str]:
    if table == "app_users":
        columns = ", ".join(APP_USERS_UPDATABLE_COLUMNS)
        return [
            f"GRANT SELECT, INSERT, DELETE ON app_users TO {RUNTIME_ROLE}",
            f"GRANT UPDATE ({columns}) ON app_users TO {RUNTIME_ROLE}",
        ]
    if table == "app_settings":
        # One admin-edited row: created and updated, never deleted.
        return [f"GRANT SELECT, INSERT, UPDATE ON app_settings TO {RUNTIME_ROLE}"]
    statements = [f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {RUNTIME_ROLE}"]
    if table in USER_TABLES:
        # Every user table has an integer id backed by a serial sequence named <table>_id_seq.
        statements.append(f"GRANT USAGE, SELECT ON SEQUENCE {table}_id_seq TO {RUNTIME_ROLE}")
    return statements


def policy_sql(table: str) -> list[str]:
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY",
        f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY",
        (
            f"CREATE POLICY {table}_owner ON {table} "
            f"USING ({_OWNER_PREDICATE}) WITH CHECK ({_OWNER_PREDICATE})"
        ),
    ]


def apply_sql() -> list[str]:
    """Grants and policies for every current table. Used by test fixtures, not by migrations
    (a migration must name its tables explicitly so it stays valid as tables are added)."""
    statements = [grant_schema_sql()]
    for table in RUNTIME_TABLES:
        statements.extend(grant_table_sql(table))
    for table in USER_TABLES:
        statements.extend(policy_sql(table))
    return statements
