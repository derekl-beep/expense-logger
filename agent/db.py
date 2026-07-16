import calendar
import os
import threading
from datetime import date, timedelta

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

# One connection per thread — psycopg2 connections are not thread-safe.
# FastAPI runs sync routes in a thread pool; thread-local avoids contention.
_local = threading.local()


def _get_conn():
    conn = getattr(_local, "conn", None)
    if conn is None or conn.closed:
        _local.conn = psycopg2.connect(
            os.environ["DATABASE_URL"],
            cursor_factory=psycopg2.extras.RealDictCursor,
            keepalives=1,
            keepalives_idle=60,
            keepalives_interval=10,
            keepalives_count=5,
        )
        _local.conn.autocommit = True
    return _local.conn


def _run(sql: str, params=None):
    try:
        cur = _get_conn().cursor()
        cur.execute(sql, params or [])
        return cur
    except (psycopg2.InterfaceError, psycopg2.OperationalError):
        # Connection was dropped (e.g. Neon idle timeout) — reconnect and retry once
        _local.conn = None
        cur = _get_conn().cursor()
        cur.execute(sql, params or [])
        return cur


def _row(r: dict) -> dict:
    """Normalize Postgres types to JSON-serializable Python types."""
    d = dict(r)
    for key, value in d.items():
        if value is not None and (key == "amount" or key.endswith("_amount")):
            d[key] = float(value)
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
_run("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")

_run("CREATE INDEX IF NOT EXISTS expenses_description_trgm_idx ON expenses USING gin (description gin_trgm_ops)")

_run("""
    CREATE TABLE IF NOT EXISTS income (
        id          SERIAL PRIMARY KEY,
        amount      NUMERIC(10, 2),
        category    TEXT,
        description TEXT,
        date        DATE,
        user_id     INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW()
    )
""")

_run("ALTER TABLE income ADD COLUMN IF NOT EXISTS reimburses_expense_id INTEGER REFERENCES expenses(id)")
_run("ALTER TABLE income ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")

_run("CREATE INDEX IF NOT EXISTS income_description_trgm_idx ON income USING gin (description gin_trgm_ops)")

_run("""
    CREATE TABLE IF NOT EXISTS api_calls (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id),
        date       DATE NOT NULL,
        count      INTEGER DEFAULT 1,
        UNIQUE (user_id, date)
    )
""")

_run("""
    CREATE TABLE IF NOT EXISTS budgets (
        category      TEXT PRIMARY KEY,
        monthly_limit NUMERIC(10, 2) NOT NULL,
        updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
""")

# Append-only usage log for feature/command adoption reporting (see
# scripts/usage_report.py) — deliberately no event payload beyond a
# structural name/source, never message content or expense/income
# descriptions, since this is financial household data.
_run("""
    CREATE TABLE IF NOT EXISTS usage_events (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id),
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        source     TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
""")

_run("CREATE INDEX IF NOT EXISTS usage_events_name_idx ON usage_events (event_name)")

# Chat session history, externalized from the in-process dict it used to
# live in (agent/main.py's old _sessions) — that dict silently dropped every
# in-progress conversation on every redeploy/restart, since nothing survived
# process memory. One row per user; the whole message list is replaced on
# every save rather than appended in SQL, since the caller always has the
# full up-to-date list in hand already.
_run("""
    CREATE TABLE IF NOT EXISTS chat_sessions (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id),
        messages   JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )
""")

