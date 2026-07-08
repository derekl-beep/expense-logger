# Harness Diagnosis (written 2026-07-07 by Claude Fable 5)

Top three weaknesses of this harness as observed from the repo, settings, memory, and
session history. Every other document in `docs/claude/` exists to fix one of these.
Referenced as [D1], [D2], [D3] elsewhere.

## [D1] Token waste: the main conversation does its own bulk reading

**Evidence:** There are no delegation rules anywhere in this harness. CLAUDE.md (old
version, see `CLAUDE.md.bak-2026-07-07`) tells the model *about* the code but never
tells it to delegate exploration. Default behavior for any model is therefore to `Read`
whole files (`agent/main.py` is the system-prompt + loop file; `frontend/` has 14+
component files; `uv.lock` is 100KB) and to run the full Playwright e2e suite (which
boots two servers and seeds a database) to check one-line changes.

**Cost:** Every file read into the main conversation stays in context for the rest of
the session and is re-sent on every subsequent API call. A weaker model that reads five
frontend files "to get oriented" pays for them on every turn afterward.

**Fix (implemented):** `ORCHESTRATION.md` — hard rules on what may never run in the
main conversation, plus a reporting contract (subagents return conclusions and
`file:line` refs only; long output goes to a file). CLAUDE.md now routes to it.

## [D2] Focus loss: behavior lives in prompt text, but models edit Python

**Evidence:** The expense agent's business rules (date resolution, description
formatting, flagging semantics, when to query before update/delete) are encoded in the
`SYSTEM` prompt template inside `agent/main.py`, not in code. A model asked to "change
how dates are handled" will grep for date logic in Python, find fragments, and patch
the wrong layer. Similarly, `TOOL_DEFINITIONS` (JSON schema) and `TOOL_HANDLERS`
(functions) in `agent/tools.py` must change together, and `CATEGORIES` /
`CATEGORY_HINTS` in `agent/categories.py` must change together — nothing enforces this
except reading the docs.

Second focus hazard: stale memory. The auto-memory said "project complete, SQLite,
4 phases" while the repo had moved to Postgres, budgets, receipt OCR, and recurring
detection. A session trusting that memory starts oriented in the wrong direction.
(Memory corrected 2026-07-07.)

**Fix (implemented):** CLAUDE.md now leads with a short "paired invariants" list
(schema↔handler, categories↔hints, prompt-not-code) stated as checkable rules.
`MAINTENANCE.md` requires memory to be corrected the moment it is found wrong, and
requires dates on status claims.

## [D3] Mistakes: no verification contract — "done" is self-declared

**Evidence:** Nothing in the old CLAUDE.md says what must pass before a change counts
as complete. The repo has real verification tooling (`uv run pytest tests/`, Playwright
e2e with a deterministic seeded DB, `npm run lint`, `npm run build`), but using it is
left to the model's judgment. Weaker models reliably skip this: they edit, eyeball the
diff, and report success. The most common concrete failure modes in this codebase:
tool schema edited without its handler (breaks at runtime, not import), category added
in one place only, backend change verified against the dev DB instead of
`expense_logger_test`, and frontend changes never run through `npm run build`.

**Fix (implemented):** `JUDGMENT.md` §"When work is genuinely complete" — a per-change-type
checklist (backend / frontend / agent-prompt / docs) with exact commands. `ORCHESTRATION.md`
§"Validation is never self-validation" — acceptance by a fresh-context agent for anything
non-trivial.

## Honest limits of these fixes

Decomposition, checklists, and fresh-context review raise the floor on *execution*
quality. They do not raise the ceiling on *judgment*: an ambiguous request, a taste
call (UI wording, API shape, what "good" looks like), or a novel architectural
trade-off will not be saved by process. `JUDGMENT.md` §"Honesty clause" says exactly
what to do in those cases: escalate model, get a second opinion, or tell the user
plainly that the task can't be done reliably at the current tier. Never fabricate
confidence.
