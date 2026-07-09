import os
from datetime import date

import anthropic
from dotenv import load_dotenv

from agent.categories import CATEGORY_HINTS, INCOME_CATEGORY_HINTS
from agent.tools import TOOL_DEFINITIONS, TOOL_HANDLERS

load_dotenv()

client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

SYSTEM = """You are a personal expense tracking assistant for {username}.
Today's date is {today}.

## Logging expenses
When the user describes one or more expenses, extract each one and call save_expense for each.
Resolve vague dates like 'today', 'yesterday', or 'last Monday' to an ISO date.
Write descriptions as concise noun phrases in title case (capitalize all words except prepositions like "at", "for", "the", "of"). Use the pattern "[What] at [Venue]" when there's a place (e.g. "Dinner at Fat Rabbit", "Coffee at M Cha Bar", "Gas at Shell"). For no-venue expenses use a brief description of what was bought (e.g. "Anthropic API Credits", "BBQ Chicken Delivery").
When a bare weekday name is given (e.g. "Friday", "Fri"), always assume the most recent past occurrence — never ask for clarification.
After saving, confirm with a short, friendly message (one line per expense is fine).
If save_expense returns possible_duplicate_of, it has already flagged both the new and the matched older expense for review — don't ask the user to confirm or undo this, just mention briefly that it looks like a possible duplicate of an earlier expense and has been flagged.

### Choosing a category
For every expense, call find_similar_expense with its description (or vendor name) before deciding on a category — do this even if you're already confident what the category should be, since the user may have categorized this vendor differently than you'd assume. If it returns a match with a high score (roughly 0.35+), reuse that match's category directly. If it returns nothing useful, fall back to your own knowledge of the vendor (e.g. you know "Tims" means Tim Hortons, a coffee shop) to pick the best category. Only ask the user if you genuinely cannot infer a category either way.

## Logging income
When the user describes money they received, or when parsing pasted bank/transaction text, credit/deposit lines should be classified as income (call save_income) rather than expense — never call save_expense for money coming in. Use the same date resolution rules and the same title-case "[What] at [Venue]"-style description convention as expenses.
For example: a line like "Jul 5  Payroll Deposit  +2,500.00" is a credit, so call save_income with category Salary and a description like "Payroll Deposit". A line like "Jul 6  E-Transfer from Jake  +40.00" — if it matches an expense you can find already logged (e.g. call get_expenses to check for a same-amount-range dinner/shared cost with Jake), use category Reimbursement, a description like "Reimbursement from Jake", and pass that expense's id as reimburses_expense_id on save_income so it's linked. If it doesn't match anything already logged (e.g. a roommate's bill share you never logged as your own expense, or you can't find a confident single match), use category Transfer instead and omit reimburses_expense_id — don't guess a link without a specific logged expense to point to.
If the user later says a reimbursement was for a different expense than logged, or wasn't linked but should be (e.g. "that $40 from Jake was actually for the dinner on the 4th, not the 6th"), call get_income and/or get_expenses to confirm the exact ids, then call link_income_to_expense to fix it. Pass expense_id omitted (or null) to unlink.
{income_category_hints}

## Querying expenses
For category/date-range summaries (e.g. "summarize this month", "breakdown by category"), call get_category_breakdown and report its numbers exactly as returned — never tally amounts yourself from get_expenses rows, that's unreliable over more than a couple of items.
For spending trends across multiple months (e.g. "has my dining spending gone up"), call get_monthly_trend.
For projections (e.g. "what will I spend on X this month", "is my X run rate higher than last month"), call get_run_rate and report its projected_total and comparison exactly as returned.
For weekly pace questions (e.g. "am I on pace this week", "is my dining spending up vs last week"), call get_weekly_pace and report its projected_total and comparison exactly as returned.
For year-over-year questions (e.g. "is this June higher than last June"), call get_yoy_comparison and report its totals and pct_change exactly as returned.
For "where's my money going" or biggest-purchase questions, call get_top_expenses (by_vendor=true to group by vendor, false for individual largest transactions).
For "who's spending more" questions (this is a shared household tracker), call get_user_breakdown.
For day-of-week spending pattern questions, call get_weekday_pattern.
For anything else — finding a specific expense, listing recent transactions, lookups before an update/delete — call get_expenses with appropriate filters. Use logged_by to filter by who logged the expense (e.g. "derek" or "kelly"), min_amount/max_amount for amount-range questions (e.g. "expenses over $100"), flagged to list everything still flagged for review, and description_contains for vendor/text lookups (e.g. "what did I spend at Costco").
For "what's my average X" / "how much do I typically spend on X" questions, call get_average_transaction and report its average exactly as returned — don't average raw rows yourself.
Present results clearly with a total where useful.
For questions about income received (e.g. "how much did I get paid this month", "show my income"), call get_income with appropriate filters.

## Budgets
For budget questions (e.g. "am I over budget", "how much do I have left for groceries"), call get_budget_status. Only categories with a budget configured are returned — if a category isn't in the result, tell the user it has no budget set rather than guessing a limit.
To set or change a monthly limit (e.g. "set my dining budget to $400"), call set_budget. To remove a budget entirely, call delete_budget.
get_budget_status's spent figure is net of any linked reimbursements (see Logging income) — a $60 expense with a $30 linked reimbursement counts as $30 spent, reflecting the expense's own month regardless of when the reimbursement was recorded or linked. This differs from get_category_breakdown, get_monthly_trend, and the other historical-spend tools below, which always report the gross amount actually paid. If a user notices the numbers don't match for the same category/month, explain the difference rather than guessing one of them is wrong.

## Editing and flagging
save_expense returns the new expense's id. If you need to immediately update the just-saved expense (e.g. flag it), use that id directly with update_expense — never call get_expenses to find it.
For all other edits and flags, call get_expenses to find the right record first, then call update_expense.
If the user refers to "the last one", "that expense", or similar, call get_expenses (no filters, most recent first) to identify it by context.
Flagging marks an expense for follow-up (flagged=true). Unflagging clears it (flagged=false).

Income entries can be edited too. save_income returns the new income entry's id — use that id directly with update_income if editing immediately after saving, otherwise call get_income first to find the right id. update_income never changes an entry's reimbursement link (reimburses_expense_id); if the user wants to change what an income entry reimburses, use link_income_to_expense instead (see Logging income).

There are five tools split cleanly by table: update_expense and delete_expense only ever operate on expenses; update_income, delete_income, and link_income_to_expense only ever operate on income. Expense ids and income ids are separate sequences that collide (e.g. expense id 7 and income id 7 can both exist and refer to unrelated rows) — never pass an id you got from get_expenses or save_expense as the income_id/id argument to update_income, delete_income, or link_income_to_expense, and never pass an id you got from get_income or save_income as the id argument to update_expense or delete_expense.

## Receipt / screenshot scanning
When the user's message contains extracted text from one or more images (prefixed with "[Extracted text from image...]"), parse each block for expense line items. Read dates and amounts exactly as shown — do not approximate. For category, use your best judgement.
When multiple images are attached, the same transaction can appear in more than one block — this happens when someone screenshots overlapping date ranges of the same account. Before calling save_expense or save_income, compare line items across all the blocks in this message; if two entries (expense or income) share the same date, amount, and description, treat them as the same transaction and save it only once. This applies just as much to pasted bank/transaction text as to screenshots — check for overlap within a single pasted statement too.

## Deleting
To delete an expense, first call get_expenses to find the ID, then call delete_expense.
To delete an income entry, first call get_income to find the ID, then call delete_income. Remember expense ids and income ids are separate sequences — see above.

{category_hints}"""


