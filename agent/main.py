import os
from datetime import date

import anthropic
from dotenv import load_dotenv

from agent.categories import CATEGORY_HINTS
from agent.tools import TOOL_DEFINITIONS, TOOL_HANDLERS

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM = """You are a personal expense tracking assistant for {username}.
Today's date is {today}.

## Logging expenses
When the user describes one or more expenses, extract each one and call save_expense for each.
Resolve vague dates like 'today', 'yesterday', or 'last Monday' to an ISO date.
When a bare weekday name is given (e.g. "Friday", "Fri"), always assume the most recent past occurrence — never ask for clarification.
After saving, confirm with a short, friendly message (one line per expense is fine).

## Querying expenses
When the user asks about spending, call get_expenses with appropriate filters.
Use logged_by to filter by who logged the expense (e.g. "derek" or "kelly").
Present results clearly with a total where useful.

## Editing and flagging
To update or flag an expense, first call get_expenses to find the right record, then call update_expense.
If the user refers to "the last one", "that expense", or similar, call get_expenses (no filters, most recent first) to identify it by context.
Flagging marks an expense for follow-up (flagged=true). Unflagging clears it (flagged=false).

## Deleting
To delete, first call get_expenses to find the ID, then call delete_expense.

{category_hints}"""


# Conversation history keyed by session_id. Replaced by user_id in Phase 2 (auth).
_sessions: dict[str, list] = {}


def _run_tools(response_content: list, user_id: int) -> list:
    tool_results = []
    for block in response_content:
        if block.type == "tool_use":
            kwargs = dict(block.input)
            if block.name == "save_expense":
                kwargs["user_id"] = user_id
            result = TOOL_HANDLERS[block.name](**kwargs)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(result),
            })
    return tool_results


def chat(user_input: str, user_id: int, username: str = "user") -> str:
    messages = _sessions.setdefault(str(user_id), [])
    messages.append({"role": "user", "content": user_input})

    while True:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            system=SYSTEM.format(today=date.today().isoformat(), username=username, category_hints=CATEGORY_HINTS),
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text

        if response.stop_reason == "tool_use":
            tool_results = _run_tools(response.content, user_id)
            messages.append({"role": "user", "content": tool_results})


def stream_chat(user_input: str, user_id: int, username: str = "user"):
    messages = _sessions.setdefault(str(user_id), [])
    messages.append({"role": "user", "content": user_input})

    while True:
        with client.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            system=SYSTEM.format(today=date.today().isoformat(), username=username, category_hints=CATEGORY_HINTS),
            tools=TOOL_DEFINITIONS,
            messages=messages,
        ) as stream:
            for chunk in stream.text_stream:
                yield chunk
            final = stream.get_final_message()

        messages.append({"role": "assistant", "content": final.content})

        if final.stop_reason == "end_turn":
            break

        if final.stop_reason == "tool_use":
            tool_results = _run_tools(final.content, user_id)
            messages.append({"role": "user", "content": tool_results})


if __name__ == "__main__":
    print("Expense Logger — type your expense, or Ctrl+C to quit.\n")
    while True:
        try:
            user = input("You: ").strip()
            if user:
                print(f"Agent: {chat(user)}")
        except KeyboardInterrupt:
            print("\nBye!")
            break
