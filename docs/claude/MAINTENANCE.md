# Maintenance Protocol

How future sessions (any model tier) keep the `docs/claude/` system and memory
healthy without degrading it.

## Edit permissions

| Document | May edit autonomously? |
|---|---|
| `docs/claude/LESSONS.md` | **Yes** — append-only, this is where lessons go |
| Memory dir (`~/.claude/projects/.../memory/`) | **Yes** — corrections and new facts, per the format rules there |
| `CLAUDE.md` §Commands / §Architecture | **Yes**, only to fix facts that code changes made false (verify against code first, note it to the user) |
| `CLAUDE.md` invariants, `ORCHESTRATION.md`, `JUDGMENT.md`, `TEMPLATES.md`, `MAINTENANCE.md` (this file) | **User approval required** — propose the exact diff, explain what failure motivates it, wait |
| `DIAGNOSIS.md`, `LETTER.md` | **Frozen** historical records — never edit; supersede with a new dated file if needed |

Rationale: the rule files encode judgment from a stronger model; a weaker model
"simplifying" them is the main degradation risk (see LETTER.md).

## Recording lessons (mandatory after any real mistake)

A "real mistake" = wrong output shipped to the user, a broken invariant, a failed
approach that cost >15 minutes, or a user correction. Append to
`docs/claude/LESSONS.md` **in the same session**, using exactly this format:

```markdown
## YYYY-MM-DD <one-line title>
**What happened:** <2-3 sentences, concrete: files, commands, error text>
**Root cause:** <the actual cause, not the symptom>
**Rule:** <one imperative, checkable sentence a weaker model can follow>
**Ref:** <file:line or doc section this relates to>
```

Do not editorialize, do not write essays, do not record successes.

## Memory hygiene

- The moment memory contradicts observed reality, fix the memory file *then* — stale
  memory misdirects every future session ([D2] in DIAGNOSIS.md).
- Status claims must carry absolute dates ("as of 2026-07-07"), never "currently".
- One fact per file; update `MEMORY.md` index in the same step.

## Consolidation triggers

When **any** of these is true, run a consolidation pass (user approval for the result,
since it edits protected files):

- `LESSONS.md` exceeds ~15 entries → promote recurring patterns into the relevant
  rule file (one line each), delete the promoted entries, keep the rest.
- The same lesson appears twice → it belongs in `CLAUDE.md` invariants or
  `JUDGMENT.md`; propose it.
- A rule in any doc has been wrong/ignored for 3+ sessions → propose deleting it.
  Dead rules teach models to ignore the live ones.

Consolidation method: spawn a fresh-context review agent (TEMPLATES.md §5) on the
proposed new versions before showing the user.

## Verification of doc edits

Any edit to these docs, including autonomous ones, ends with a read-back check:
re-read the edited section and confirm (a) every path/command it mentions exists —
actually `ls`/run them, (b) it doesn't contradict the other docs. If you can't
verify a claim, mark it "unverified" rather than asserting it.