# No user_id — a household-shared goal like budgets, not a per-user private
# one. current_amount is a manually-tracked accumulator ("add $200 to the
# vacation fund"), deliberately *not* derived from income minus expenses —
# the household's net cash flow can go negative some months, which would
# make goal progress swing negative too and mean nothing to a saver who
# never touched that money.
_run("""
    CREATE TABLE IF NOT EXISTS savings_goals (
        id             SERIAL PRIMARY KEY,
        name           TEXT NOT NULL,
        target_amount  NUMERIC(10, 2) NOT NULL,
        target_date    DATE,
        current_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        deleted_at     TIMESTAMPTZ
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


def _capitalize_description(description: str) -> str:
    return description[0].upper() + description[1:] if description else description


def save_expense(amount: float, category: str, description: str, date: str, user_id: int = None) -> dict:
    description = _capitalize_description(description)

    # Run duplicate check + insert + flag as a single transaction so a crash
    # between statements can't leave the DB in a half-applied state.
    conn = _get_conn()
    conn.autocommit = False
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id FROM expenses
            WHERE user_id = %s AND date = %s AND amount = %s
              AND similarity(description, %s) > 0.4
              AND deleted_at IS NULL
            ORDER BY similarity(description, %s) DESC
            LIMIT 1
            """,
            (user_id, date, amount, description, description),
        )
        duplicate = cur.fetchone()

        cur.execute(
            "INSERT INTO expenses (amount, category, description, date, user_id, flagged) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (amount, category, description, date, user_id, duplicate is not None),
        )
        row = cur.fetchone()

        if duplicate:
            cur.execute("UPDATE expenses SET flagged = TRUE WHERE id = %s", (duplicate["id"],))

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = True

    if duplicate:
        return {"status": "saved", "id": row["id"], "possible_duplicate_of": duplicate["id"]}
    return {"status": "saved", "id": row["id"]}


def save_income(
    amount: float,
    category: str,
    description: str,
    date: str,
    user_id: int = None,
    reimburses_expense_id: int = None,
) -> dict:
    description = _capitalize_description(description)

    if reimburses_expense_id is not None:
        cur = _run("SELECT id FROM expenses WHERE id = %s AND deleted_at IS NULL", (reimburses_expense_id,))
        if cur.fetchone() is None:
            return {"status": "error", "message": f"No expense with id {reimburses_expense_id}"}

    cur = _run(
        "INSERT INTO income (amount, category, description, date, user_id, reimburses_expense_id) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (amount, category, description, date, user_id, reimburses_expense_id),
    )
    row = cur.fetchone()
    return {"status": "saved", "id": row["id"]}


def link_income_to_expense(income_id: int, expense_id: int = None) -> dict:
    """Set or clear the expense an income row is a reimbursement for. expense_id=None unlinks."""
    if expense_id is not None:
        cur = _run("SELECT id FROM expenses WHERE id = %s AND deleted_at IS NULL", (expense_id,))
        if cur.fetchone() is None:
            return {"status": "error", "message": f"No expense with id {expense_id}"}

    cur = _run(
        "UPDATE income SET reimburses_expense_id = %s WHERE id = %s AND deleted_at IS NULL RETURNING id",
        (expense_id, income_id),
    )
    row = cur.fetchone()
    if row is None:
        return {"status": "error", "message": f"No income entry with id {income_id}"}
    if expense_id is not None:
        return {"status": "linked", "income_id": income_id, "expense_id": expense_id}
    return {"status": "unlinked", "income_id": income_id}


def find_similar_expenses(description: str, limit: int = 3) -> list[dict]:
    """Fuzzy-match past expense descriptions via trigram similarity, for vendor category recall."""
    cur = _run(
        """
        SELECT description, category, similarity(description, %s) AS score
        FROM expenses
        WHERE similarity(description, %s) > 0.3 AND deleted_at IS NULL
        ORDER BY score DESC
        LIMIT %s
        """,
        (description, description, limit),
    )
    return [{"description": r["description"], "category": r["category"], "score": float(r["score"])} for r in cur.fetchall()]


