from datetime import date

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


# --- find_similar_expenses / get_user_by_id ------------------------------

def test_find_similar_expenses_matches_close_description(user_id):
    add_expense(user_id, 5, "Drinks", "Coffee at Starbucks", "2026-06-01")

    result = db.find_similar_expenses("Starbucks")
    assert len(result) == 1
    assert result[0]["description"] == "Coffee at Starbucks"
    assert result[0]["category"] == "Drinks"
    assert result[0]["score"] > 0.3


def test_find_similar_expenses_no_match_returns_empty(user_id):
    add_expense(user_id, 5, "Drinks", "Coffee at Starbucks", "2026-06-01")
    assert db.find_similar_expenses("Completely unrelated vendor name") == []


def test_get_user_by_id_returns_user(user_id):
    user = db.get_user_by_id(user_id)
    assert user["username"] == "testuser"


def test_get_user_by_id_unknown_returns_none():
    assert db.get_user_by_id(999999) is None


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


def test_update_expense_category_description_date(user_id):
    saved = add_expense(user_id, 10, "Dining", "Coffee", "2026-06-10")
    db.update_expense(saved["id"], category="Drinks", description="Latte", date="2026-06-11")

    row = db.get_expenses()[0]
    assert row["category"] == "Drinks"
    assert row["description"] == "Latte"
    assert row["date"] == "2026-06-11"
    assert row["amount"] == 10  # untouched field preserved


def test_delete_expense(user_id):
    saved = add_expense(user_id, 10, "Dining", "Coffee", "2026-06-10")
    db.delete_expense(saved["id"])
    assert db.get_expenses() == []


# --- get_expenses filters --------------------------------------------------

def test_get_expenses_filters_by_category(user_id):
    add_expense(user_id, 10, "Dining", "A", "2026-06-01")
    add_expense(user_id, 20, "Groceries", "B", "2026-06-01")

    result = db.get_expenses(category="dining")  # case-insensitive
    assert len(result) == 1
    assert result[0]["category"] == "Dining"


def test_get_expenses_filters_by_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 10, "Dining", "Mine", "2026-06-01")
    add_expense(alice_id, 20, "Dining", "Alice's", "2026-06-01")

    result = db.get_expenses(logged_by="ALICE")  # case-insensitive
    assert len(result) == 1
    assert result[0]["description"] == "Alice's"


def test_get_expenses_filters_by_amount_range(user_id):
    add_expense(user_id, 5, "Dining", "Small", "2026-06-01")
    add_expense(user_id, 50, "Dining", "Medium", "2026-06-01")
    add_expense(user_id, 500, "Dining", "Big", "2026-06-01")

    result = db.get_expenses(min_amount=10, max_amount=100)
    assert [r["description"] for r in result] == ["Medium"]


def test_get_expenses_filters_by_flagged(user_id):
    first = add_expense(user_id, 10, "Dining", "Lunch at Cafe", "2026-06-10")
    add_expense(user_id, 10, "Dining", "Lunch at Cafe", "2026-06-10")  # flags both as dup

    flagged = db.get_expenses(flagged=True)
    unflagged = db.get_expenses(flagged=False)
    assert len(flagged) == 2
    assert unflagged == []
    assert first["id"] in [r["id"] for r in flagged]


def test_get_expenses_filters_by_date_range(user_id):
    add_expense(user_id, 10, "Dining", "In range", "2026-06-15")
    add_expense(user_id, 20, "Dining", "Out of range", "2026-07-01")

    result = db.get_expenses(start_date="2026-06-01", end_date="2026-06-30")
    assert [r["description"] for r in result] == ["In range"]


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


def test_category_breakdown_filters_by_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 100, "Dining", "Mine", "2026-06-01")
    add_expense(alice_id, 999, "Dining", "Alice's", "2026-06-01")

    result = db.get_category_breakdown(logged_by="testuser")
    assert result["grand_total"] == 100.0


# --- get_monthly_trend ------------------------------------------------------

def test_monthly_trend_groups_by_calendar_month(user_id):
    add_expense(user_id, 100, "Dining", "A", "2026-05-15")
    add_expense(user_id, 50, "Dining", "B", "2026-06-01")
    add_expense(user_id, 25, "Dining", "C", "2026-06-15")

    result = db.get_monthly_trend(category="Dining", months=2)

    by_month = {r["month"]: r for r in result}
    assert by_month["2026-05"]["total"] == 100.0
    assert by_month["2026-06"]["total"] == 75.0
    assert by_month["2026-06"]["count"] == 2


def test_monthly_trend_filters_by_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 50, "Dining", "Mine", "2026-06-01")
    add_expense(alice_id, 999, "Dining", "Alice's", "2026-06-01")

    result = db.get_monthly_trend(months=1, logged_by="testuser")
    assert result[0]["total"] == 50.0


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


