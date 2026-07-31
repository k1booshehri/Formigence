"""Test fixtures.

The environment is pinned *before* any application module is imported, because
`app.core.config` builds its Settings object at import time. Everything then
runs against TEST_DATABASE_URL, which this module creates and tears down.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Iterator

DEFAULT_TEST_DB = "postgresql+asyncpg://formigence:formigence@localhost:5432/formigence_test"

os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-only-secret-key"
# Rate limits would otherwise trip during the multi-request auth tests. The
# limiter itself is covered directly in tests/test_rate_limit.py.
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", DEFAULT_TEST_DB)

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import make_url, text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.db import get_session  # noqa: E402
from app.core.deps import get_email_sender  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.email import MemoryEmailSender  # noqa: E402

TEST_DATABASE_URL = settings.database_url


async def _create_database_if_missing() -> None:
    """Connect to the maintenance database and CREATE DATABASE if needed."""
    url = make_url(TEST_DATABASE_URL)
    database_name = url.database
    assert database_name, "TEST_DATABASE_URL must name a database"

    admin_engine = create_async_engine(
        url.set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        poolclass=NullPool,
    )
    try:
        async with admin_engine.connect() as conn:
            exists = await conn.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": database_name},
            )
            if not exists:
                await conn.execute(text(f'CREATE DATABASE "{database_name}"'))
    finally:
        await admin_engine.dispose()


async def _reset_schema() -> None:
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    finally:
        await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def prepared_database() -> Iterator[None]:
    """Create the test database and a clean schema once per session.

    Deliberately a *synchronous* fixture driving its own event loop: the engines
    it opens are disposed before any test runs, so no asyncpg connection ever
    outlives the loop that created it.
    """
    asyncio.run(_create_database_if_missing())
    asyncio.run(_reset_schema())
    yield


@pytest_asyncio.fixture
async def engine(prepared_database: None) -> AsyncIterator[AsyncEngine]:
    """A per-test engine.

    NullPool matters here: pytest-asyncio gives each test a fresh event loop,
    and a pooled asyncpg connection created on a previous loop would be dead.
    """
    test_engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield test_engine
    await test_engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def clean_tables(engine: AsyncEngine) -> AsyncIterator[None]:
    yield
    table_names = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {table_names} RESTART IDENTITY CASCADE"))


@pytest.fixture
def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


@pytest.fixture
def email_sender() -> MemoryEmailSender:
    """Captures outgoing mail so tests can read the OTP code."""
    return MemoryEmailSender()


@pytest_asyncio.fixture
async def client(
    session_factory: async_sessionmaker[AsyncSession],
    email_sender: MemoryEmailSender,
) -> AsyncIterator[AsyncClient]:
    async def override_get_session() -> AsyncIterator[AsyncSession]:
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_email_sender] = lambda: email_sender

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http_client:
        yield http_client

    app.dependency_overrides.clear()
