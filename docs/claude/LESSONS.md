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
