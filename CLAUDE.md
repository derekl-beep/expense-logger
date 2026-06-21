# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Backend (run from repo root):
```bash
uv sync                                   # install/sync Python deps
uv run uvicorn api.server:app --reload    # run API on :8000
uv run python -m agent.main               # run agent loop in terminal (no API/auth)
uv run python scripts/seed_users.py       # create user accounts (edit USERNAMES in the script first)
```

Frontend (run from `frontend/`):
```bash
npm install
npm run dev       # Vite dev server on :5173
npm run build     # production build -> frontend/dist (served by FastAPI)
npm run lint       # eslint
```

There are no automated tests in this repo (no test suite exists for backend or frontend).

## Architecture

This is a single-agent, tool-calling expense tracker. The core loop lives in `agent/main.py` and is consumed by `api/server.py`; there is no business logic in the API layer beyond auth/rate-limiting and translating HTTP <-> agent calls.

**Request flow:** React chat UI -> `POST /chat/stream` (SSE) -> `stream_chat()` in `agent/main.py` -> Claude (`claude-haiku-4-5`) decides to call a tool -> handler in `agent/tools.py` -> `agent/db.py` (psycopg2, raw SQL) -> result fed back to Claude -> streamed text back to the client.

**Tool calling contract:** `agent/tools.py` defines `TOOL_DEFINITIONS` (JSON schemas Claude sees) and `TOOL_HANDLERS` (name -> Python function, all from `agent/db.py`). These two must stay in sync — adding/changing a tool means updating both the schema and ensuring the handler signature accepts matching kwargs. `category` fields are constrained via JSON schema `enum` from `agent/categories.py` (`CATEGORIES`), so the model can't invent categories.

**Agent loop pattern (`agent/main.py`):** Both `chat()` and `stream_chat()` run the same loop — send messages, check `stop_reason`. `tool_use` triggers `_run_tools()` then loops again with appended tool results; `end_turn` returns/breaks. `save_expense` is special-cased in `_run_tools` to inject `user_id` (Claude never sees or sets this). The system prompt is rebuilt per-call from a template (`SYSTEM`) interpolating `today`, `username`, and `CATEGORY_HINTS` — it encodes the actual business rules (date resolution, description formatting, when to query before updating/deleting, flagging semantics). Read it before changing agent behavior; most "logic" lives in prompt text, not Python.

**Session state:** `_sessions` is an in-process dict keyed by `user_id`, holding full conversation history. This is process-local — it does not survive restarts and won't work across multiple server instances.

**Database (`agent/db.py`):** Single lazy global connection (`_conn`), autocommit on, raw SQL via psycopg2 with `RealDictCursor`. Schema migrations are just idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN IF NOT EXISTS` statements run at import time — there's no migration framework. `_run()` retries once on `psycopg2.InterfaceError` to handle Neon's idle-connection drops.

**Auth (`api/auth.py`):** JWT bearer tokens (`HTTPBearer`), bcrypt password hashes, no refresh tokens — `remember` just changes token expiry (1 day vs 30 days). `get_current_user` is the FastAPI dependency used everywhere; `check_rate_limit` in `api/server.py` wraps it to additionally enforce `DAILY_CALL_LIMIT` (tracked in the `api_calls` table) before any Claude call.

**Static serving:** `api/server.py` mounts `frontend/dist` and falls back to `index.html` for any unmatched path (SPA routing), but only if that directory exists — so in dev, run the Vite server separately rather than expecting FastAPI to serve the frontend.

## Conventions

- Expense descriptions: concise noun phrases in title case, pattern `"[What] at [Venue]"` when there's a place. This rule lives in the system prompt (`agent/main.py`), not enforced in code.
- Categories are a fixed, closed list (`agent/categories.py`) — don't add ad-hoc categories in code or prompts; extend `CATEGORIES` and `CATEGORY_HINTS` together.
- Money is stored as `NUMERIC(10,2)` in Postgres and converted to `float` on read (`_row()` in `agent/db.py`) for JSON serialization.