def get_expenses(
    start_date: str = None,
    end_date: str = None,
    category: str = None,
    logged_by: str = None,
    min_amount: float = None,
    max_amount: float = None,
    flagged: bool = None,
    description_contains: str = None,
) -> list[dict]:
    query = """
        SELECT e.id, e.amount, e.category, e.description, e.date, e.flagged, u.username AS logged_by,
               EXISTS (SELECT 1 FROM income i WHERE i.reimburses_expense_id = e.id AND i.deleted_at IS NULL) AS reimbursed
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.deleted_at IS NULL
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
    if min_amount is not None:
        query += " AND e.amount >= %s"
        params.append(min_amount)
    if max_amount is not None:
        query += " AND e.amount <= %s"
        params.append(max_amount)
    if flagged is not None:
        query += " AND e.flagged = %s"
        params.append(flagged)
    if description_contains:
        query += " AND e.description ILIKE %s"
        params.append(f"%{description_contains}%")
    query += " ORDER BY e.date DESC, e.id DESC"
    cur = _run(query, params)
    return [_row(r) for r in cur.fetchall()]


def get_income(
    start_date: str = None,
    end_date: str = None,
    category: str = None,
    logged_by: str = None,
    min_amount: float = None,
    max_amount: float = None,
    description_contains: str = None,
) -> list[dict]:
    query = """
        SELECT i.id, i.amount, i.category, i.description, i.date, u.username AS logged_by,
               i.reimburses_expense_id, e.description AS reimburses_expense_description,
               e.amount AS reimburses_expense_amount
        FROM income i
        LEFT JOIN users u ON i.user_id = u.id
        LEFT JOIN expenses e ON e.id = i.reimburses_expense_id
        WHERE i.deleted_at IS NULL
    """
    params = []
    if start_date:
        query += " AND i.date >= %s"
        params.append(start_date)
    if end_date:
        query += " AND i.date <= %s"
        params.append(end_date)
    if category:
        query += " AND LOWER(i.category) = LOWER(%s)"
        params.append(category)
    if logged_by:
        query += " AND LOWER(u.username) = LOWER(%s)"
        params.append(logged_by)
    if min_amount is not None:
        query += " AND i.amount >= %s"
        params.append(min_amount)
    if max_amount is not None:
        query += " AND i.amount <= %s"
        params.append(max_amount)
    if description_contains:
        query += " AND i.description ILIKE %s"
        params.append(f"%{description_contains}%")
    query += " ORDER BY i.date DESC, i.id DESC"
    cur = _run(query, params)
    return [_row(r) for r in cur.fetchall()]


def get_average_transaction(
    category: str = None,
    start_date: str = None,
    end_date: str = None,
    logged_by: str = None,
) -> dict:
    query = """
        SELECT AVG(e.amount) AS average, COUNT(*) AS count
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.deleted_at IS NULL
    """
    params = []
    if category:
        query += " AND LOWER(e.category) = LOWER(%s)"
        params.append(category)
    if start_date:
        query += " AND e.date >= %s"
        params.append(start_date)
    if end_date:
        query += " AND e.date <= %s"
        params.append(end_date)
    if logged_by:
        query += " AND LOWER(u.username) = LOWER(%s)"
        params.append(logged_by)
    row = _run(query, params).fetchone()
    count = row["count"]
    average = round(float(row["average"]), 2) if row["average"] is not None else 0.0
    return {"category": category, "average": average, "count": count}


def _shift_month(d: date, delta: int) -> date:
    """First-of-month date `delta` months from `d` (delta may be negative)."""
    total = d.year * 12 + (d.month - 1) + delta
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


def get_category_breakdown(start_date: str = None, end_date: str = None, logged_by: str = None) -> dict:
    query = """
        SELECT e.category, SUM(e.amount) AS total, COUNT(*) AS count
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.deleted_at IS NULL
    """
    params = []
    if start_date:
        query += " AND e.date >= %s"
        params.append(start_date)
    if end_date:
        query += " AND e.date <= %s"
        params.append(end_date)
    if logged_by:
        query += " AND LOWER(u.username) = LOWER(%s)"
        params.append(logged_by)
    query += " GROUP BY e.category ORDER BY total DESC"
    cur = _run(query, params)
    breakdown = [{"category": r["category"], "total": float(r["total"]), "count": r["count"]} for r in cur.fetchall()]
    grand_total = round(sum(r["total"] for r in breakdown), 2)
    for r in breakdown:
        r["pct"] = round(r["total"] / grand_total * 100, 1) if grand_total else 0.0
    return {"breakdown": breakdown, "grand_total": grand_total}


def get_monthly_trend(category: str = None, months: int = 6, logged_by: str = None) -> list[dict]:
    start = _shift_month(date.today().replace(day=1), -(months - 1))
    query = """
        SELECT date_trunc('month', e.date)::date AS month, SUM(e.amount) AS total, COUNT(*) AS count
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.date >= %s AND e.deleted_at IS NULL
    """
    params = [start.isoformat()]
    if category:
        query += " AND LOWER(e.category) = LOWER(%s)"
        params.append(category)
    if logged_by:
        query += " AND LOWER(u.username) = LOWER(%s)"
        params.append(logged_by)
    query += " GROUP BY month ORDER BY month"
    cur = _run(query, params)
    return [{"month": str(r["month"])[:7], "total": float(r["total"]), "count": r["count"]} for r in cur.fetchall()]


def get_run_rate(category: str, reference_date: str = None, compare_months: int = 3) -> dict:
    ref = date.fromisoformat(reference_date) if reference_date else date.today()
    month_start = ref.replace(day=1)
    days_in_month = calendar.monthrange(ref.year, ref.month)[1]
    days_elapsed = ref.day

    cur = _run(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE LOWER(category) = LOWER(%s) AND date >= %s AND date <= %s AND deleted_at IS NULL",
        (category, month_start.isoformat(), ref.isoformat()),
    )
    spent_so_far = float(cur.fetchone()["total"])
    projected_total = round(spent_so_far / days_elapsed * days_in_month, 2) if days_elapsed else 0.0

    # Fetch all prior months in one query instead of N separate calls.
    ranges = [
        (_shift_month(month_start, -i), _shift_month(month_start, -i + 1) - timedelta(days=1))
        for i in range(1, compare_months + 1)
    ]
    select_cols = ", ".join(
        f"COALESCE(SUM(CASE WHEN date >= %s AND date <= %s THEN amount END), 0) AS m{i}"
        for i in range(len(ranges))
    )
    params: list = []
    for m_start, m_end in ranges:
        params.extend([m_start.isoformat(), m_end.isoformat()])
    params.append(category)
    row = _run(
        f"SELECT {select_cols} FROM expenses WHERE LOWER(category) = LOWER(%s) AND deleted_at IS NULL",
        params,
    ).fetchone()
    prior_months = [
        {"month": ranges[i][0].isoformat()[:7], "total": float(row[f"m{i}"])}
        for i in range(len(ranges))
    ]

    last_month_total = prior_months[0]["total"] if prior_months else None
    pct_change_vs_last_month = (
        round((projected_total - last_month_total) / last_month_total * 100, 1)
        if last_month_total else None
    )

    return {
        "category": category,
        "current_month": month_start.isoformat()[:7],
        "spent_so_far": spent_so_far,
        "days_elapsed": days_elapsed,
        "days_in_month": days_in_month,
        "projected_total": projected_total,
        "prior_months": prior_months,
        "pct_change_vs_last_month": pct_change_vs_last_month,
    }


def get_weekly_pace(category: str = None, reference_date: str = None, compare_weeks: int = 3) -> dict:
    ref = date.fromisoformat(reference_date) if reference_date else date.today()
    week_start = ref - timedelta(days=ref.isoweekday() - 1)  # Monday of ref's week
    days_elapsed = (ref - week_start).days + 1

    category_filter = ""
    category_params: list = []
    if category:
        category_filter = " AND LOWER(category) = LOWER(%s)"
        category_params = [category]

    cur = _run(
        f"SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date >= %s AND date <= %s AND deleted_at IS NULL{category_filter}",
        [week_start.isoformat(), ref.isoformat()] + category_params,
    )
    spent_so_far = float(cur.fetchone()["total"])
    projected_total = round(spent_so_far / days_elapsed * 7, 2) if days_elapsed else 0.0

    # Fetch all prior weeks in one query instead of N separate calls.
    ranges = [
        (week_start - timedelta(weeks=i), week_start - timedelta(weeks=i) + timedelta(days=6))
        for i in range(1, compare_weeks + 1)
    ]
    select_cols = ", ".join(
        f"COALESCE(SUM(CASE WHEN date >= %s AND date <= %s THEN amount END), 0) AS w{i}"
        for i in range(len(ranges))
    )
    params: list = []
    for w_start, w_end in ranges:
        params.extend([w_start.isoformat(), w_end.isoformat()])
    row = _run(
        f"SELECT {select_cols} FROM expenses WHERE deleted_at IS NULL{category_filter}",
        params + category_params,
    ).fetchone()
    prior_weeks = [
        {"week_start": ranges[i][0].isoformat(), "total": float(row[f"w{i}"])}
        for i in range(len(ranges))
    ]

    last_week_total = prior_weeks[0]["total"] if prior_weeks else None
    pct_change_vs_last_week = (
        round((projected_total - last_week_total) / last_week_total * 100, 1)
        if last_week_total else None
    )

    return {
        "category": category,
        "week_start": week_start.isoformat(),
        "spent_so_far": spent_so_far,
        "days_elapsed": days_elapsed,
        "projected_total": projected_total,
        "prior_weeks": prior_weeks,
        "pct_change_vs_last_week": pct_change_vs_last_week,
    }


def get_yoy_comparison(category: str = None, month: str = None, logged_by: str = None) -> dict:
    """Compare a calendar month's spending to the same calendar month one year prior."""
    if month:
        year, mo = (int(p) for p in month.split("-"))
        this_month_start = date(year, mo, 1)
    else:
        this_month_start = date.today().replace(day=1)
    last_year_start = this_month_start.replace(year=this_month_start.year - 1)

    def _month_total(start: date) -> float:
        end = _shift_month(start, 1) - timedelta(days=1)
        query = "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses e LEFT JOIN users u ON e.user_id = u.id WHERE e.date >= %s AND e.date <= %s AND e.deleted_at IS NULL"
        params = [start.isoformat(), end.isoformat()]
        if category:
            query += " AND LOWER(e.category) = LOWER(%s)"
            params.append(category)
        if logged_by:
            query += " AND LOWER(u.username) = LOWER(%s)"
            params.append(logged_by)
        cur = _run(query, params)
        return float(cur.fetchone()["total"])

    this_year_total = _month_total(this_month_start)
    last_year_total = _month_total(last_year_start)
    pct_change = (
        round((this_year_total - last_year_total) / last_year_total * 100, 1)
        if last_year_total else None
    )

    return {
        "category": category,
        "month": this_month_start.isoformat()[:7],
        "this_year_total": this_year_total,
        "last_year_month": last_year_start.isoformat()[:7],
        "last_year_total": last_year_total,
        "pct_change": pct_change,
    }


