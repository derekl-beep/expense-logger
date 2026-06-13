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
