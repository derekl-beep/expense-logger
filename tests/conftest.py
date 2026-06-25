import os

import pytest

os.environ.setdefault(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/expense_logger_test"
)

from agent import db  # noqa: E402  (must import after DATABASE_URL is set — db.py runs migrations at import time)


@pytest.fixture(autouse=True)
def clean_db():
    db._run("TRUNCATE expenses, budgets, users, api_calls RESTART IDENTITY CASCADE")
    yield


@pytest.fixture
def user_id():
    db.create_user("testuser", "not-a-real-hash")
    return db.get_user_by_username("testuser")["id"]
