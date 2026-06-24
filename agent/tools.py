from agent.categories import CATEGORIES
from agent.db import (
    delete_expense,
    find_similar_expenses,
    get_category_breakdown,
    get_expenses,
    get_monthly_trend,
    get_run_rate,
    get_top_expenses,
    get_user_breakdown,
    get_weekday_pattern,
    save_expense,
    update_expense,
)

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
        "name": "find_similar_expense",
        "description": "Fuzzy-search past expense descriptions for vendor/category recall (e.g. matching 'Starbucks' against a previously logged 'Coffee at Starbucks'). Call this before asking the user for a category when logging a new expense. Returns an empty list if nothing matches closely — in that case, categorize from your own knowledge of the vendor instead of asking.",
        "input_schema": {
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "The new expense's description or vendor name to match against history"},
            },
            "required": ["description"],
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
        "name": "get_category_breakdown",
        "description": "Get exact spending totals per category for a date range, computed in the database (not by manual addition). Use this for any 'summarize'/'breakdown by category' request — report the numbers it returns exactly as given, don't re-tally them yourself.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Filter from this ISO date (inclusive)"},
                "end_date":   {"type": "string", "description": "Filter to this ISO date (inclusive)"},
                "logged_by":  {"type": "string", "description": "Filter by the username who logged the expense"},
            },
            "required": [],
        },
    },
    {
        "name": "get_monthly_trend",
        "description": "Get total spending per calendar month over the last N months, optionally for one category. Use for questions like 'has my dining spending changed over time'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category":  {**_category_enum, "description": "Limit to this category; omit for total spending across all categories"},
                "months":    {"type": "integer", "description": "How many months back to include, ending with the current month (default 6)"},
                "logged_by": {"type": "string", "description": "Filter by the username who logged the expense"},
            },
            "required": [],
        },
    },
    {
        "name": "get_run_rate",
        "description": "Project a category's full-month spend from its month-to-date total, and compare against prior months. Use for 'run rate' / 'how much will I spend on X this month' / 'is my X spending up vs last month' questions. The projection and comparison are computed exactly — report them as returned.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category":       {**_category_enum, "description": "Category to project"},
                "reference_date": {"type": "string", "description": "ISO date to treat as 'today' (defaults to the actual current date)"},
                "compare_months": {"type": "integer", "description": "How many prior months to compare against (default 3)"},
            },
            "required": ["category"],
        },
    },
    {
        "name": "get_top_expenses",
        "description": "Get the largest expenses in a date range — either individual transactions (by_vendor=false) or vendors/descriptions totaled together (by_vendor=true). Use for 'where's my money going' or 'what's my biggest purchase' questions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Filter from this ISO date (inclusive)"},
                "end_date":   {"type": "string", "description": "Filter to this ISO date (inclusive)"},
                "category":   {**_category_enum, "description": "Filter by category"},
                "logged_by":  {"type": "string", "description": "Filter by the username who logged the expense"},
                "limit":      {"type": "integer", "description": "How many results to return (default 5)"},
                "by_vendor":  {"type": "boolean", "description": "Group by description/vendor and sum (true) instead of returning individual largest transactions (false, default)"},
            },
            "required": [],
        },
    },
    {
        "name": "get_user_breakdown",
        "description": "Get spending totals per user who logged expenses, for a date range. This is a shared household tracker — use this for 'who spent more' questions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Filter from this ISO date (inclusive)"},
                "end_date":   {"type": "string", "description": "Filter to this ISO date (inclusive)"},
                "category":   {**_category_enum, "description": "Filter by category"},
            },
            "required": [],
        },
    },
    {
        "name": "get_weekday_pattern",
        "description": "Get spending totals grouped by day of week, for a date range. Use for questions about spending patterns across the week (e.g. weekday vs weekend dining).",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "Filter from this ISO date (inclusive)"},
                "end_date":   {"type": "string", "description": "Filter to this ISO date (inclusive)"},
                "category":   {**_category_enum, "description": "Filter by category"},
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
    "save_expense":           save_expense,
    "find_similar_expense":   find_similar_expenses,
    "get_expenses":           get_expenses,
    "get_category_breakdown": get_category_breakdown,
    "get_monthly_trend":      get_monthly_trend,
    "get_run_rate":           get_run_rate,
    "get_top_expenses":       get_top_expenses,
    "get_user_breakdown":     get_user_breakdown,
    "get_weekday_pattern":    get_weekday_pattern,
    "update_expense":         update_expense,
    "delete_expense":         delete_expense,
}
