from agent.db import get_expenses, save_expense

TOOL_DEFINITIONS = [
    {
        "name": "save_expense",
        "description": "Save a parsed expense to the database",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount":      {"type": "number", "description": "Amount in dollars"},
                "category":    {"type": "string", "description": "e.g. Food, Transport, Entertainment"},
                "description": {"type": "string", "description": "Short description of the expense"},
                "date":        {"type": "string", "description": "ISO date, e.g. 2025-01-13"},
            },
            "required": ["amount", "category", "description", "date"],
        },
    },
    {
        "name": "get_expenses",
        "description": "Query expenses from the database. Use this to answer questions about spending.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Filter from this ISO date (inclusive)"},
                "end_date":   {"type": "string", "description": "Filter to this ISO date (inclusive)"},
                "category":   {"type": "string", "description": "Filter by category name"},
            },
            "required": [],
        },
    },
]

TOOL_HANDLERS = {
    "save_expense": save_expense,
    "get_expenses": get_expenses,
}
