import os
import sys
from logging.config import fileConfig
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make agent package importable
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "agent" / "src"))

from lookout_agent.db.models import Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://lookout:lookout@localhost:5434/lookout",
)
if database_url.startswith("postgresql://"):
    database_url = "postgresql+psycopg://" + database_url[len("postgresql://"):]
elif database_url.startswith("postgres://"):
    database_url = "postgresql+psycopg://" + database_url[len("postgres://"):]
config.set_main_option("sqlalchemy.url", database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
