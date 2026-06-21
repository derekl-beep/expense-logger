import csv
import io
import json

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.categories import CATEGORIES
from agent.db import (
    delete_expense,
    get_expenses,
    get_user_by_username,
    update_expense,
)
from agent.main import chat, stream_chat
from api.auth import create_token, get_current_user, verify_password

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # updated to prod domain in Phase 7
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/login")
def login(req: LoginRequest):
    user = get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"token": create_token(user["id"]), "username": user["username"]}


class ChatRequest(BaseModel):
    message: str


@app.post("/chat")
def chat_endpoint(req: ChatRequest, user_id: int = Depends(get_current_user)):
    response = chat(req.message, user_id)
    return {"response": response}


@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest, user_id: int = Depends(get_current_user)):
    def generate():
        for chunk in stream_chat(req.message, user_id):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


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
