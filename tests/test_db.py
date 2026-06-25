from agent import db


def add_expense(user_id, amount, category, description, day):
    return db.save_expense(amount, category, description, day, user_id=user_id)


# --- budgets -----------------------------------------------------------

def test_set_get_delete_budget():
    assert db.get_budgets() == []

    db.set_budget("Dining", 200)
    assert db.get_budgets() == [{"category": "Dining", "monthly_limit": 200.0}]

    db.delete_budget("Dining")
    assert db.get_budgets() == []


def test_set_budget_upserts_existing_category():
    db.set_budget("Dining", 200)
    db.set_budget("Dining", 300)
    assert db.get_budgets() == [{"category": "Dining", "monthly_limit": 300.0}]


def test_get_budgets_ordered_alphabetically():
    db.set_budget("Travel", 500)
    db.set_budget("Dining", 200)
    assert [b["category"] for b in db.get_budgets()] == ["Dining", "Travel"]


# --- save_expense / duplicate detection ---------------------------------

def test_save_expense_basic(user_id):
    result = add_expense(user_id, 12.50, "Dining", "Lunch at Cafe", "2026-06-10")
    assert result["status"] == "saved"
    assert "possible_duplicate_of" not in result

    expenses = db.get_expenses()
    assert len(expenses) == 1
    assert expenses[0]["amount"] == 12.50
    assert expenses[0]["category"] == "Dining"


def test_save_expense_capitalizes_description(user_id):
    add_expense(user_id, 10, "Dining", "lunch at cafe", "2026-06-10")
    assert db.get_expenses()[0]["description"] == "Lunch at cafe"


def test_save_expense_flags_likely_duplicate(user_id):
    first = add_expense(user_id, 12.50, "Dining", "Lunch at Cafe", "2026-06-10")
    second = add_expense(user_id, 12.50, "Dining", "Lunch at Cafe", "2026-06-10")

    assert "possible_duplicate_of" in second
    assert second["possible_duplicate_of"] == first["id"]

    expenses = {e["id"]: e for e in db.get_expenses()}
    assert expenses[first["id"]]["flagged"] is True
    assert expenses[second["id"]]["flagged"] is True


def test_save_expense_does_not_flag_distinct_expenses(user_id):
    add_expense(user_id, 12.50, "Dining", "Lunch at Cafe", "2026-06-10")
    add_expense(user_id, 45.00, "Groceries", "Weekly groceries", "2026-06-11")

    assert all(e["flagged"] is False for e in db.get_expenses())


# --- update / delete -----------------------------------------------------

def test_update_expense_partial_fields(user_id):
    saved = add_expense(user_id, 10, "Dining", "Coffee", "2026-06-10")
    db.update_expense(saved["id"], amount=15, flagged=True)

    row = db.get_expenses()[0]
    assert row["amount"] == 15
    assert row["flagged"] is True
    assert row["category"] == "Dining"  # untouched fields preserved


def test_update_expense_with_no_fields_is_noop(user_id):
    saved = add_expense(user_id, 10, "Dining", "Coffee", "2026-06-10")
    result = db.update_expense(saved["id"])
    assert result == {"status": "nothing to update"}


def test_delete_expense(user_id):
    saved = add_expense(user_id, 10, "Dining", "Coffee", "2026-06-10")
    db.delete_expense(saved["id"])
    assert db.get_expenses() == []


# --- get_category_breakdown ---------------------------------------------

def test_category_breakdown_totals_and_pct(user_id):
    add_expense(user_id, 100, "Dining", "A", "2026-06-01")
    add_expense(user_id, 200, "Groceries", "B", "2026-06-02")
    add_expense(user_id, 100, "Dining", "C", "2026-06-03")

    result = db.get_category_breakdown(start_date="2026-06-01", end_date="2026-06-30")

    assert result["grand_total"] == 400.0
    by_category = {r["category"]: r for r in result["breakdown"]}
    assert by_category["Dining"]["total"] == 200.0
    assert by_category["Dining"]["count"] == 2
    assert by_category["Dining"]["pct"] == 50.0
    assert by_category["Groceries"]["pct"] == 50.0


def test_category_breakdown_excludes_out_of_range_expenses(user_id):
    add_expense(user_id, 100, "Dining", "In range", "2026-06-15")
    add_expense(user_id, 999, "Dining", "Out of range", "2026-07-01")

    result = db.get_category_breakdown(start_date="2026-06-01", end_date="2026-06-30")
    assert result["grand_total"] == 100.0


def test_category_breakdown_empty_range_has_no_division_error():
    result = db.get_category_breakdown(start_date="2026-06-01", end_date="2026-06-30")
    assert result == {"breakdown": [], "grand_total": 0}


# --- get_run_rate ---------------------------------------------------------

def test_run_rate_projects_full_month_from_partial_spend(user_id):
    # 100 spent in the first 10 days of a 30-day month -> projected 300 for the month
    add_expense(user_id, 100, "Dining", "Spend", "2026-06-05")

    result = db.get_run_rate("Dining", reference_date="2026-06-10", compare_months=1)

    assert result["spent_so_far"] == 100.0
    assert result["days_elapsed"] == 10
    assert result["days_in_month"] == 30
    assert result["projected_total"] == 300.0