def get_top_expenses(
    start_date: str = None,
    end_date: str = None,
    category: str = None,
    logged_by: str = None,
    limit: int = 5,
    by_vendor: bool = False,
) -> list[dict]:
    params = []
    if by_vendor:
        query = """
            SELECT e.description, SUM(e.amount) AS total, COUNT(*) AS count
            FROM expenses e
            LEFT JOIN users u ON e.user_id = u.id
            WHERE e.deleted_at IS NULL
        """
    else:
        query = """
            SELECT e.id, e.amount, e.category, e.description, e.date, u.username AS logged_by
            FROM expenses e
            LEFT JOIN users u ON e.user_id = u.id
            WHERE e.deleted_at IS NULL
        """
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

    if by_vendor:
        query += " GROUP BY e.description ORDER BY total DESC LIMIT %s"
        params.append(limit)
        cur = _run(query, params)
        return [{"description": r["description"], "total": float(r["total"]), "count": r["count"]} for r in cur.fetchall()]

    query += " ORDER BY e.amount DESC LIMIT %s"
    params.append(limit)
    cur = _run(query, params)
    return [_row(r) for r in cur.fetchall()]


def get_user_breakdown(start_date: str = None, end_date: str = None, category: str = None) -> list[dict]:
    query = """
        SELECT u.username AS logged_by, SUM(e.amount) AS total, COUNT(*) AS count
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.deleted_at IS NULL
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
    query += " GROUP BY u.username ORDER BY total DESC"
    cur = _run(query, params)
    return [{"logged_by": r["logged_by"], "total": float(r["total"]), "count": r["count"]} for r in cur.fetchall()]


_WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def get_weekday_pattern(start_date: str = None, end_date: str = None, category: str = None, logged_by: str = None) -> list[dict]:
    query = """
        SELECT EXTRACT(DOW FROM e.date)::int AS dow, SUM(e.amount) AS total, COUNT(*) AS count
        FROM expenses e
        LEFT JOIN users u ON e.user_id = u.id
        WHERE e.deleted_at IS NULL
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
    query += " GROUP BY dow ORDER BY dow"
    cur = _run(query, params)
    rows = {r["dow"]: r for r in cur.fetchall()}
    return [
        {
            "weekday": _WEEKDAY_NAMES[d],
            "total": float(rows[d]["total"]) if d in rows else 0.0,
            "count": rows[d]["count"] if d in rows else 0,
        }
        for d in range(7)
    ]


