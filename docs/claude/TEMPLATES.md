# Delegation Prompt Templates

Copy the matching template into the Agent tool's `prompt`, fill every `<...>`
placeholder, delete nothing. Agent-type and model choices follow
`docs/claude/ORCHESTRATION.md` §2. All templates end with the same reporting
contract — subagents do not know it unless you include it.

Shared footer — include verbatim in every spawn:

```
REPORT FORMAT: Return ONLY (1) conclusions as short prose, (2) file:line references
for every claim, (3) pass/fail per acceptance criterion with the last ~10 lines of
output for any failure. Write anything longer (logs, notes, generated docs) to
<file path, or "your scratchpad directory"> and return just the path. Do not paste
whole files back.
```

## 1. Search / exploration  (agent: `Explore`, model: `haiku` or `sonnet`)

```
OBJECTIVE: Find <what> in <repo/dir> so that <why — what decision this feeds>.
SEARCH BREADTH: <"medium" | "very thorough">
CONTEXT: Already known: <facts/locations to skip>. Do not re-derive these.
QUESTIONS TO ANSWER:
1. <specific question>
2. <specific question>
ACCEPTANCE CRITERIA: Every question answered with file:line, or explicitly marked
"not found after checking <where you looked>". No guesses presented as findings.
<shared footer>
```

## 2. Implementation  (agent: `general-purpose`, model: `sonnet`)

```
OBJECTIVE: Implement <feature/fix> in <files/area>, because <why>.
CONTEXT: <relevant architecture facts + pointer: "Read CLAUDE.md invariants first">.
Constraints: <what must NOT change — API shapes, files off-limits, style>.
SPEC:
- <concrete behavior 1, with an input/output example>
- <concrete behavior 2>
ACCEPTANCE CRITERIA:
- <exact command> passes, run from <dir>.
- <observable behavior check, e.g. "curl X returns Y">.
- Diff touches only <expected files>; flag anything else before doing it.
If an acceptance criterion cannot be met after 2 attempts, STOP and report the
failure trace instead of working around it.
<shared footer>
```

## 3. Refactoring  (agent: `general-purpose`, model: `sonnet`)

```
OBJECTIVE: Refactor <target> to <end state>, because <why>. Behavior must be
IDENTICAL before and after.
CONTEXT: <current structure, file:line anchors>.
METHOD: Run <test command> BEFORE touching anything and record the result; refuse
to start if it's already red. Refactor in small steps, re-running after each.
ACCEPTANCE CRITERIA:
- <test command> passes with the same results as the pre-refactor run.
- No public signature / API / DB schema changed (list exceptions: <none|...>).
- grep for <old name/pattern> returns zero hits outside <allowed places>.
<shared footer>
```

## 4. Research  (agent: `general-purpose`, model: `sonnet`; Claude-Code/API questions → agent: `claude-code-guide`)

```
OBJECTIVE: Answer <question> to decide <the decision it feeds>.
CONTEXT: Environment facts: <versions, constraints from this repo>. Prior findings:
<what not to re-research>.
METHOD: Prefer primary sources (official docs, changelogs, source code) over blog
posts. Record the URL and retrieval date for every claim.
ACCEPTANCE CRITERIA:
- Each sub-question answered with source URL(s).
- Claims that could not be verified are labeled "unverified".
- Ends with a one-paragraph recommendation and the strongest argument AGAINST it.
Write full notes to <path>; return the recommendation + sources only.
<shared footer>
```

## 5. Review / acceptance  (agent: `general-purpose`, model: `sonnet`; high-risk → `opus`)

Spawn with **fresh context** — never the agent that wrote the change. For working-tree
code review, prefer the `/code-review` skill (Skill tool, args e.g. `medium`) over a
hand-rolled reviewer; use this template for docs read-back and non-diff acceptance.

```
OBJECTIVE: Adversarially review <files/diff> against <spec/acceptance criteria>.
You did not write this; assume it has at least one defect and try to find it.
CONTEXT: The change claims to <claimed behavior>. Spec: <paste or path>.
CHECK:
1. Does it actually do what it claims? Execute <command> yourself; don't trust
   the author's report.
2. Contradictions with CLAUDE.md invariants or docs/claude/* rules.
3. Broken references: file paths, tool names, commands — verify each one exists.
4. Ambiguity: any instruction a weaker model could reasonably misread — quote it
   and propose exact replacement wording.
ACCEPTANCE CRITERIA: Verdict per checked item (pass / fail+evidence). Zero findings
is an acceptable outcome only if you state what you executed to look.
<shared footer>
```
