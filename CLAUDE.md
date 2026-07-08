# CLAUDE.md

Guidance for Claude Code in this repo. This file is a minimal index — detailed rules
live in `docs/claude/` and are **binding**. Read the one that matches your task before
starting:

| You are about to… | Read first |
|---|---|
| Explore, search, or research anything larger than ~3 files | `docs/claude/ORCHESTRATION.md` |
| Decide if work is done / whether to ask the user / whether to change approach | `docs/claude/JUDGMENT.md` |
| Delegate to a subagent | `docs/claude/ORCHESTRATION.md` (rules), then `docs/claude/TEMPLATES.md` (prompt skeleton) |
| Edit any file in `docs/claude/` or memory | `docs/claude/MAINTENANCE.md` |
| Start a session cold with no context | `docs/claude/LETTER.md` |

## Paired invariants (breaking one of these is the #1 bug source here)

1. `agent/tools.py`: `TOOL_DEFINITIONS` (JSON schemas) and `TOOL_HANDLERS` (functions)
   must change **together**. After editing either, confirm the handler signature accepts
   every schema property, then run `uv run pytest tests/`.
2. `agent/categories.py`: `CATEGORIES` and `CATEGORY_HINTS` must change together.
   Categories are a closed list — never add one anywhere else.
3. Agent **behavior** (date resolution, description format `"[What] at [Venue]"` in
   title case, flagging semantics, query-before-update/delete) lives in the `SYSTEM`
   prompt template in `agent/main.py`, **not in Python logic**. To change behavior,
   edit the prompt text. Read it before assuming code is the right layer.
4. Money: `NUMERIC(10,2)` in Postgres, converted to `float` on read in `_row()`
   (`agent/db.py`). Keep that conversion when adding read paths.

## Commands

Backend (repo root):
```bash
uv sync                                   # install/sync Python deps
uv run uvicorn api.server:app --reload    # API on :8000
uv run python -m agent.main               # agent loop in terminal (no API/auth)
uv run python scripts/seed_users.py       # create user accounts (edit USERNAMES first)
```

Frontend (from `frontend/`):
```bash
npm install
npm run dev       # Vite dev server on :5173
npm run build     # production build -> frontend/dist (served by FastAPI)
npm run lint
```

Tests — the definition of "done" per change type is in `docs/claude/JUDGMENT.md`:
```bash
uv run pytest tests/                                   # backend unit tests, repo root
cd frontend && npm run test:e2e                        # full Playwright e2e suite
cd frontend && npx playwright test e2e/login.spec.js   # single e2e spec
```
Backend tests use `expense_logger_test` (see `tests/conftest.py`), truncated/reseeded
per test. The e2e Playwright config auto-starts both servers and seeds that same test
DB from `scripts/seed_e2e_data.py` (deterministic, idempotent). Both are isolated from
the dev `expense_logger` DB. The e2e suite is expensive — run only affected spec files
unless the change touches auth, routing, or the chat stream.

## Architecture (orientation only — verify in code before relying on details)

Single-agent, tool-calling expense tracker. No business logic in the API layer beyond
auth/rate-limiting.

**Request flow:** React chat UI → `POST /chat/stream` (SSE) → `stream_chat()` in
`agent/main.py` → Claude calls tools → handlers in `agent/tools.py` → `agent/db.py`
(psycopg2, raw SQL) → result back to Claude → streamed to client. Two models are in
play (`agent/main.py`): text chat uses `MODEL_DEFAULT` (`claude-haiku-4-5-...`);
receipt-photo OCR uses `MODEL_VISION` (`claude-sonnet-4-6`, better at reading text in
images) via `_ocr_image()`. Don't assume prompt/behavior constraints from one model
apply to the other.

- **Agent loop** (`agent/main.py`): `chat()` and `stream_chat()` share the loop —
  `tool_use` → `_run_tools()` → loop; `end_turn` → return. `save_expense` is
  special-cased to inject `user_id` (Claude never sees it).
- **Sessions:** `_sessions` dict in-process, keyed by `user_id`. Not restart-safe,
  not multi-instance-safe.
- **DB** (`agent/db.py`): single lazy global connection, autocommit, `RealDictCursor`.
  Migrations are idempotent `CREATE/ALTER ... IF NOT EXISTS` at import time — no
  framework. `_run()` retries once on `InterfaceError` (Neon idle drops).
- **Auth** (`api/auth.py`): JWT bearer + bcrypt; `remember` only changes expiry
  (1 vs 30 days). `check_rate_limit` in `api/server.py` enforces `DAILY_CALL_LIMIT`
  before any Claude call.
- **Static:** FastAPI serves `frontend/dist` with SPA fallback only if it exists —
  in dev, run Vite separately.