# --- get_weekly_pace --------------------------------------------------------

def test_weekly_pace_projects_full_week_from_partial_spend(user_id):
    # 2026-06-15 is a Monday; 70 spent on the first 2 days of the week -> projected 245 for the week
    add_expense(user_id, 70, "Dining", "Spend", "2026-06-16")

    result = db.get_weekly_pace("Dining", reference_date="2026-06-16", compare_weeks=1)

    assert result["spent_so_far"] == 70.0
    assert result["days_elapsed"] == 2
    assert result["projected_total"] == 245.0


def test_weekly_pace_pct_change_vs_prior_week(user_id):
    add_expense(user_id, 70, "Dining", "This week", "2026-06-16")  # Tue of week starting 2026-06-15
    add_expense(user_id, 100, "Dining", "Last week", "2026-06-09")  # prior Tue

    result = db.get_weekly_pace("Dining", reference_date="2026-06-16", compare_weeks=1)

    assert result["prior_weeks"][0]["total"] == 100.0
    assert result["pct_change_vs_last_week"] == 145.0  # (245 - 100) / 100 * 100


def test_weekly_pace_without_category_covers_all(user_id):
    add_expense(user_id, 10, "Dining", "A", "2026-06-16")
    add_expense(user_id, 20, "Groceries", "B", "2026-06-16")

    result = db.get_weekly_pace(reference_date="2026-06-16", compare_weeks=1)
    assert result["spent_so_far"] == 30.0


# --- get_yoy_comparison ------------------------------------------------------

def test_yoy_comparison_computes_totals_and_pct_change(user_id):
    add_expense(user_id, 150, "Dining", "This June", "2026-06-10")
    add_expense(user_id, 100, "Dining", "Last June", "2025-06-10")

    result = db.get_yoy_comparison(category="Dining", month="2026-06")

    assert result["this_year_total"] == 150.0
    assert result["last_year_total"] == 100.0
    assert result["last_year_month"] == "2025-06"
    assert result["pct_change"] == 50.0


def test_yoy_comparison_no_prior_year_data_has_no_pct_change(user_id):
    add_expense(user_id, 150, "Dining", "This June", "2026-06-10")

    result = db.get_yoy_comparison(category="Dining", month="2026-06")
    assert result["last_year_total"] == 0.0
    assert result["pct_change"] is None


def test_yoy_comparison_filters_by_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 150, "Dining", "Mine", "2026-06-10")
    add_expense(alice_id, 999, "Dining", "Alice's", "2026-06-10")

    result = db.get_yoy_comparison(category="Dining", month="2026-06", logged_by="testuser")
    assert result["this_year_total"] == 150.0


def test_yoy_comparison_defaults_to_current_month(user_id):
    add_expense(user_id, 150, "Dining", "This month", date.today().isoformat())

    result = db.get_yoy_comparison(category="Dining")
    assert result["this_year_total"] == 150.0


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


def test_top_expenses_filters_by_date_category_and_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 500, "Rent", "In range, mine", "2026-06-01")
    add_expense(user_id, 999, "Rent", "Out of range", "2026-07-01")
    add_expense(alice_id, 999, "Rent", "Alice's", "2026-06-01")
    add_expense(user_id, 10, "Dining", "Wrong category", "2026-06-01")

    result = db.get_top_expenses(
        start_date="2026-06-01", end_date="2026-06-30", category="Rent", logged_by="testuser",
    )
    assert [r["description"] for r in result] == ["In range, mine"]


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


def test_user_breakdown_filters_by_date_range_and_category(user_id):
    add_expense(user_id, 100, "Dining", "In range, dining", "2026-06-01")
    add_expense(user_id, 999, "Dining", "Out of range", "2026-07-01")
    add_expense(user_id, 999, "Groceries", "Wrong category", "2026-06-01")

    result = db.get_user_breakdown(start_date="2026-06-01", end_date="2026-06-30", category="Dining")
    assert len(result) == 1
    assert result[0]["total"] == 100.0


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


def test_weekday_pattern_filters_by_category_and_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 100, "Dining", "Mine, dining", "2026-06-01")
    add_expense(user_id, 999, "Groceries", "Mine, groceries", "2026-06-01")
    add_expense(alice_id, 999, "Dining", "Alice's", "2026-06-01")

    result = db.get_weekday_pattern(
        start_date="2026-06-01", end_date="2026-06-01", category="Dining", logged_by="testuser",
    )
    by_day = {r["weekday"]: r for r in result}
    assert by_day["Monday"]["total"] == 100.0


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


