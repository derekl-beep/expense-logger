import os
from datetime import date

import anthropic
from dotenv import load_dotenv

from agent.tools import TOOL_DEFINITIONS, TOOL_HANDLERS

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM = """You are a personal expense tracking assistant.
When the user describes an expense, extract the details and call save_expense.
Infer the category from context. Resolve vague dates like 'today' or 'yesterday'.
Today's date is {today}. After saving, confirm with a friendly one-line message."""


messages: list = []


def chat(user_input: str) -> str:
    messages.append({"role": "user", "content": user_input})

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM.format(today=date.today().isoformat()),
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text

        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    handler = TOOL_HANDLERS[block.name]
                    result = handler(**block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": str(result),
                    })

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