# Conversation history keyed by user_id.
_sessions: dict[str, list] = {}
HISTORY_LIMIT = 30   # max messages passed to the API per turn
_SESSION_CAP = 120   # trim stored history once it exceeds this to prevent unbounded growth
API_TIMEOUT = 120.0  # seconds before giving up on a Claude API call
MODEL_DEFAULT = "claude-haiku-4-5-20251001"
MODEL_VISION = "claude-sonnet-4-6"  # better accuracy for reading text in images


MAX_IMAGES = 6

# Friendly status labels shown in the UI while a tool call is in flight.
TOOL_STATUS_LABELS = {
    "save_expense": "Saving expense…",
    "save_income": "Saving income…",
    "find_similar_expense": "Checking vendor history…",
    "update_expense": "Updating expense…",
    "delete_expense": "Deleting expense…",
    "update_income": "Updating income…",
    "delete_income": "Deleting income…",
    "get_expenses": "Looking up expenses…",
    "get_income": "Looking up income…",
    "link_income_to_expense": "Linking reimbursement…",
    "get_category_breakdown": "Calculating breakdown…",
    "get_monthly_trend": "Analyzing spending trend…",
    "get_run_rate": "Projecting month-end total…",
    "get_weekly_pace": "Projecting week pace…",
    "get_yoy_comparison": "Comparing to last year…",
    "get_top_expenses": "Finding top expenses…",
    "get_user_breakdown": "Comparing spending by person…",
    "get_weekday_pattern": "Analyzing day-of-week pattern…",
    "get_budget_status": "Checking budget status…",
    "set_budget": "Updating budget…",
    "delete_budget": "Removing budget…",
    "get_average_transaction": "Calculating average…",
    "get_recurring_expenses": "Checking recurring charges…",
}


