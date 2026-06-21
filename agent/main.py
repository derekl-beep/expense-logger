import os
from datetime import date

import anthropic
from dotenv import load_dotenv

from agent.categories import CATEGORY_HINTS
from agent.tools import TOOL_DEFINITIONS, TOOL_HANDLERS

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM = """You are a personal expense tracking assistant.
When the user describes an expense, extract the details and call save_expense.
Resolve vague dates like 'today' or 'yesterday'. Today's date is {today}.
After saving, confirm with a friendly one-line message.

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


def chat(user_input: str, user_id: int) -> str:
    messages = _sessions.setdefault(str(user_id), [])
    messages.append({"role": "user", "content": user_input})

    while True:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM.format(today=date.today().isoformat(), category_hints=CATEGORY_HINTS),
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


def stream_chat(user_input: str, user_id: int):
    messages = _sessions.setdefault(str(user_id), [])
    messages.append({"role": "user", "content": user_input})

    while True:
        with client.messages.stream(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM.format(today=date.today().isoformat(), category_hints=CATEGORY_HINTS),
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
