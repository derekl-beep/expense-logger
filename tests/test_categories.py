from agent.categories import (
    CATEGORIES,
    CATEGORY_HINTS,
    INCOME_CATEGORIES,
    INCOME_CATEGORY_HINTS,
)


def _hint_names(hints: str) -> list[str]:
    """Extract category names, in order, from '- Name: description' bullet lines."""
    names = []
    for line in hints.splitlines():
        line = line.strip()
        if line.startswith("- "):
            names.append(line[2:].split(":", 1)[0].strip())
    return names


def _hint_map(hints: str) -> dict[str, str]:
    result = {}
    for line in hints.splitlines():
        line = line.strip()
        if line.startswith("- "):
            name, _, desc = line[2:].partition(":")
            result[name.strip()] = desc.strip()
    return result


# --- expense CATEGORIES / CATEGORY_HINTS pairing ---------------------------

def test_expense_categories_each_have_exactly_one_hint_line():
    assert _hint_names(CATEGORY_HINTS) == CATEGORIES


# --- income INCOME_CATEGORIES / INCOME_CATEGORY_HINTS pairing --------------

def test_income_categories_each_have_exactly_one_hint_line():
    assert _hint_names(INCOME_CATEGORY_HINTS) == INCOME_CATEGORIES


def test_income_categories_is_a_closed_list_distinct_from_expense_categories():
    # Income and expense categories are separate closed lists — no accidental sharing.
    assert set(INCOME_CATEGORIES).isdisjoint(CATEGORIES)


def test_reimbursement_and_transfer_hints_are_distinct():
    hints = _hint_map(INCOME_CATEGORY_HINTS)
    assert "Reimbursement" in hints
    assert "Transfer" in hints
    assert hints["Reimbursement"] != hints["Transfer"]
    # Reimbursement is tied to an expense you already logged; Transfer explicitly
    # is not tied to one.
    assert "already logged" in hints["Reimbursement"].lower()
    assert "isn't a reimbursement" in hints["Transfer"].lower()
