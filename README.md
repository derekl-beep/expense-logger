# Expense Logger

A personal expense tracker powered by an AI agent. Instead of filling out forms, you describe expenses in plain English — the agent parses them, infers missing fields, and saves structured rows to a database. You can also query your spending in natural language.

> Built as a side project to explore how agentic AI changes the way we develop applications.

---

## Demo

| Chat | Expenses |
|---|---|
| _"$80 wine at LCBO"_ → saved under **Shopping** | Live table updates after every message |
| _"how much did I spend this week?"_ → breakdown by category | Export to CSV anytime |
| _"change my lunch to $15"_ → agent finds the row and updates it | Monthly summary with one click |

---

## What makes this agentic

This isn't a form with parsing logic — it's an agent that:

- **Interprets natural language** — extracts amount, category, date, and description from free text
- **Makes decisions** — infers category from context, resolves vague dates like "yesterday"
- **Calls tools** — `save_expense`, `get_expenses`, `update_expense`, `delete_expense`
- **Chains tool calls** — to update an expense, Claude first queries to find its ID, then updates it
- **Handles ambiguity** — asks a follow-up question when input is unclear
- **Maintains conversation history** — remembers context across turns in a session

---

## Architecture

```
React (chat UI)
     ↓  HTTP + SSE (streaming)
FastAPI
     ↓
Python agent — Claude API + tool definitions
     ↓
SQLite
```

### The 3 layers of an agentic app

| Layer | What it is | What you write |
|---|---|---|
| Agent | LLM + system prompt | Prompt that tells Claude how to think |
| Tool definitions | JSON schemas | Contracts describing what functions exist |
| Tool implementations | Python functions | Plain executors — write to DB, read from DB |

### The agent loop

One user message ≠ one LLM call. Each interaction is a cycle:

```
1. Send user message to LLM
2. LLM responds with a tool_call
3. Your code executes the tool
4. Send the tool result back to LLM
5. LLM generates a natural language response  ← streamed word by word
```

Steps 2–4 repeat when multiple tools are needed (e.g. query then update).

---

## Tech Stack

| Layer | Choice |
|---|---|
| LLM | Claude API (`claude-sonnet-4-6`) |
| Backend | Python + FastAPI |
| Frontend | React + Vite |
| Database | SQLite (dev) |
| Package manager | `uv` |
| Streaming | Server-sent events (SSE) |

---

## Project Structure

```
expense-logger/
├── agent/
│   ├── main.py         # agent loop + streaming
│   ├── tools.py        # tool definitions + handler map
│   ├── db.py           # SQLite queries
│   └── categories.py   # fixed category list
├── api/
│   └── server.py       # FastAPI — /chat/stream, /expenses, /expenses/export
└── frontend/
    └── src/
        ├── App.jsx
        └── components/
            ├── Chat.jsx
            └── ExpenseTable.jsx
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 18+
- [`uv`](https://github.com/astral-sh/uv) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- An [Anthropic API key](https://console.anthropic.com)

### Backend

```bash
# Install dependencies
uv install

# Set your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Start the API server
uv run uvicorn api.server:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Key Patterns Demonstrated

| Pattern | Where |
|---|---|
| Tool / function calling | `agent/tools.py` — schema + handler map |
| Agent loop with tool results | `agent/main.py` — `chat()` and `stream_chat()` |
| Streaming responses (SSE) | `api/server.py` → `Chat.jsx` |
| Multi-tool chaining | Update/delete — Claude queries first, then acts |
| Conversation history | `messages` list persisted across turns |
| Constrained output | Category field uses JSON schema `enum` |
| Prompt + schema separation | Category hints in system prompt, enforcement in tool schema |

---

## How to Phase an LLM Project

Phasing an LLM project is different from a regular app. The model handles what would take hundreds of lines of traditional parsing logic, so phases are about **adding control and reliability**, not features.

| Phase | Goal |
|---|---|
| 1 — Prove it works | Happy path end-to-end in a single file |
| 2 — Handle the real world | Ambiguity, multi-tool, conversation history |
| 3 — Make it usable | UI, streaming, responsive layout |
| 4 — Polish | Fixed categories, summaries, CSV export |

MVP = minimum *prompt + tools* to prove the model handles the core task. You can ship Phase 1 in ~50 lines of Python.