_RECURRING_FREQUENCIES = [
    ("weekly", 7, 2),
    ("biweekly", 14, 3),
    ("monthly", 30, 5),
    ("yearly", 365, 15),
]

# Canonical day-count per frequency label, for projecting the next expected
# charge date from the last one seen — the classified label, not the group's
# own (possibly slightly off) avg_gap, since the label is what a human means
# by "monthly".
_FREQUENCY_DAYS = {label: days for label, days, _ in _RECURRING_FREQUENCIES}


def _classify_frequency(avg_gap_days: float) -> str | None:
    best_label, best_diff = None, None
    for label, days, tolerance in _RECURRING_FREQUENCIES:
        diff = abs(avg_gap_days - days)
        if diff <= tolerance and (best_diff is None or diff < best_diff):
            best_label, best_diff = label, diff
    return best_label


def get_recurring_expenses() -> list[dict]:
    """Detect recurring charges: same (description, amount) appearing >=3 times at a consistent interval."""
    query = """
        WITH gaps AS (
            SELECT
                description,
                amount,
                category,
                date,
                date - LAG(date) OVER (PARTITION BY description, amount ORDER BY date) AS gap_days
            FROM expenses
            WHERE deleted_at IS NULL
        )
        SELECT
            description, amount, category,
            COUNT(*) AS occurrences,
            MAX(date) AS last_date,
            AVG(gap_days) AS avg_gap,
            STDDEV(gap_days) AS stddev_gap
        FROM gaps
        GROUP BY description, amount, category
        HAVING COUNT(*) >= 3
        ORDER BY amount DESC
    """
    cur = _run(query)
    results = []
    for r in cur.fetchall():
        avg_gap = float(r["avg_gap"])
        stddev_gap = float(r["stddev_gap"] or 0)
        if stddev_gap > avg_gap * 0.25:
            continue
        frequency = _classify_frequency(avg_gap)
        if not frequency:
            continue
        next_expected_date = r["last_date"] + timedelta(days=_FREQUENCY_DAYS[frequency])
        results.append({
            "description": r["description"],
            "amount": float(r["amount"]),
            "category": r["category"],
            "occurrences": r["occurrences"],
            "last_date": str(r["last_date"]),
            "frequency": frequency,
            "next_expected_date": str(next_expected_date),
        })
    return results


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
    cur = _run(f"UPDATE expenses SET {', '.join(fields)} WHERE id = %s AND deleted_at IS NULL", params)
    if cur.rowcount == 0:
        return {"status": "not_found"}
    return {"status": "updated"}


