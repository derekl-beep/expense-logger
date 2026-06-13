import sqlite3

conn = sqlite3.connect("expenses.db")
conn.row_factory = sqlite3.Row

conn.execute("""
    CREATE TABLE IF NOT EXISTS expenses (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        amount      REAL,
        category    TEXT,
        description TEXT,
        date        TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
""")
conn.commit()


def save_expense(amount: float, category: str, description: str, date: str) -> dict:
    conn.execute(
        "INSERT INTO expenses (amount, category, description, date) VALUES (?, ?, ?, ?)",
        (amount, category, description, date),
    )
    conn.commit()
    return {"status": "saved"}


def get_expenses(start_date: str = None, end_date: str = None, category: str = None) -> list[dict]:
    query = "SELECT id, amount, category, description, date FROM expenses WHERE 1=1"
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
