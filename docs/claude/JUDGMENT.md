# Judgment Rubrics

Judgment calls converted into checkable rules. Audience: Sonnet-class or weaker
models. Every rule has a positive example (do this) and a counterexample (this is the
failure the rule exists to prevent). Fixes [D2] and [D3] in `docs/claude/DIAGNOSIS.md`.

## 1. When to use a stronger model

Escalate (spawn `opus`, or tell the user to switch the main model) when **any** of:

- The task changes ≥2 of: DB schema, tool-calling contract (`agent/tools.py`),
  the agent system prompt, auth. Cross-cutting = design risk.
- You have failed the same subtask twice (see ORCHESTRATION.md §5 — mandatory).
- The user asks "should we…", "what's the right way…", or anything where the answer
  is a trade-off, not a fact.
- You notice you are unsure *and* the change is hard to reverse (data deletion,
  force-push, published content, prod config).

✅ **Positive:** "Move `_sessions` to Redis so multiple instances work" touches the
agent loop, deployment, and state semantics → spawn `Plan`/`opus` for design before
touching code.
❌ **Counter:** Escalating "rename this variable" to opus, or — worse — a haiku-tier
session redesigning the session store solo because "it seemed straightforward."

## 2. When work is genuinely complete

"Done" means the matching checklist below fully passes, **executed, not predicted**.
If a box can't be checked, the work is not done — say so explicitly.

**Backend Python change:**
- [ ] `uv run pytest tests/` passes from repo root (uses `expense_logger_test`, never
      the dev DB).
- [ ] If `agent/tools.py` touched: every schema property has a matching handler
      kwarg (invariant #1 in CLAUDE.md).
- [ ] If a tool/endpoint behavior changed: exercised once for real — via
      `uv run python -m agent.main` or a curl against the running API.

**Frontend change:**
- [ ] `npm run lint` and `npm run build` pass in `frontend/`.
- [ ] The affected Playwright spec file(s) pass (`npx playwright test e2e/<file>`).
      Full `npm run test:e2e` only for auth/routing/chat-stream changes.

**Agent behavior change (prompt text in `agent/main.py`):**
- [ ] The change is in the `SYSTEM` template, not bolted-on Python.
- [ ] Tested with ≥2 real utterances via `uv run python -m agent.main` (one typical,
      one edge case), and the transcript excerpt is shown to the user.

**Docs/memory change:**
- [ ] A fresh-context agent read it back and confirmed it is executable without
      other context (ORCHESTRATION.md §6).

✅ **Positive:** "Added `get_budget_status` tool; pytest passes (34 passed); exercised
via terminal agent — transcript attached." ❌ **Counter:** "I've added the tool and
it should work" — no command was run; this is the single most common weak-model
failure in this harness.

## 3. When to consult the user

Ask (and stop) when:

- Two legitimate interpretations of the request lead to **different user-visible
  behavior**, and picking wrong wastes >15 min of work.
- The action is destructive or outward-facing: deleting data, rewriting git history,
  pushing to `main`, sending anything off-machine.
- Completing the task requires a secret, account, or approval only the user has.

Do **not** ask when a convention already decides it (this file, CLAUDE.md, existing
code style), or when the choice is reversible and you can state your default in one
line and proceed.

✅ **Positive:** "Delete all flagged expenses older than a year?" → confirm; it's
irreversible data loss. ❌ **Counter:** "Should the new button be to the left or
right of Export?" → match the existing layout pattern and mention the choice; asking
this blocks an unattended session for hours.

## 4. Signals the current direction is wrong (switch, don't retry)

Stop and change approach — do not "try again but harder" — when:

- **The same error survives two different fixes.** Your model of the cause is wrong.
  Re-derive from evidence: reproduce minimally, read the actual failing code, print
  the actual runtime values.
- **The diff keeps growing** past ~2× your initial estimate for a "small" task.
  You're patching symptoms. Revert to last green (`git checkout -- .` or stash) and
  re-plan.
- **You're editing code you can't explain.** If you can't say in one sentence why a
  line fixes the problem, it doesn't.
- **You're fighting the framework** — monkeypatching, copying library internals,
  sleeping to fix race conditions. There is almost always a supported path; research
  it (delegate a web-research agent) before hacking.
- **Behavior change resists code edits** — in this repo, check the `SYSTEM` prompt in
  `agent/main.py` first; the logic is probably prose, not Python [D2].

✅ **Positive:** Second failed fix for a failing e2e test → stop, run the single spec
headed/traced, read the actual assertion, discover the seed data assumption changed.
❌ **Counter:** Adding a third `wait_for_timeout` to the same flaky spec.

## 5. Minimum quality bar (verify before reporting anything)

- Every factual claim about the code carries a `file:line` you actually looked at
  this session.
- Every "X passes/works" carries the command that was run and its tail output.
- Numbers (counts, versions, dates) are copied from tool output, never recalled.
- If you didn't verify something, label it: "unverified — inferred from Y."

## 6. Honesty clause — the limits of process

Decomposition, checklists, and multi-agent review raise execution reliability. They
**cannot** compensate for: ambiguous requirements, taste (naming, UX copy, API
aesthetics), or novel trade-offs with no checkable ground truth. When a task is in
that territory:

1. If the ambiguity is resolvable by the user → ask (rule 3).
2. If it needs stronger judgment → escalate the model (rule 1) or get an independent
   second opinion (ORCHESTRATION.md §6).
3. If neither is available → deliver your best attempt **explicitly labeled** as a
   judgment call with the alternatives you rejected and why. Never present a taste
   decision as a verified fact, and never fabricate certainty, benchmarks, or
   behavior you did not observe.
