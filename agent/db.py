import sqlite3

conn = sqlite3.connect("expenses.db", check_same_thread=False)
conn.row_factory = sqlite3.Row

conn.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")

conn.execute("""
    CREATE TABLE IF NOT EXISTS expenses (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        amount      REAL,
        category    TEXT,
        description TEXT,
        date        TEXT,
        flagged     INTEGER DEFAULT 0,
        user_id     INTEGER REFERENCES users(id),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")
for col, definition in [
    ("flagged", "INTEGER DEFAULT 0"),
    ("user_id", "INTEGER REFERENCES users(id)"),
]:
    try:
        conn.execute(f"ALTER TABLE expenses ADD COLUMN {col} {definition}")
    except Exception:
        pass  # column already exists
conn.commit()


def get_user_by_username(username: str) -> dict | None:
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    return dict(row) if row else None


def save_expense(amount: float, category: str, description: str, date: str, user_id: int = None) -> dict:
    conn.execute(
        "INSERT INTO expenses (amount, category, description, date, user_id) VALUES (?, ?, ?, ?, ?)",
        (amount, category, description, date, user_id),
    )
    conn.commit()
    return {"status": "saved"}


def get_expenses(start_date: str = None, end_date: str = None, category: str = None) -> list[dict]:
    query = "SELECT id, amount, category, description, date, flagged FROM expenses WHERE 1=1"
    params = []

    if start_date:
        query += " AND date >= ?"
        params.append(start_date)
    if end_date:
        query += " AND date <= ?"
        params.append(end_date)
    if category:
        query += " AND LOWER(category) = LOWER(?)"
        params.append(category)

    query += " ORDER BY date DESC"
    rows = conn.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def update_expense(id: int, amount: float = None, category: str = None, description: str = None, date: str = None, flagged: bool = None) -> dict:
    fields, params = [], []
    if amount is not None:
        fields.append("amount = ?")
        params.append(amount)
    if category is not None:
        fields.append("category = ?")
        params.append(category)
    if description is not None:
        fields.append("description = ?")
        params.append(description)
    if date is not None:
        fields.append("date = ?")
        params.append(date)
    if flagged is not None:
        fields.append("flagged = ?")
        params.append(1 if flagged else 0)

    if not fields:
        return {"status": "nothing to update"}

    params.append(id)
    conn.execute(f"UPDATE expenses SET {', '.join(fields)} WHERE id = ?", params)
    conn.commit()
    return {"status": "updated"}


def delete_expense(id: int) -> dict:
    conn.execute("DELETE FROM expenses WHERE id = ?", (id,))
    conn.commit()
    return {"status": "deleted"}


def clear_expenses() -> dict:
    conn.execute("DELETE FROM expenses")
    conn.commit()
    return {"status": "cleared"}
