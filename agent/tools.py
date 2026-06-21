from agent.categories import CATEGORIES
from agent.db import delete_expense, get_expenses, save_expense, update_expense

_category_enum = {"type": "string", "enum": CATEGORIES}

TOOL_DEFINITIONS = [
    {
        "name": "save_expense",
        "description": "Save a parsed expense to the database",
        "input_schema": {
            "type": "object",
            "properties": {
                "amount":      {"type": "number", "description": "Amount in dollars"},
                "category":   {**_category_enum, "description": "Expense category"},
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
                "logged_by":  {"type": "string", "description": "Filter by the username who logged the expense"},
            },
            "required": [],
        },
    },
    {
        "name": "update_expense",
        "description": "Update fields on an existing expense by its ID. First call get_expenses to find the ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id":          {"type": "integer", "description": "The expense ID to update"},
                "amount":      {"type": "number",  "description": "New amount in dollars"},
                "category":   {**_category_enum, "description": "New category"},
                "description": {"type": "string",  "description": "New description"},
                "date":        {"type": "string",  "description": "New ISO date"},
                "flagged":     {"type": "boolean", "description": "Flag or unflag the expense for follow-up"},
            },
            "required": ["id"],
        },
    },
    {
        "name": "delete_expense",
        "description": "Delete an expense by its ID. First call get_expenses to find the ID.",
        "input_schema": {
            "type": "object",
            "properties": {
                "id": {"type": "integer", "description": "The expense ID to delete"},
            },
            "required": ["id"],
        },
    },
]

TOOL_HANDLERS = {
    "save_expense":   save_expense,
    "get_expenses":   get_expenses,
    "update_expense": update_expense,
    "delete_expense": delete_expense,
}
