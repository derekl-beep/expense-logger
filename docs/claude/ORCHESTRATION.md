# Model Orchestration Guide

Binding rules for how the main conversation ("commander") uses subagents in this
environment. Written to fix [D1] in `docs/claude/DIAGNOSIS.md`. Audience: Sonnet-class
or weaker models running as the main session.

## 1. The commander never executes bulk work directly

The main conversation's context is the most expensive resource in the session: every
byte read into it is re-sent on every later turn. Therefore the commander only
**decides, delegates, edits small, and synthesizes**. It never does:

- **Large-scale reading** — anything beyond ~3 files or ~400 lines total → delegate
  to an `Explore` agent (read-only, returns conclusions + `file:line`).
- **Repository scanning** — "find where X happens", "how is Y wired" across the tree
  → `Explore` agent. State breadth explicitly: `"medium"` or `"very thorough"`.
- **Web research** — docs lookups, library comparisons → `general-purpose` agent
  (it has WebSearch/WebFetch). Exception: questions about Claude Code / Claude API
  itself → `claude-code-guide` agent.
- **Bulk file editing** — mechanical changes across >3 files → `general-purpose`
  agent with an exact spec (see `TEMPLATES.md`).
- **Plan design for multi-file changes** → `Plan` agent.

The commander MAY directly: read a single named file section it is about to edit,
run one test command, make edits of 1–3 files it fully understands, and talk to the
user. When in doubt, delegate.

**Positive example:** "Where does the frontend decide to show the flagged badge?" →
spawn `Explore` (breadth: medium) → get back `frontend/src/components/ExpenseTable.jsx:<line>`
→ commander reads just that region and edits.
**Counterexample (forbidden):** commander runs `Grep` five times, `Read`s four whole
components, then edits one line. Those four files now bloat every remaining turn.

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

## 6. Validation is never self-validation

The agent (or commander) that produced a change never certifies it alone:

- **Files/docs written** → a fresh-context agent reads them back and answers: "is it
  complete, internally consistent, and executable by someone with no other context?"
- **Code changed** → acceptance = tests or actual execution (`uv run pytest tests/`,
  targeted Playwright spec, `npm run build`), run by the commander or a fresh agent —
  not "the diff looks right."
- **High-risk judgment calls** (architecture, security, data migrations) → second
  opinion: spawn a fresh `opus` agent with the question and *no* sight of the first
  answer, then compare; or generate 2–3 candidate answers and select with stated
  reasons.

**Positive example:** after writing a migration, spawn a fresh sonnet agent:
"Read agent/db.py:1-80. Does the new ALTER statement run idempotently on a DB that
already has the column? Cite line numbers." **Counterexample:** the implementing
agent replies "I have verified the migration is idempotent" with no execution and
no fresh reader — that is a claim, not a validation.

## 7. Limits (honesty clause)

Delegation and fresh-context review improve *execution*. They cannot resolve
ambiguity or supply taste. If the task is under-specified, subjective, or the
acceptance criteria can't be made checkable, do not launder the uncertainty through
subagents — follow `docs/claude/JUDGMENT.md` §Honesty clause (ask the user, escalate
model, or state plainly the task can't be done reliably).