def test_recurring_ignores_consistent_but_unclassifiable_interval(user_id):
    # 21-day gaps are consistent (stddev=0) but fall between the biweekly
    # (<=17 days) and monthly (>=25 days) tolerance windows, so no frequency
    # label applies and the group should be dropped.
    for day in ["2026-01-05", "2026-01-26", "2026-02-16"]:
        add_expense(user_id, 30, "Dining", "Odd Interval Charge", day)

    assert db.get_recurring_expenses() == []


def test_recurring_treats_different_amounts_as_separate_unconfirmed_groups(user_id):
    # Same description but a different amount each time -> each group only has 1
    # occurrence, never reaching the >=3 threshold even though 3 charges exist.
    add_expense(user_id, 1850, "Rent", "Rent", "2026-01-05")
    add_expense(user_id, 1900, "Rent", "Rent", "2026-02-05")
    add_expense(user_id, 1950, "Rent", "Rent", "2026-03-05")

    assert db.get_recurring_expenses() == []


# --- get_expenses description_contains ---------------------------------

def test_get_expenses_description_contains_matches_substring(user_id):
    add_expense(user_id, 10, "Groceries", "Groceries at Costco", "2026-06-01")
    add_expense(user_id, 20, "Dining", "Lunch at Cafe", "2026-06-02")

    result = db.get_expenses(description_contains="costco")
    assert len(result) == 1
    assert result[0]["description"] == "Groceries at Costco"


def test_get_expenses_description_contains_no_match_returns_empty(user_id):
    add_expense(user_id, 10, "Groceries", "Groceries at Costco", "2026-06-01")
    assert db.get_expenses(description_contains="nonexistent vendor") == []


# --- get_average_transaction --------------------------------------------

def test_average_transaction_for_category(user_id):
    add_expense(user_id, 10, "Dining", "A", "2026-06-01")
    add_expense(user_id, 20, "Dining", "B", "2026-06-02")
    add_expense(user_id, 999, "Rent", "C", "2026-06-01")

    result = db.get_average_transaction(category="Dining")
    assert result["average"] == 15.0
    assert result["count"] == 2


def test_average_transaction_no_matches_returns_zero():
    result = db.get_average_transaction(category="Dining")
    assert result == {"category": "Dining", "average": 0.0, "count": 0}


def test_average_transaction_filters_by_date_range_and_logged_by(user_id):
    db.create_user("alice", "hash")
    alice_id = db.get_user_by_username("alice")["id"]
    add_expense(user_id, 10, "Dining", "In range, mine", "2026-06-01")
    add_expense(user_id, 999, "Dining", "Out of range", "2026-07-01")
    add_expense(alice_id, 999, "Dining", "Alice's", "2026-06-01")

    result = db.get_average_transaction(
        start_date="2026-06-01", end_date="2026-06-30", logged_by="testuser",
    )
    assert result["average"] == 10.0
    assert result["count"] == 1


# --- get_budget_status ----------------------------------------------------

def test_budget_status_computes_spent_remaining_and_pct(user_id):
    db.set_budget("Dining", 200)
    add_expense(user_id, 50, "Dining", "A", "2026-06-05")
    add_expense(user_id, 25, "Dining", "B", "2026-06-10")

    result = db.get_budget_status(month="2026-06")
    assert len(result) == 1
    r = result[0]
    assert r["category"] == "Dining"
    assert r["monthly_limit"] == 200.0
    assert r["spent"] == 75.0
    assert r["remaining"] == 125.0
    assert r["pct_used"] == 37.5
    assert r["over_budget"] is False


def test_budget_status_flags_over_budget(user_id):
    db.set_budget("Dining", 100)
    add_expense(user_id, 150, "Dining", "Big spend", "2026-06-05")

    result = db.get_budget_status(month="2026-06")
    assert result[0]["over_budget"] is True
    assert result[0]["remaining"] == -50.0


def test_budget_status_excludes_other_months(user_id):
    db.set_budget("Dining", 200)
    add_expense(user_id, 50, "Dining", "Last month", "2026-05-15")

    result = db.get_budget_status(month="2026-06")
    assert result[0]["spent"] == 0.0


def test_budget_status_category_with_no_budget_returns_empty():
    assert db.get_budget_status(category="Dining") == []


# --- api_calls / rate limiting --------------------------------------------

def test_api_call_count_starts_at_zero(user_id):
    assert db.get_api_call_count(user_id, "2026-06-27") == 0


def test_increment_api_call_count_accumulates(user_id):
    db.increment_api_call_count(user_id, "2026-06-27")
    db.increment_api_call_count(user_id, "2026-06-27")
    assert db.get_api_call_count(user_id, "2026-06-27") == 2


def test_increment_api_call_count_is_per_day(user_id):
    db.increment_api_call_count(user_id, "2026-06-27")
    db.increment_api_call_count(user_id, "2026-06-28")
    assert db.get_api_call_count(user_id, "2026-06-27") == 1
    assert db.get_api_call_count(user_id, "2026-06-28") == 1
