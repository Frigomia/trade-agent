import importlib.util
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND = Path(__file__).resolve().parent.parent


def _migration():
    path = next((BACKEND / "migrations" / "versions").glob("*_add_plan_targets_and_left_out.py"))
    spec = importlib.util.spec_from_file_location("add_plan_targets_and_left_out", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_is_the_single_head_on_top_of_the_order_tickets_revision():
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()

    migration = _migration()
    assert heads == [migration.revision]
    assert migration.down_revision == "e7b2c4d91a35"