def delete_expense(id: int) -> dict:
    cur = _run("UPDATE expenses SET deleted_at = NOW() WHERE id = %s AND deleted_at IS NULL", (id,))
    if cur.rowcount == 0:
        return {"status": "not_found"}
    return {"status": "deleted"}


def update_income(
    id: int,
    amount: float = None,
    category: str = None,
    description: str = None,
    date: str = None,
) -> dict:
    # Deliberately does not touch reimburses_expense_id — that stays the exclusive
    # job of link_income_to_expense so the two tools' responsibilities don't overlap.
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

    if not fields:
        return {"status": "nothing to update"}

    params.append(id)
    cur = _run(f"UPDATE income SET {', '.join(fields)} WHERE id = %s AND deleted_at IS NULL", params)
    if cur.rowcount == 0:
        return {"status": "not_found"}
    return {"status": "updated"}


def delete_income(id: int) -> dict:
    cur = _run("UPDATE income SET deleted_at = NOW() WHERE id = %s AND deleted_at IS NULL RETURNING id", (id,))
    if cur.fetchone() is None:
        return {"status": "not_found"}
    return {"status": "deleted"}


def get_budgets() -> list[dict]:
    cur = _run("SELECT category, monthly_limit FROM budgets ORDER BY category")
    return [{"category": r["category"], "monthly_limit": float(r["monthly_limit"])} for r in cur.fetchall()]