def test_run_rate_pct_change_vs_prior_month(user_id):
    add_expense(user_id, 150, "Dining", "This month", "2026-06-15")  # projects to 300
    add_expense(user_id, 200, "Dining", "Last month", "2026-05-10")

    result = db.get_run_rate("Dining", reference_date="2026-06-15", compare_months=1)

    assert result["prior_months"][0]["total"] == 200.0
    assert result["pct_change_vs_last_month"] == 50.0  # (300 - 200) / 200 * 100


# --- get_top_expenses ------------------------------------------------------

def test_top_expenses_by_amount(user_id):
    add_expense(user_id, 10, "Dining", "Small", "2026-06-01")
    add_expense(user_id, 500, "Rent", "Big", "2026-06-01")
    add_expense(user_id, 50, "Dining", "Medium", "2026-06-01")

    result = db.get_top_expenses(limit=2)

    assert [r["amount"] for r in result] == [500.0, 50.0]


def test_top_expenses_by_vendor_groups_and_sums(user_id):
    add_expense(user_id, 10, "Dining", "Coffee Shop", "2026-06-01")
    add_expense(user_id, 15, "Dining", "Coffee Shop", "2026-06-05")
    add_expense(user_id, 100, "Rent", "Landlord", "2026-06-01")

    result = db.get_top_expenses(by_vendor=True, limit=5)

    by_vendor = {r["description"]: r for r in result}
    assert by_vendor["Coffee Shop"]["total"] == 25.0
    assert by_vendor["Coffee Shop"]["count"] == 2


# --- get_user_breakdown -----------------------------------------------------

def test_user_breakdown_splits_by_logger():
    db.create_user("alice", "hash")
    db.create_user("bob", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    bob_id = db.get_user_by_username("bob")["id"]

    add_expense(alice_id, 100, "Dining", "A", "2026-06-01")
    add_expense(bob_id, 50, "Dining", "B", "2026-06-01")
    add_expense(bob_id, 50, "Dining", "C", "2026-06-02")

    result = {r["logged_by"]: r for r in db.get_user_breakdown()}
    assert result["alice"]["total"] == 100.0
    assert result["bob"]["total"] == 100.0
    assert result["bob"]["count"] == 2


# --- get_weekday_pattern -----------------------------------------------------

def test_weekday_pattern_fills_gaps_for_days_with_no_spend(user_id):
    # 2026-06-01 is a Monday
    add_expense(user_id, 100, "Dining", "Monday spend", "2026-06-01")

    result = db.get_weekday_pattern(start_date="2026-06-01", end_date="2026-06-01")

    assert len(result) == 7  # every weekday represented, even with zero spend
    by_day = {r["weekday"]: r for r in result}
    assert by_day["Monday"]["total"] == 100.0
    assert by_day["Tuesday"]["total"] == 0.0
    assert by_day["Tuesday"]["count"] == 0


# --- get_recurring_expenses --------------------------------------------------

def test_recurring_detects_monthly_pattern(user_id):
    for day in ["2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"]:
        add_expense(user_id, 1850, "Rent", "Monthly Rent", day)

    result = db.get_recurring_expenses()

    assert len(result) == 1
    r = result[0]
    assert r["description"] == "Monthly Rent"
    assert r["amount"] == 1850.0
    assert r["frequency"] == "monthly"
    assert r["occurrences"] == 4
    assert r["last_date"] == "2026-06-05"


def test_recurring_requires_at_least_three_occurrences(user_id):
    add_expense(user_id, 50, "Entertainment", "Concert Ticket", "2026-01-01")
    add_expense(user_id, 50, "Entertainment", "Concert Ticket", "2026-02-01")

    assert db.get_recurring_expenses() == []


def test_recurring_ignores_inconsistent_intervals(user_id):
    add_expense(user_id, 20, "Dining", "Random Lunch", "2026-01-01")
    add_expense(user_id, 20, "Dining", "Random Lunch", "2026-01-15")
    add_expense(user_id, 20, "Dining", "Random Lunch", "2026-03-20")

    assert db.get_recurring_expenses() == []


def test_recurring_classifies_weekly_frequency(user_id):
    for day in ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]:
        add_expense(user_id, 5, "Drinks", "Coffee Subscription", day)

    result = db.get_recurring_expenses()

    assert len(result) == 1
    assert result[0]["frequency"] == "weekly"


def test_recurring_treats_different_amounts_as_separate_unconfirmed_groups(user_id):
    # Same description but a different amount each time -> each group only has 1
    # occurrence, never reaching the >=3 threshold even though 3 charges exist.
    add_expense(user_id, 1850, "Rent", "Rent", "2026-01-05")
    add_expense(user_id, 1900, "Rent", "Rent", "2026-02-05")
    add_expense(user_id, 1950, "Rent", "Rent", "2026-03-05")

    assert db.get_recurring_expenses() == []
