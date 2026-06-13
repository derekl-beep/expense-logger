from agent.db import save_expense

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
    }
]

TOOL_HANDLERS = {
    "save_expense": save_expense,
}
