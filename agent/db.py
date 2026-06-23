import os

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

_conn = None


def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        _conn = psycopg2.connect(
            os.environ["DATABASE_URL"],
            cursor_factory=psycopg2.extras.RealDictCursor,
            keepalives=1,
            keepalives_idle=60,
            keepalives_interval=10,
            keepalives_count=5,
        )
        _conn.autocommit = True
    return _conn


def _run(sql: str, params=None):
    try:
        cur = _get_conn().cursor()
        cur.execute(sql, params or [])
        return cur
    except (psycopg2.InterfaceError, psycopg2.OperationalError):
        # Connection was dropped (e.g. Neon idle timeout) — reconnect and retry once
        global _conn
        _conn = None
        cur = _get_conn().cursor()
        cur.execute(sql, params or [])
        return cur


def _row(r: dict) -> dict:
    """Normalize Postgres types to JSON-serializable Python types."""
    d = dict(r)
    if "amount" in d and d["amount"] is not None:
        d["amount"] = float(d["amount"])
    if "date" in d and d["date"] is not None:
        d["date"] = str(d["date"])
    return d


# Schema — idempotent, runs on every startup
_run("CREATE EXTENSION IF NOT EXISTS pg_trgm")

_run("""
    CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
    )
""")

_run("""
    CREATE TABLE IF NOT EXISTS expenses (
        id          SERIAL PRIMARY KEY,
        amount      NUMERIC(10, 2),
        category    TEXT,
        description TEXT,
        date        DATE,
        flagged     BOOLEAN DEFAULT FALSE,
        user_id     INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
""")

_run("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS flagged BOOLEAN DEFAULT FALSE")
_run("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)")

_run("CREATE INDEX IF NOT EXISTS expenses_description_trgm_idx ON expenses USING gin (description gin_trgm_ops)")

_run("""
    CREATE TABLE IF NOT EXISTS api_calls (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id),
        date       DATE NOT NULL,
        count      INTEGER DEFAULT 1,
        UNIQUE (user_id, date)
    )
""")


def get_user_by_username(username: str) -> dict | None:
    cur = _run("SELECT * FROM users WHERE username = %s", (username,))
    row = cur.fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict | None:
    cur = _run("SELECT * FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    return dict(row) if row else None


def create_user(username: str, password_hash: str) -> None:
    _run("INSERT INTO users (username, password_hash) VALUES (%s, %s)", (username, password_hash))


def save_expense(amount: float, category: str, description: str, date: str, user_id: int = None) -> dict:
    if description:
        description = description[0].upper() + description[1:]

    dup_cur = _run(
        """
        SELECT id FROM expenses
        WHERE user_id = %s AND date = %s AND amount = %s AND similarity(description, %s) > 0.4
        ORDER BY similarity(description, %s) DESC
        LIMIT 1
        """,
        (user_id, date, amount, description, description),
    )
    duplicate = dup_cur.fetchone()

    cur = _run(
        "INSERT INTO expenses (amount, category, description, date, user_id, flagged) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (amount, category, description, date, user_id, duplicate is not None),
    )
    row = cur.fetchone()

    if duplicate:
        _run("UPDATE expenses SET flagged = TRUE WHERE id = %s", (duplicate["id"],))
        return {"status": "saved", "id": row["id"], "possible_duplicate_of": duplicate["id"]}

    return {"status": "saved", "id": row["id"]}


def find_similar_expenses(description: str, limit: int = 3) -> list[dict]:
    """Fuzzy-match past expense descriptions via trigram similarity, for vendor category recall."""
    cur = _run(
        """
        SELECT description, category, similarity(description, %s) AS score
        FROM expenses
        WHERE similarity(description, %s) > 0.3
        ORDER BY score DESC
        LIMIT %s
        """,
        (description, description, limit),
    )
    return [{"description": r["description"], "category": r["category"], "score": float(r["score"])} for r in cur.fetchall()]


def get_expenses(start_date: str = None, end_date: str = None, category: str = None, logged_by: str = None) -> list[dict]:
    query = """
        SELECT e.id, e.amount, e.category, e.description, e.date, e.flagged, u.username AS logged_by
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE 1=1
    """
    params = []
    if start_date:
        query += " AND e.date >= %s"
        params.append(start_date)
    if end_date:
        query += " AND e.date <= %s"
        params.append(end_date)
    if category:
        query += " AND LOWER(e.category) = LOWER(%s)"
        params.append(category)
    if logged_by:
        query += " AND LOWER(u.username) = LOWER(%s)"
        params.append(logged_by)
    query += " ORDER BY e.date DESC, e.id DESC"
    cur = _run(query, params)
    return [_row(r) for r in cur.fetchall()]


def update_expense(
    id: int,
    amount: float = None,
    category: str = None,
    description: str = None,
    date: str = None,
    flagged: bool = None,
) -> dict:
    fields, params = [], []
    if amount is not None:
        fields.append("amount = %s")
        params.append(amount)
    if category is not None:
        fields.append("category = %s")
        params.append(category)
    if description is not None:
        fields.append("description = %s")
        params.append(description)
    if date is not None:
        fields.append("date = %s")
        params.append(date)
    if flagged is not None:
        fields.append("flagged = %s")
        params.append(flagged)

    if not fields:
        return {"status": "nothing to update"}

    params.append(id)
    _run(f"UPDATE expenses SET {', '.join(fields)} WHERE id = %s", params)
    return {"status": "updated"}


def delete_expense(id: int) -> dict:
    _run("DELETE FROM expenses WHERE id = %s", (id,))
    return {"status": "deleted"}


def get_api_call_count(user_id: int, date: str) -> int:
    cur = _run(
        "SELECT count FROM api_calls WHERE user_id = %s AND date = %s",
        (user_id, date),
    )
    row = cur.fetchone()
    return row["count"] if row else 0


def increment_api_call_count(user_id: int, date: str) -> None:
    _run(
        """
        INSERT INTO api_calls (user_id, date, count) VALUES (%s, %s, 1)
        ON CONFLICT (user_id, date) DO UPDATE SET count = api_calls.count + 1
        """,
        (user_id, date),
    )
