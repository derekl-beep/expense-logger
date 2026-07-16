import os

import pytest

os.environ.setdefault(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/expense_logger_test"
)

from agent import db  # noqa: E402  (must import after DATABASE_URL is set — db.py runs migrations at import time)


@pytest.fixture(autouse=True)
def clean_db():
    db._run("TRUNCATE expenses, income, budgets, users, api_calls, savings_goals, usage_events, chat_sessions RESTART IDENTITY CASCADE")
    yield


@pytest.fixture
def user_id():
    db.create_user("testuser", "not-a-real-hash")
    return db.get_user_by_username("testuser")["id"]


@pytest.fixture
def user_id_factory():
    """Creates a fresh real user per call, returning its id. Use in place of
    a bare literal int wherever a test needs several distinct isolated
    user_ids (e.g. separate chat sessions) — chat_sessions.user_id has a real
    FK to users, so a made-up int would fail to save a session at all."""
    counter = {"n": 0}

    def _make() -> int:
        counter["n"] += 1
        username = f"testuser_{counter['n']}"
        db.create_user(username, "not-a-real-hash")
        return db.get_user_by_username(username)["id"]

    return _make
