import csv
import io
import json
import logging
import os
import traceback
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from agent.categories import CATEGORIES
from agent.db import (
    delete_budget,
    delete_expense,
    get_api_call_count,
    get_budgets,
    get_expenses,
    get_recurring_expenses,
    get_user_by_id,
    get_user_by_username,
    increment_api_call_count,
    set_budget,
    update_expense,
)
from agent.main import chat, clear_session, stream_chat
from agent.tools import SUGGESTED_PROMPTS
from api.auth import create_token, get_current_user, verify_password

logger = logging.getLogger(__name__)

DAILY_CALL_LIMIT = int(os.environ.get("DAILY_CALL_LIMIT", 50))


def check_rate_limit(user_id: int = Depends(get_current_user)) -> int:
    today = date.today().isoformat()
    if get_api_call_count(user_id, today) >= DAILY_CALL_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit of {DAILY_CALL_LIMIT} messages reached. Try again tomorrow.",
        )
    increment_api_call_count(user_id, today)
    return user_id

app = FastAPI()

_allowed_origins = ["http://localhost:5173"]
if prod_origin := os.environ.get("ALLOWED_ORIGIN"):
    _allowed_origins.append(prod_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False


@app.post("/auth/login")
def login(req: LoginRequest):
    user = get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"token": create_token(user["id"], req.remember), "username": user["username"]}


class ImageInput(BaseModel):
    data: str
    media_type: str


class ChatRequest(BaseModel):
    message: str
    images: list[ImageInput] | None = None


def _get_username(user_id: int) -> str:
    user = get_user_by_id(user_id)
    return user["username"] if user else "user"


def _images_payload(req: ChatRequest) -> list[dict] | None:
    return [img.model_dump() for img in req.images] if req.images else None


@app.post("/chat")
def chat_endpoint(req: ChatRequest, user_id: int = Depends(check_rate_limit)):
    response = chat(req.message, user_id, _get_username(user_id), _images_payload(req))
    return {"response": response}


@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest, user_id: int = Depends(check_rate_limit)):
    username = _get_username(user_id)

    def generate():
        try:
            for chunk in stream_chat(req.message, user_id, username, _images_payload(req)):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception:
            logger.error("stream_chat error:\n%s", traceback.format_exc())
            yield f"data: {json.dumps({'error': 'Something went wrong. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/chat/clear")
def chat_clear_endpoint(user_id: int = Depends(get_current_user)):
    clear_session(user_id)
    return {"status": "cleared"}


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/expenses")
def expenses_endpoint(user_id: int = Depends(get_current_user)):
    return get_expenses()


@app.get("/categories")
def categories_endpoint():
    return CATEGORIES


@app.get("/expenses/recurring")
def recurring_expenses_endpoint(user_id: int = Depends(get_current_user)):
    return get_recurring_expenses()


class BudgetRequest(BaseModel):
    monthly_limit: float


@app.get("/budgets")
def budgets_endpoint(user_id: int = Depends(get_current_user)):
    return get_budgets()


@app.put("/budgets/{category}")
def set_budget_endpoint(category: str, req: BudgetRequest, user_id: int = Depends(get_current_user)):
    return set_budget(category, req.monthly_limit)


@app.delete("/budgets/{category}")
def delete_budget_endpoint(category: str, user_id: int = Depends(get_current_user)):
    return delete_budget(category)


@app.get("/chat/suggestions")
def chat_suggestions_endpoint():
    return SUGGESTED_PROMPTS


class UpdateRequest(BaseModel):
    amount: float = None
    category: str = None
    description: str = None
    date: str = None
    flagged: bool = None

    @field_validator("category")
    @classmethod
    def validate_category(cls, v):
        if v is not None and v not in CATEGORIES:
            raise ValueError(f"Invalid category: {v}")
        return v


@app.patch("/expenses/{id}")
def update_expense_endpoint(id: int, req: UpdateRequest, user_id: int = Depends(get_current_user)):
    return update_expense(id, req.amount, req.category, req.description, req.date, req.flagged)


@app.delete("/expenses/{id}")
def delete_expense_endpoint(id: int, user_id: int = Depends(get_current_user)):
    return delete_expense(id)



@app.get("/expenses/export")
def expenses_export(user_id: int = Depends(get_current_user)):
    rows = get_expenses()
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["id", "date", "description", "category", "amount"])
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=expenses.csv"},
    )


# Serve React build — must be mounted after all API routes
_static = Path(__file__).parent.parent / "frontend" / "dist"
if _static.exists():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        return FileResponse(_static / "index.html")
