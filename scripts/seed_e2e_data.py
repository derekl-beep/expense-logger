#!/usr/bin/env python
"""Deterministic, idempotent seed data for e2e tests. Resets and repopulates
whichever database DATABASE_URL points at — only run this against a
dedicated test database, never against real data."""
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

import bcrypt
import psycopg2

sys.path.insert(0, str(Path(__file__).parent.parent))

E2E_USERNAME = "e2e_test"
E2E_PASSWORD = "e2e_test_pass123"

DATABASE_URL = os.environ.setdefault(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/expense_logger_test"
)


def _ensure_database_exists():
    parsed = urlparse(DATABASE_URL)
    dbname = parsed.path.lstrip("/")
    admin_conn = psycopg2.connect(
        dbname="postgres",
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port,
    )
    admin_conn.autocommit = True
    try:
        with admin_conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,))
            if not cur.fetchone():
                cur.execute(f'CREATE DATABASE "{dbname}"')
    finally:
        admin_conn.close()


_ensure_database_exists()

from agent.db import _run, create_user, save_expense, set_budget  # noqa: E402


def _today_minus(days: int) -> str:
    """Days back from today, clamped to the 1st of the current month so every
    seeded expense lands in the same month bucket regardless of what day of
    the month tests happen to run on."""
    from datetime import date, timedelta

    clamped = min(days, date.today().day - 1)
    return (date.today() - timedelta(days=clamped)).isoformat()


def seed():
    _run("TRUNCATE expenses, budgets, users, api_calls RESTART IDENTITY CASCADE")

    create_user(E2E_USERNAME, bcrypt.hashpw(E2E_PASSWORD.encode(), bcrypt.gensalt()).decode())
    cur = _run("SELECT id FROM users WHERE username = %s", (E2E_USERNAME,))
    user_id = cur.fetchone()["id"]

    # Budgets: Dining and Driving deliberately over budget, Health near (80%+),
    # Groceries/Rent comfortably under or over for marker-position coverage,
    # Travel has a budget but zero spend this month (should stay hidden).
    set_budget("Dining", 20)
    set_budget("Driving", 150)
    set_budget("Groceries", 200)
    set_budget("Health", 150)
    set_budget("Rent", 1800)
    set_budget("Travel", 500)

    expenses = [
        (1850.00, "Rent", "Monthly Rent", _today_minus(20)),
        (142.37, "Groceries", "Groceries at Costco", _today_minus(18)),
        (38.50, "Dining", "Dinner at Pasta House", _today_minus(17)),
        (9.50, "Dining", "Lunch at Food Court", _today_minus(3)),
        (54.20, "Driving", "Gas at Shell", _today_minus(14)),
        (210.00, "Driving", "Car Repair", _today_minus(2)),
        (120.00, "Health", "Dentist Visit", _today_minus(10)),
        (310.00, "Furniture", "Bookshelf at IKEA", _today_minus(6)),
        (89.99, "Clothing", "Shoes at Nike", _today_minus(3)),
        (12.50, "Drinks", "Coffee at Local Cafe", _today_minus(5)),
        (22.00, "Transport", "Uber Ride", _today_minus(7)),
        (15.99, "Subscription", "Netflix Subscription", _today_minus(11)),
    ]
    for amount, category, description, day in expenses:
        save_expense(amount, category, description, day, user_id=user_id)


if __name__ == "__main__":
    seed()
    print(f"Seeded e2e data. Login with {E2E_USERNAME} / {E2E_PASSWORD}")
