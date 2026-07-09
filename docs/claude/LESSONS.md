# Lessons Log

Append-only. Format and rules: `docs/claude/MAINTENANCE.md` §Recording lessons.
Newest entries at the bottom.

## 2026-07-07 Stale memory misdirected sessions
**What happened:** Auto-memory (`project_status.md`) said the project was "complete"
on SQLite with 4 phases, while the repo had Postgres, budgets, receipt OCR, and
recurring detection. Any session trusting it started wrongly oriented.
**Root cause:** Memory written once at a milestone and never updated as work continued.
**Rule:** When memory contradicts the code or git log, correct the memory file in the
same session, with an absolute date.
**Ref:** docs/claude/MAINTENANCE.md §Memory hygiene

## 2026-07-08 Delegation rules burned the token budget
**What happened:** `ORCHESTRATION.md`'s original thresholds (delegate anything past
~3 files/~400 lines) and `JUDGMENT.md`'s blanket fresh-context-agent validation
requirement caused a single feature implementation to spawn many subagents and
background processes, exhausting the token budget for a fresh session on Sonnet.
**Root cause:** The rules were written for a large/high-risk-change assumption, but
this is a small single-maintainer repo where most tasks don't need that overhead.
**Rule:** Delegate only for genuinely large scans (>8 files/~1500 lines) or bulk
mechanical edits (>5 files); default to doing work directly. Reserve fresh-context
validation agents for high-risk changes and edits to protected `docs/claude/*` files,
not routine code/doc changes.
**Ref:** docs/claude/ORCHESTRATION.md §1, §6; docs/claude/JUDGMENT.md §2
