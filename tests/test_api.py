import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from agent import db
from api import server
from api.auth import create_token, hash_password

client = TestClient(server.app)


@pytest.fixture
def auth_headers(user_id):
    return {"Authorization": f"Bearer {create_token(user_id)}"}


def add_expense(user_id, amount, category, description, day):
    return db.save_expense(amount, category, description, day, user_id=user_id)


# --- /auth/login ------------------------------------------------------------

def test_login_succeeds_with_correct_password():
    db.create_user("loginuser", hash_password("correct-password"))

    response = client.post("/auth/login", json={"username": "loginuser", "password": "correct-password"})

    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "loginuser"
    assert body["token"]


def test_login_fails_with_wrong_password():
    db.create_user("loginuser", hash_password("correct-password"))

    response = client.post("/auth/login", json={"username": "loginuser", "password": "wrong"})

    assert response.status_code == 401


def test_login_fails_for_unknown_user():
    response = client.post("/auth/login", json={"username": "ghost", "password": "whatever"})
    assert response.status_code == 401


# --- basic endpoints ---------------------------------------------------

def test_health_endpoint():
    assert client.get("/health").json() == {"ok": True}


def test_categories_endpoint_returns_category_list():
    from agent.categories import CATEGORIES
    assert client.get("/categories").json() == CATEGORIES


def test_chat_suggestions_endpoint():
    from agent.tools import SUGGESTED_PROMPTS
    assert client.get("/chat/suggestions").json() == SUGGESTED_PROMPTS


# --- auth-required endpoints ---------------------------------------------

def test_expenses_endpoint_requires_auth():
    assert client.get("/expenses").status_code == 401  # no Authorization header at all


def test_expenses_endpoint_rejects_invalid_token():
    response = client.get("/expenses", headers={"Authorization": "Bearer not-a-valid-jwt"})
    assert response.status_code == 401


def test_expenses_endpoint_returns_data_when_authenticated(auth_headers, user_id):
    add_expense(user_id, 12.5, "Dining", "Lunch", "2026-06-01")

    response = client.get("/expenses", headers=auth_headers)

    assert response.status_code == 200
    assert len(response.json()) == 1


# --- budgets ---------------------------------------------------------------

def test_budgets_crud_via_api(auth_headers):
    assert client.get("/budgets", headers=auth_headers).json() == []

    put_resp = client.put("/budgets/Dining", json={"monthly_limit": 300}, headers=auth_headers)
    assert put_resp.status_code == 200
    assert client.get("/budgets", headers=auth_headers).json() == [
        {"category": "Dining", "monthly_limit": 300.0}
    ]

    del_resp = client.delete("/budgets/Dining", headers=auth_headers)
    assert del_resp.status_code == 200
    assert client.get("/budgets", headers=auth_headers).json() == []


# --- update/delete expense --------------------------------------------------

def test_update_expense_with_invalid_category_returns_422(auth_headers, user_id):
    expense = add_expense(user_id, 10, "Dining", "Lunch", "2026-06-01")

    response = client.patch(
        f"/expenses/{expense['id']}", json={"category": "NotARealCategory"}, headers=auth_headers
    )

    assert response.status_code == 422


def test_update_expense_with_valid_category_succeeds(auth_headers, user_id):
    expense = add_expense(user_id, 10, "Dining", "Lunch", "2026-06-01")

    response = client.patch(
        f"/expenses/{expense['id']}", json={"category": "Groceries"}, headers=auth_headers
    )

    assert response.status_code == 200
    assert response.json() == {"status": "updated"}
    assert db.get_expenses()[0]["category"] == "Groceries"


def test_delete_expense_via_api(auth_headers, user_id):
    expense = add_expense(user_id, 10, "Dining", "Lunch", "2026-06-01")

    response = client.delete(f"/expenses/{expense['id']}", headers=auth_headers)

    assert response.status_code == 200
    assert client.get("/expenses", headers=auth_headers).json() == []


# --- recurring -----------------------------------------------------------

def test_recurring_expenses_endpoint(auth_headers):
    assert client.get("/expenses/recurring", headers=auth_headers).json() == []


# --- CSV export -----------------------------------------------------------

def test_expenses_export_returns_csv(auth_headers, user_id):
    add_expense(user_id, 10, "Dining", "Lunch", "2026-06-01")

    response = client.get("/expenses/export", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "Lunch" in response.text


# --- chat/clear -------------------------------------------------------------

def test_chat_clear_endpoint(auth_headers, user_id):
    from agent import main
    main._sessions[str(user_id)] = [{"role": "user", "content": "hi"}]

    response = client.post("/chat/clear", headers=auth_headers)

    assert response.status_code == 200
    assert str(user_id) not in main._sessions


# --- /chat, /chat/stream wiring (mocked agent layer) ------------------------

def test_chat_endpoint_invokes_agent_and_returns_response(monkeypatch, auth_headers):
    monkeypatch.setattr(server, "chat", lambda message, user_id, username, images: "mocked reply")

    response = client.post("/chat", json={"message": "hi"}, headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {"response": "mocked reply"}


def test_chat_stream_endpoint_streams_chunks(monkeypatch, auth_headers):
    def fake_stream_chat(message, user_id, username, images):
        yield "Hello"
        yield " world"

    monkeypatch.setattr(server, "stream_chat", fake_stream_chat)

    response = client.post("/chat/stream", json={"message": "hi"}, headers=auth_headers)

    assert response.status_code == 200
    assert "Hello" in response.text
    assert "data: [DONE]" in response.text


def test_chat_stream_endpoint_reports_error_on_exception(monkeypatch, auth_headers):
    def fake_stream_chat(message, user_id, username, images):
        yield "partial"
        raise RuntimeError("boom")

    monkeypatch.setattr(server, "stream_chat", fake_stream_chat)

    response = client.post("/chat/stream", json={"message": "hi"}, headers=auth_headers)

    assert response.status_code == 200
    assert '"error"' in response.text
    assert "data: [DONE]" in response.text


# --- check_rate_limit --------------------------------------------------

def test_check_rate_limit_allows_calls_under_limit(user_id):
    assert server.check_rate_limit(user_id=user_id) == user_id


def test_check_rate_limit_blocks_once_daily_limit_is_reached(user_id):
    from datetime import date
    today = date.today().isoformat()
    for _ in range(server.DAILY_CALL_LIMIT):
        db.increment_api_call_count(user_id, today)

    with pytest.raises(HTTPException) as exc_info:
        server.check_rate_limit(user_id=user_id)

    assert exc_info.value.status_code == 429
