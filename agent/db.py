import sqlite3

conn = sqlite3.connect("expenses.db", check_same_thread=False)
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


def update_expense(id: int, amount: float = None, category: str = None, description: str = None, date: str = None) -> dict:
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
