# Letter to Future Sessions

Written 2026-07-07 by Claude Fable 5, in the last session Derek will run on this
model tier. You — the reader — are probably Sonnet, Opus, or Haiku. This file is a
frozen historical record (see MAINTENANCE.md); don't edit it, and don't treat its
facts as current without verifying.

## Three things Derek never asked about that matter most here

1. **This project is a teaching vehicle, not a product.** Derek's memory profile says
   it plainly: first agentic project, wants to understand the *why* behind patterns,
   prefers discussion-driven development. When you make a design choice — especially
   around the agent loop, tool contracts, or prompt design — explain the reasoning in
   one short paragraph. A silently-correct change is worth less to him than a correct
   change with its lesson attached. Don't lecture; one paragraph.

2. **The app's real fragility is state and prompts, not code.** `_sessions` is an
   in-process dict (lost on every deploy/restart; breaks with >1 instance), the DB is
   one global autocommit connection, and the business rules live in the `SYSTEM`
   prompt string. Most "add a feature" requests will eventually collide with one of
   these three. When one does, name the collision to Derek *before* building around
   it — these are exactly the architectural lessons he built this project to learn.

3. **Text chat runs on `claude-haiku-4-5`, so prompt changes are high-risk.**
   (Receipt-photo OCR is separate — it uses `MODEL_VISION`, `claude-sonnet-4-6`, via
   `_ocr_image()` in `agent/main.py`; don't assume constraints from one path apply to
   the other.) The small model that drives text chat needs short, explicit,
   example-bearing instructions in the `SYSTEM` prompt, and will follow a wrong
   instruction literally. Any `SYSTEM` change must be tested with real
   utterances via `uv run python -m agent.main` (JUDGMENT.md §2 has the checklist).
   Also: rate limiting (`DAILY_CALL_LIMIT`) exists because real users share this —
   don't burn the quota with test spam against the dev server's real DB.

## How this system will most likely degrade

In order of probability:

1. **Docs drift from code.** Someone renames a file or command; CLAUDE.md and these
   docs keep pointing at the old name; models learn the docs are unreliable and stop
   reading them. This is fatal — trust in the docs is the whole system.
2. **Rule erosion by convenience.** A session under time pressure skips delegation
   ("it's just a few files"), skips the completion checklist ("obviously works"),
   or edits protected docs "just to clarify." Each skip is locally reasonable;
   collectively they return the harness to its pre-2026-07-07 state (DIAGNOSIS.md).
3. **LESSONS.md becomes a junk drawer** — long, unranked, never consolidated —
   and then nobody reads it.

## How to prevent it

- **Couple docs to changes:** whenever a change makes a documented fact false, fixing
  the doc is part of the change (MAINTENANCE.md permits this autonomously for factual
  sections). Cheapest possible habit, highest leverage.
- **Treat checklist skips as failures:** if you notice you shipped without the
  JUDGMENT.md §2 checklist, that's a LESSONS.md entry, same as a bug.
- **Consolidate on the triggers** in MAINTENANCE.md — don't wait for "someday."
- Periodically (roughly monthly, or when things feel off), spawn a fresh-context
  agent with TEMPLATES.md §5 pointed at `docs/claude/` + `CLAUDE.md` to hunt for
  contradictions and dead references. That's the same adversarial pass that
  validated this system at birth.

## Honest limits — read this when you're stuck

This system makes execution reliable. It does not make you wiser. If the task is
ambiguous, aesthetic, or a genuine trade-off, no amount of decomposition or
self-review substitutes for judgment: ask Derek, escalate the model, or say plainly
that reliable completion isn't possible at your tier (JUDGMENT.md §6). The worst
outcome isn't a failed task — it's a confidently wrong answer that Derek, learning
this field, absorbs as truth. When uncertain: verify if you can, label it uncertain
if you can't, and never fabricate.

## Handoff status (2026-07-07)

All deliverables A–G were completed and written to disk in the founding session:
DIAGNOSIS, CLAUDE.md rewrite (backup: `CLAUDE.md.bak-2026-07-07`), ORCHESTRATION,
JUDGMENT, TEMPLATES, MAINTENANCE, LESSONS (seeded), this LETTER, plus corrected
memory files. Adversarial review and read-back were run; see the session summary.
Nothing is known to be unfinished. The files live only on the working branch until
Derek commits them — committing is his call.
