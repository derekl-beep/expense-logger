import csv
import io

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent.db import get_expenses
from agent.main import chat

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


@app.get("/expenses")
def expenses_endpoint():
    return get_expenses()


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