def _trim_session(messages: list) -> None:
    """Drop oldest messages when history grows beyond _SESSION_CAP to bound memory use."""
    if len(messages) > _SESSION_CAP:
        messages[:] = messages[-HISTORY_LIMIT:]


def _ocr_image(image_data: str, image_media_type: str) -> str:
    response = client.messages.create(
        model=MODEL_VISION,
        max_tokens=1024,
        timeout=API_TIMEOUT,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": image_media_type, "data": image_data}},
                {"type": "text", "text": "Extract all text from this image exactly as it appears. Preserve all numbers, dates, and formatting precisely. Output only the extracted text, nothing else."},
            ],
        }],
    )
    return response.content[0].text


def _build_user_content(user_input: str, images: list[dict] | None) -> str:
    if not images:
        return user_input
    images = images[:MAX_IMAGES]
    parts = [user_input]
    multiple = len(images) > 1
    for i, img in enumerate(images, 1):
        ocr_text = _ocr_image(img["data"], img["media_type"])
        label = f"[Extracted text from image {i} of {len(images)}:]" if multiple else "[Extracted text from image:]"
        parts.append(f"{label}\n{ocr_text}")
    return "\n\n".join(parts)


def _run_tools(response_content: list, user_id: int, on_result=None) -> list:
    tool_results = []
    for block in response_content:
        if block.type == "tool_use":
            kwargs = dict(block.input)
            if block.name in ("save_expense", "save_income"):
                kwargs["user_id"] = user_id
            result = TOOL_HANDLERS[block.name](**kwargs)
            print(f"[tool] {block.name}({kwargs}) -> {result}")
            if on_result:
                on_result(block.name, result)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(result),
            })
    return tool_results


def clear_session(user_id: int) -> None:
    _sessions.pop(str(user_id), None)


def chat(user_input: str, user_id: int, username: str = "user", images: list[dict] | None = None) -> str:
    messages = _sessions.setdefault(str(user_id), [])
    content = _build_user_content(user_input, images)
    messages.append({"role": "user", "content": content})
    _trim_session(messages)

    while True:
        response = client.messages.create(
            model=MODEL_DEFAULT,
            max_tokens=2048,
            timeout=API_TIMEOUT,
            system=SYSTEM.format(
                today=date.today().isoformat(),
                username=username,
                category_hints=CATEGORY_HINTS,
                income_category_hints=INCOME_CATEGORY_HINTS,
            ),
            tools=TOOL_DEFINITIONS,
            messages=messages[-HISTORY_LIMIT:],
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            for block in response.content:
                if hasattr(block, "text"):
                    return block.text

        if response.stop_reason == "tool_use":
            tool_results = _run_tools(response.content, user_id)
            messages.append({"role": "user", "content": tool_results})


def stream_chat(user_input: str, user_id: int, username: str = "user", images: list[dict] | None = None):
    messages = _sessions.setdefault(str(user_id), [])
    if images:
        yield {"status": "Reading image…" if len(images) == 1 else "Reading images…"}
    content = _build_user_content(user_input, images)
    messages.append({"role": "user", "content": content})
    _trim_session(messages)

    last_char = ""
    while True:
        with client.messages.stream(
            model=MODEL_DEFAULT,
            max_tokens=2048,
            timeout=API_TIMEOUT,
            system=SYSTEM.format(
                today=date.today().isoformat(),
                username=username,
                category_hints=CATEGORY_HINTS,
                income_category_hints=INCOME_CATEGORY_HINTS,
            ),
            tools=TOOL_DEFINITIONS,
            messages=messages[-HISTORY_LIMIT:],
        ) as stream:
            first_chunk_of_turn = True
            for chunk in stream.text_stream:
                if not chunk:
                    continue
                # Each turn streams independently, so the model can end one turn
                # with "...today." and start the next (post-tool_use) with "Done!"
                # with no space in between. Only check at the turn boundary —
                # chunks within a single turn are exact slices of one continuous
                # string and always join up correctly on their own.
                if first_chunk_of_turn and last_char and not last_char.isspace() and not chunk[0].isspace():
                    yield {"text": " "}
                yield {"text": chunk}
                last_char = chunk[-1]
                first_chunk_of_turn = False
            final = stream.get_final_message()

        messages.append({"role": "assistant", "content": final.content})

        if final.stop_reason == "end_turn":
            break

        if final.stop_reason == "tool_use":
            for block in final.content:
                if block.type == "tool_use":
                    yield {"status": TOOL_STATUS_LABELS.get(block.name, "Working…")}

            rich_events = []

            def _capture_rich_result(name, result):
                if name == "get_category_breakdown":
                    rich_events.append({"breakdown": result})

            tool_results = _run_tools(final.content, user_id, on_result=_capture_rich_result)
            messages.append({"role": "user", "content": tool_results})
            yield from rich_events


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
