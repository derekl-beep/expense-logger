# Expense Logger

A personal expense tracker powered by an AI agent. Describe expenses in plain English — the agent parses them, infers missing fields, and saves structured records to a database. Query your spending the same way.

> Built as a side project to explore how agentic AI changes application development.

![Expense Logger demo](https://github.com/user-attachments/assets/dd6ee1e7-2fbb-45a2-a7c7-c949de5ea356)

---

## Features

- **Natural language input** — _"$12 lunch at the food court"_ is all you need to type
- **Agentic decisions** — infers category, resolves vague dates like "yesterday", asks when unclear
- **Photo → auto-log** — snap a receipt or screenshot; agent OCRs and logs the line items, deduping repeats across overlapping images
- **Vendor memory** — fuzzy-matches new expenses against past descriptions (Postgres trigram similarity) to reuse a vendor's category instead of asking again
- **Duplicate detection** — flags same-day, same-amount, similar-description expenses for review instead of silently double-logging
- **Full CRUD via chat** — update or delete past expenses through conversation
- **Spending analytics** — category breakdowns, monthly trends, run-rate/weekly-pace projections, YoY comparisons, top expenses, weekday/per-user breakdowns, one-click monthly summary — all computed in SQL, never re-tallied by the model
- **Live expense table** — updates after every message, filterable by month and flagged status
- **CSV export** — download all expenses anytime
- **Installable on mobile** — add-to-home-screen support, dark mode persisted across sessions
- **Multi-user** — JWT auth, per-session conversation isolation, shared expense pool

---

## Stack

| Layer | Choice |
|---|---|
| LLM | Claude API (`claude-haiku-4-5`) |
| Backend | Python 3.12 + FastAPI |
| Frontend | React 19 + Vite + Tailwind CSS + shadcn/ui |
| Database | PostgreSQL (Neon) |
| Auth | JWT + bcrypt |
| Streaming | Server-sent events (SSE) |
| Deploy | Railway (Docker) |
| Package manager | `uv` |

---

## Architecture

```
React (chat UI)
     │
     │  POST /chat/stream  (SSE)
     │  GET  /expenses
     ▼
FastAPI
     │
     ▼
Agent loop  ──────────────────────────────────────┐
│  1. Send user message + history to Claude        │
│  2. Claude responds with a tool_call              │
│  3. Execute tool (save / find_similar / get /     │◄── PostgreSQL
│     update / delete)                              │
│  4. Send tool result back to Claude               │
│  5. Claude streams natural language response      │
└──────────────────────────────────────────────────┘
```

There's no business logic in the API layer beyond auth and rate-limiting — every decision (category inference, vendor matching, duplicate flagging, date resolution) happens inside the agent loop or its tools.

---

## Project Structure

```
expense-logger/
├── agent/
│   ├── main.py         # agent loop + streaming + system prompt
│   ├── tools.py        # tool definitions + handler map
│   ├── db.py           # PostgreSQL queries (psycopg2)
│   └── categories.py   # fixed category list (17 categories)
├── api/
│   ├── server.py       # FastAPI routes + static file serving
│   └── auth.py         # JWT creation/verification, bcrypt helpers
├── scripts/
│   └── seed_users.py   # one-time script to create family accounts
├── frontend/
│   └── src/
│       ├── App.jsx
│       └── components/
│           ├── Chat.jsx
│           ├── ExpenseTable.jsx
│           └── Login.jsx
├── Dockerfile
└── .env.example
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 20+
- [`uv`](https://github.com/astral-sh/uv) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- A PostgreSQL database ([Neon](https://neon.tech) free tier works)
- An [Anthropic API key](https://console.anthropic.com)

### 1. Clone and configure

```bash
git clone https://github.com/derekl-beep/expense-logger.git
cd expense-logger

cp .env.example .env
# Fill in ANTHROPIC_API_KEY, JWT_SECRET, DATABASE_URL
```

### 2. Backend

```bash
uv sync
uv run uvicorn api.server:app --reload
```

### 3. Seed user accounts

```bash
uv run python scripts/seed_users.py
```

Edit `USERNAMES` in the script to set your family members' usernames before running.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Get one at [console.anthropic.com](https://console.anthropic.com) |
| `JWT_SECRET` | Yes | Any long random string — `openssl rand -hex 32` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DAILY_CALL_LIMIT` | No | Max Claude API calls per user per day (default: `50`) |
| `ALLOWED_ORIGIN` | No | Production frontend URL for CORS (e.g. `https://your-app.railway.app`) |

---

## Deployment

The app is packaged as a single Docker image — FastAPI serves both the API and the React build.

### Railway (recommended)

1. Push to GitHub
2. New Railway project → Deploy from GitHub repo
3. Set environment variables (see table above)
4. Generate a public domain → set it as `ALLOWED_ORIGIN` → redeploy
5. Seed production accounts: `DATABASE_URL=<prod-url> uv run python scripts/seed_users.py`

---

## Key Patterns Demonstrated

| Pattern | Where |
|---|---|
| Tool / function calling | `agent/tools.py` — schema + handler map |
| Agent loop with tool results | `agent/main.py` — `chat()` and `stream_chat()` |
| Streaming responses (SSE) | `api/server.py` → `Chat.jsx` |
| Multi-tool chaining | Update/delete — Claude queries first, then acts |
| Retrieval before generation | `find_similar_expense` — fuzzy DB lookup grounds category choice before the model falls back to its own judgment |
| Per-user conversation isolation | `_sessions` dict keyed by `user_id` in `agent/main.py` |
| Constrained output | Category field uses JSON schema `enum` |
| JWT auth as FastAPI dependency | `api/auth.py` → `Depends(get_current_user)` |
| API cost guard | `check_rate_limit` dependency on all chat endpoints |

---

## Roadmap

Tiered by value vs. implementation complexity — not strict build order, but higher tiers generally build on capabilities below them. A separate, lower-priority track covers scaling work that unblocks future tiers but adds no direct user value on its own.

| Tier | Feature | Notes |
|---|---|---|
| 1 · Quick win | Recurring expense detection | Exact `(description, amount)` grouping + interval-consistency check, instead of manual re-entry every month |
| 1 · Quick win | Budget limits & alerts | Per-category monthly budgets; notify when approaching or exceeding them |
| 2 · Builds on Tier 1 | Subscription tracker | Renewal dates, monthly/annual cost rollup — sourced from recurring-charge detection |
| 2 · Builds on Tier 1 | Weekly/monthly digest _(agentic)_ | Proactive scheduled spending summary — trends, top categories, changes vs. last period |
| 3 · New integration surface | Email forwarding | Forward order/receipt emails to a dedicated inbox; agent extracts and logs automatically |
| 3 · New integration surface | Family group chat bot | Log expenses from WhatsApp/Telegram, not just the web app |
| 3 · New integration surface | Mid-month budget coach _(agentic)_ | Projects end-of-month spend per category, nudges before you're over budget |
| 3 · New integration surface | Email receipt inbox _(agentic)_ | Dedicated forwarding address — agent parses receipt emails into line items, no chat needed |
| Architecture | Scheduler | Needed for digests, budget coaching, any time-triggered agentic feature above |
| Architecture | Persistent session store | `_sessions` is an in-process dict today — doesn't survive restarts or scale across instances |
| Architecture | Async DB driver | Current psycopg2 usage is synchronous; matters once concurrent load or scheduled jobs are added |
| Architecture | Migration framework | Schema changes are idempotent `CREATE TABLE IF NOT EXISTS` statements run at import time — fine now, won't scale |
| Architecture | Push/email delivery infra | Transport for any proactive notification feature (digests, alerts, coaching nudges) |