def get_budget_status(category: str = None, month: str = None) -> list[dict]:
    """Spend vs. budget for each configured category in a calendar month (defaults to current month)."""
    ref = date.fromisoformat(f"{month}-01") if month else date.today()
    month_start = ref.replace(day=1)
    month_end = _shift_month(month_start, 1)

    # Single JOIN instead of N+1 per-category queries. Each expense's contribution
    # to spent is netted against any income linked to it via reimburses_expense_id,
    # clipped at 0 so a fully-or-over-reimbursed expense can't drag spent negative.
    query = """
        SELECT b.category, b.monthly_limit,
               COALESCE(SUM(GREATEST(e.amount - COALESCE(r.reimbursed, 0), 0)), 0) AS spent
        FROM budgets b
        LEFT JOIN expenses e
               ON LOWER(e.category) = LOWER(b.category)
              AND e.date >= %s AND e.date < %s
              AND e.deleted_at IS NULL
        LEFT JOIN (
            SELECT reimburses_expense_id, SUM(amount) AS reimbursed
            FROM income
            WHERE reimburses_expense_id IS NOT NULL AND deleted_at IS NULL
            GROUP BY reimburses_expense_id
        ) r ON r.reimburses_expense_id = e.id
        WHERE 1=1
    """
    params: list = [month_start.isoformat(), month_end.isoformat()]
    if category:
        query += " AND LOWER(b.category) = LOWER(%s)"
        params.append(category)
    query += " GROUP BY b.category, b.monthly_limit ORDER BY b.category"

    status = []
    for b in _run(query, params).fetchall():
        spent = float(b["spent"])
        limit = float(b["monthly_limit"])
        status.append({
            "category": b["category"],
            "monthly_limit": limit,
            "spent": round(spent, 2),
            "remaining": round(limit - spent, 2),
            "pct_used": round(spent / limit * 100, 1) if limit else 0.0,
            "over_budget": spent > limit,
        })
    return status


# Matches the "near budget" color threshold already used in the frontend
# (BreakdownRow / BudgetSettings) — an insight is only worth surfacing
# unprompted once a category is at least this close to its limit.
INSIGHT_THRESHOLD_PCT = 80

# How many days ahead a recurring charge counts as "coming up" — a reminder
# further out than this isn't actionable yet and would just be noise.
UPCOMING_RECURRING_WINDOW_DAYS = 3


def get_insights() -> list[dict]:
    """Proactive, unprompted signals: budget categories at/over threshold, and
    recurring charges due soon. Each item carries type + key so the frontend
    can render and dismiss budget vs. recurring insights independently, even
    when they'd otherwise collide (e.g. two recurring charges in the same
    category) — key is unique within a single call's result set."""
    insights = []

    for s in get_budget_status():
        if s["pct_used"] >= INSIGHT_THRESHOLD_PCT:
            insights.append({**s, "type": "budget", "key": f"budget:{s['category']}"})

    today = date.today()
    for r in get_recurring_expenses():
        days_until = (date.fromisoformat(r["next_expected_date"]) - today).days
        if 0 <= days_until <= UPCOMING_RECURRING_WINDOW_DAYS:
            insights.append({**r, "type": "recurring", "days_until": days_until, "key": f"recurring:{r['description']}"})

    return insights


