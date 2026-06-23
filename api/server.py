import csv
import io
import json
import os
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agent.categories import CATEGORIES
from agent.db import (
    delete_expense,
    get_api_call_count,
    get_expenses,
    get_user_by_id,
    get_user_by_username,
    increment_api_call_count,
    update_expense,
)
from agent.main import chat, stream_chat
from api.auth import create_token, get_current_user, verify_password

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


class ChatRequest(BaseModel):
    message: str
    image_data: str | None = None
    image_media_type: str | None = None


def _get_username(user_id: int) -> str:
    user = get_user_by_id(user_id)
    return user["username"] if user else "user"


@app.post("/chat")
def chat_endpoint(req: ChatRequest, user_id: int = Depends(check_rate_limit)):
    response = chat(req.message, user_id, _get_username(user_id), req.image_data, req.image_media_type)
    return {"response": response}


@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest, user_id: int = Depends(check_rate_limit)):
    username = _get_username(user_id)

    def generate():
        try:
            for chunk in stream_chat(req.message, user_id, username, req.image_data, req.image_media_type):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception:
            yield f"data: {json.dumps({'error': 'Something went wrong. Please try again.'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/expenses")
def expenses_endpoint(user_id: int = Depends(get_current_user)):
    return get_expenses()


@app.get("/categories")
def categories_endpoint():
    return CATEGORIES


class UpdateRequest(BaseModel):
    amount: float = None
    category: str = None
    description: str = None
    date: str = None
    flagged: bool = None


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
