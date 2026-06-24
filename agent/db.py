import calendar
import os
from datetime import date, timedelta

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


def get_expenses(
    start_date: str = None,
    end_date: str = None,
    category: str = None,
    logged_by: str = None,
    min_amount: float = None,
    max_amount: float = None,
    flagged: bool = None,
) -> list[dict]:
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
    if min_amount is not None:
        query += " AND e.amount >= %s"
        params.append(min_amount)
    if max_amount is not None:
        query += " AND e.amount <= %s"
        params.append(max_amount)
    if flagged is not None:
        query += " AND e.flagged = %s"
        params.append(flagged)
    query += " ORDER BY e.date DESC, e.id DESC"
    cur = _run(query, params)
    return [_row(r) for r in cur.fetchall()]


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
        WHERE 1=1
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
        WHERE e.date >= %s
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
        "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE LOWER(category) = LOWER(%s) AND date >= %s AND date <= %s",
        (category, month_start.isoformat(), ref.isoformat()),
    )
    spent_so_far = float(cur.fetchone()["total"])
    projected_total = round(spent_so_far / days_elapsed * days_in_month, 2) if days_elapsed else 0.0

    prior_months = []
    for i in range(1, compare_months + 1):
        m_start = _shift_month(month_start, -i)
        m_end = _shift_month(month_start, -i + 1) - timedelta(days=1)
        cur = _run(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE LOWER(category) = LOWER(%s) AND date >= %s AND date <= %s",
            (category, m_start.isoformat(), m_end.isoformat()),
        )
        prior_months.append({"month": m_start.isoformat()[:7], "total": float(cur.fetchone()["total"])})

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

    def _week_total(start: date, end: date) -> float:
        query = "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date >= %s AND date <= %s"
        params = [start.isoformat(), end.isoformat()]
        if category:
            query += " AND LOWER(category) = LOWER(%s)"
            params.append(category)
        cur = _run(query, params)
        return float(cur.fetchone()["total"])

    spent_so_far = _week_total(week_start, ref)
    projected_total = round(spent_so_far / days_elapsed * 7, 2) if days_elapsed else 0.0

    prior_weeks = []
    for i in range(1, compare_weeks + 1):
        w_start = week_start - timedelta(weeks=i)
        w_end = w_start + timedelta(days=6)
        prior_weeks.append({"week_start": w_start.isoformat(), "total": _week_total(w_start, w_end)})

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
        query = "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses e LEFT JOIN users u ON e.user_id = u.id WHERE e.date >= %s AND e.date <= %s"
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
            WHERE 1=1
        """
    else:
        query = """
            SELECT e.id, e.amount, e.category, e.description, e.date, u.username AS logged_by
            FROM expenses e
            LEFT JOIN users u ON e.user_id = u.id
            WHERE 1=1
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
    query += " GROUP BY u.username ORDER BY total DESC"
    cur = _run(query, params)
    return [{"logged_by": r["logged_by"], "total": float(r["total"]), "count": r["count"]} for r in cur.fetchall()]


_WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def get_weekday_pattern(start_date: str = None, end_date: str = None, category: str = None, logged_by: str = None) -> list[dict]:
    query = """
        SELECT EXTRACT(DOW FROM e.date)::int AS dow, SUM(e.amount) AS total, COUNT(*) AS count
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