def set_budget(category: str, monthly_limit: float) -> dict:
    _run(
        """
        INSERT INTO budgets (category, monthly_limit, updated_at) VALUES (%s, %s, NOW())
        ON CONFLICT (category) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit, updated_at = NOW()
        """,
        (category, monthly_limit),
    )
    return {"status": "saved", "category": category, "monthly_limit": monthly_limit}


def delete_budget(category: str) -> dict:
    _run("DELETE FROM budgets WHERE category = %s", (category,))
    return {"status": "deleted"}


def create_savings_goal(name: str, target_amount: float, target_date: str = None) -> dict:
    cur = _run(
        "INSERT INTO savings_goals (name, target_amount, target_date) VALUES (%s, %s, %s) RETURNING id",
        (name, target_amount, target_date),
    )
    return {"status": "created", "id": cur.fetchone()["id"]}


def get_savings_goals() -> list[dict]:
    cur = _run(
        """
        SELECT id, name, target_amount, target_date, current_amount
        FROM savings_goals
        WHERE deleted_at IS NULL
        ORDER BY created_at
        """
    )
    goals = []
    for g in cur.fetchall():
        row = _row(dict(g))
        if row["target_date"] is not None:
            row["target_date"] = str(row["target_date"])
        row["pct_complete"] = round(min(row["current_amount"] / row["target_amount"], 1) * 100, 1) if row["target_amount"] else 0.0
        goals.append(row)
    return goals


def contribute_to_savings_goal(id: int, amount: float) -> dict:
    """Adjust a goal's saved-so-far amount. amount can be negative (a
    withdrawal); the running total is clipped at 0 either way, since a
    negative progress bar wouldn't mean anything to a saver."""
    cur = _run(
        """
        UPDATE savings_goals
        SET current_amount = GREATEST(current_amount + %s, 0)
        WHERE id = %s AND deleted_at IS NULL
        RETURNING current_amount
        """,
        (amount, id),
    )
    row = cur.fetchone()
    if row is None:
        return {"status": "error", "message": f"No savings goal with id {id}"}
    return {"status": "updated", "current_amount": float(row["current_amount"])}


def delete_savings_goal(id: int) -> dict:
    cur = _run(
        "UPDATE savings_goals SET deleted_at = NOW() WHERE id = %s AND deleted_at IS NULL RETURNING id",
        (id,),
    )
    if cur.fetchone() is None:
        return {"status": "not_found"}
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


def record_usage(user_id: int | None, event_type: str, event_name: str, source: str | None = None) -> None:
    """Best-effort usage logging — never let a logging failure break the
    actual request it's attached to (an edit/delete/tool-call succeeding
    is what matters; the analytics record is secondary)."""
    try:
        _run(
            "INSERT INTO usage_events (user_id, event_type, event_name, source) VALUES (%s, %s, %s, %s)",
            (user_id, event_type, event_name, source),
        )
    except Exception:
        pass


def load_chat_session(user_id: int) -> list:
    cur = _run("SELECT messages FROM chat_sessions WHERE user_id = %s", (user_id,))
    row = cur.fetchone()
    return row["messages"] if row else []


def save_chat_session(user_id: int, messages: list) -> None:
    _run(
        """
        INSERT INTO chat_sessions (user_id, messages, updated_at) VALUES (%s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET messages = EXCLUDED.messages, updated_at = NOW()
        """,
        (user_id, psycopg2.extras.Json(messages)),
    )


def clear_chat_session(user_id: int) -> None:
    _run("DELETE FROM chat_sessions WHERE user_id = %s", (user_id,))


def get_usage_summary(since: str | None = None) -> list[dict]:
    """Event counts grouped by type/name/source, for scripts/usage_report.py."""
    if since:
        cur = _run(
            """
            SELECT event_type, event_name, source, COUNT(*) AS count
            FROM usage_events
            WHERE created_at >= %s
            GROUP BY event_type, event_name, source
            ORDER BY count DESC
            """,
            (since,),
        )
    else:
        cur = _run(
            """
            SELECT event_type, event_name, source, COUNT(*) AS count
            FROM usage_events
            GROUP BY event_type, event_name, source
            ORDER BY count DESC
            """
        )
    return [dict(r) for r in cur.fetchall()]
