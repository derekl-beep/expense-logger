import csv
import io
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.categories import CATEGORIES
from agent.db import clear_expenses, delete_expense, get_expenses, update_expense
from agent.main import chat, stream_chat

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str


@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    response = chat(req.message)
    return {"response": response}


@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest):
    def generate():
        for chunk in stream_chat(req.message):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/expenses")
def expenses_endpoint():
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
def update_expense_endpoint(id: int, req: UpdateRequest):
    return update_expense(id, req.amount, req.category, req.description, req.date, req.flagged)


@app.delete("/expenses/{id}")
def delete_expense_endpoint(id: int):
    return delete_expense(id)


@app.delete("/expenses")
def clear_expenses_endpoint():
    return clear_expenses()


@app.get("/expenses/export")
def expenses_export():
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
