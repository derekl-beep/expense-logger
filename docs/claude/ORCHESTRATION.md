# Model Orchestration Guide

Binding rules for how the main conversation ("commander") uses subagents in this
environment. Written to fix [D1] in `docs/claude/DIAGNOSIS.md`. Audience: Sonnet-class
or weaker models running as the main session.

## 1. Delegate only for genuinely large or parallel work

This is a small, single-maintainer codebase. Subagent spawns are not free — each one
re-derives context from scratch and its report still lands in the commander's
context. Spawning for things the commander could just do directly is the #1 way a
session burns its token budget (see `LESSONS.md` 2026-07-08). Default to doing work
directly; delegate only when one of these is true:

- **Large-scale reading** — a scan that would pull in more than ~8 files or ~1500
  lines total → `Explore` agent (read-only, returns conclusions + `file:line`).
- **Repository-wide scanning** — "find every place X happens" across the whole tree,
  where you don't already have a good guess where to look → `Explore` agent.
- **Web research** — docs lookups, library comparisons → `general-purpose` agent
  (it has WebSearch/WebFetch). Exception: questions about Claude Code / Claude API
  itself → `claude-code-guide` agent.
- **Bulk mechanical editing** — the same change repeated across many (>5) files →
  `general-purpose` agent with an exact spec (see `TEMPLATES.md`).
- **Independent parallel work** — two unrelated subtasks that don't share files and
  the user asked for speed → parallel spawns.

The commander should directly: grep/read a handful of files to orient itself, make
edits to any number of files it understands, run tests/build, and talk to the user.
A single targeted `Grep` + `Read` of 2-4 files to answer a specific question is
normal, cheap, and preferred over a spawn for that same question. When a task is
small enough to just do, do it — do not delegate by default or "to be safe."

**Positive example:** "Where does the frontend decide to show the flagged badge?" →
`Grep` for the relevant term, `Read` the one matching file, answer directly.
**Counterexample (forbidden):** spawning an `Explore` agent to answer a question
`Grep` would answer in one call, or spawning a second agent to implement a change
after already reading the relevant file yourself.

## 2. What actually exists here (verified 2026-07-07 — do not trust memory over this list)

**Agent types** (`subagent_type` param of the Agent tool):
`claude` (default catch-all), `general-purpose`, `Explore` (read-only search),
`Plan` (read-only architect), `claude-code-guide` (Claude Code/API questions),
`statusline-setup` (ignore).

**Models** (`model` param of the Agent tool): `haiku`, `sonnet`, `opus`, `fable`.
`fable` may not be available after 2026-07-07 (plan/entitlement dependent) — if a
spawn with `model: "fable"` fails, fall back to `opus` and note the downgrade in
your report. If omitted, the subagent inherits the parent model.

**Effort:** the global setting is `effortLevel: "medium"` in
`~/.claude/settings.json`. There is **no per-Agent-call effort parameter** — do not
invent one. The `/code-review` skill takes its own effort argument
(low/medium/high/max/ultra). If a doc tells you to "raise effort," it means:
pick a stronger model, or use a skill's own effort argument — nothing else.

**Model selection defaults:**

| Task | Model |
|---|---|
| Mechanical search, file listing, simple lookups | `haiku` |
| Standard exploration, implementation, refactoring, review | `sonnet` |
| Cross-cutting design, gnarly debugging, second opinions, adversarial review | `opus` |

## 3. Delegation template (every spawn must contain all four parts)

```
OBJECTIVE: <one sentence: what and why — the why prevents literal-minded drift>
CONTEXT: <repo path(s), what is already known, what NOT to redo>
ACCEPTANCE CRITERIA: <checkable conditions; for code: which command must pass>
REPORT FORMAT: <see reporting contract below>
```

Task-type-specific fill-ins are in `docs/claude/TEMPLATES.md`. A spawn missing
acceptance criteria is a bug — the agent will decide for itself what "done" means.

## 4. Reporting contract

Subagents return to the commander **only**:

1. Conclusions (what was found/done/decided), as short prose.
2. `file:line` references for every claim.
3. Pass/fail status against each acceptance criterion, with the command output's
   last relevant lines for failures.

Anything long (full logs, generated docs, big diffs, research notes) must be written
to a file — deliverables into the repo, scratch into the session scratchpad directory —
and the report includes **only the file path**. Instruct this in every spawn prompt;
subagents don't know it by default.

## 5. Escalation / downgrade policy

- **haiku:** one mistake or one failed acceptance check → escalate to `sonnet`
  immediately. Do not retry haiku.
- **sonnet:** two failures on the *same* subtask → escalate to `opus`, and include
  the full failure trace (what was tried, exact error output, why each attempt was
  believed correct) in the new spawn's CONTEXT.
- **After the pattern is solved** by the stronger model (e.g., opus figured out the
  fix shape for one instance), downgrade back to `sonnet`/`haiku` for batch
  application across remaining instances, with the solved pattern pasted verbatim.
- **Hard cap: two retry rounds per issue.** After that, stop, write down the state
  (what's broken, what was tried, current hypothesis) and surface it to the user.
  Spending a third round is how sessions burn out with nothing written down.

## 6. Validation means running it, not spawning a second opinion

For routine changes, "validated" means the commander (or the implementing agent)
actually ran the relevant command and saw it pass — not a fresh agent re-reading the
diff. Do not spawn a validation agent by default; it's rarely worth the tokens for
work in a single-maintainer repo.

- **Code changed** → acceptance = tests or actual execution (`uv run pytest tests/`,
  targeted Playwright spec, `npm run build`), run directly. That is sufficient for
  routine changes.
- **Files/docs written** → re-read your own edit once and check paths/commands it
  references actually exist. A fresh-context reader is reserved for edits to the
  protected `docs/claude/*` rule files themselves (see `MAINTENANCE.md`), not for
  ordinary memory or README updates.
- **Only for genuinely high-risk judgment calls** (schema/data migrations, auth,
  security-sensitive logic, or a change touching ≥2 of the paired invariants in
  `CLAUDE.md`) → get a second opinion: a fresh `opus` agent with the question and
  *no* sight of the first answer, or generate 2-3 candidates and pick with stated
  reasons. This should be the exception, not the default.

**Positive example:** wrote a migration → ran it against `expense_logger_test`
directly and confirmed idempotency by running it twice. **Counterexample:** spawning
a fresh agent to review a one-line typo fix, or claiming "verified" with no command
run at all.

## 7. Limits (honesty clause)

Delegation and fresh-context review improve *execution*. They cannot resolve
ambiguity or supply taste. If the task is under-specified, subjective, or the
acceptance criteria can't be made checkable, do not launder the uncertainty through
subagents — follow `docs/claude/JUDGMENT.md` §Honesty clause (ask the user, escalate
model, or state plainly the task can't be done reliably).
