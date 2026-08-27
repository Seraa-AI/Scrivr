---
name: scrivr-review
description: Scrivr's pre-ship review. Runs seven specialized reviewers in parallel over the current diff — data flow, conditions, readability, comments, public API surface, typing discipline, repo conventions — and returns one ranked verdict. Run this before every ship and before merging any PR.
---

# Pre-ship review

**Run before every `/ship` and before merging any PR.** Nothing lands without it.

This is not a second opinion on whether the feature is a good idea. It is a
check that the change is *correct, legible and consumable* — the four things
that have actually cost this repo time: a value crossing a layer boundary wrong,
a guard that cannot fire, a comment that is no longer true, and a public helper
whose types nobody can import.

## Step 1 — scope the diff

```bash
git fetch -q origin
BASE=$(git merge-base HEAD origin/main)
git diff --stat "$BASE"...HEAD
git diff "$BASE"...HEAD
```

For a PR under review instead of the current branch, use
`gh pr diff <N> --patch` and say which PR you scoped to.

If the diff is empty, stop and say so. If it exceeds roughly 2000 lines, tell
the user which files you are focusing on and why, rather than reviewing
everything shallowly.

## Step 2 — run the reviewers

Spawn all seven in **one message** so they run concurrently. Each is read-only
and returns findings, not edits.

| Agent | Reviews |
|---|---|
| `scrivr-dataflow` | where values are produced, who owns them, boundaries they cross |
| `scrivr-conditions` | guards, empty and boundary states, error paths, unreachable branches |
| `scrivr-readability` | naming, structure, self-documenting code, dead or parallel code |
| `scrivr-comments` | why over how, concision, self-containment, comments that lie |
| `scrivr-api-surface` | barrel exports **verified by importing**, changeset correctness |
| `scrivr-types` | inline type imports, `as` casts, ProseMirror import path |
| `scrivr-conventions` | dead view hooks, export parity, seam fixes, test discipline |

Give each agent: the base ref, the diff, and one line on what the change is
trying to do. Tell each to report `file:line` evidence and a user-visible
consequence, and to say plainly when its dimension is clean.

The `scrivr-api-surface` agent must **build and run the import check** whenever
the diff touches a barrel, an exported type, or a `package.json`. Grepping
`dist/index.d.ts` is not evidence — tsup inlines every referenced declaration,
exported or not.

## Step 3 — verify before reporting

Findings arrive as claims. Before repeating one, check it:

- Does the cited `file:line` say what the agent thinks it says?
- Is the failure case real, or does an existing guard already handle it?
- Is it in this diff, or pre-existing? Pre-existing problems are worth naming
  but must be labelled as such — they do not block the ship.

Drop anything you cannot stand behind. A wrong finding costs more than a missed
one, because it burns the reviewer's credibility for the next real one.

Dedupe across agents: several will legitimately notice the same defect from
different angles. Merge those into one finding with the strongest evidence.

## Step 4 — report

Rank by severity, most severe first:

- **BLOCKER** — wrong output, data loss, a broken public surface, a silently
  inert code path. Do not ship.
- **SHOULD-FIX** — real but survivable: a comment that misleads, a guard that
  is too wide, a missing export guard.
- **NOTE** — worth knowing, not worth blocking.

Each finding: what is wrong, `file:line`, why it matters to a user or a
consumer, and the smallest correct fix. End with one line:

```
VERDICT: SHIP  |  FIX FIRST (n blockers)
```

If everything is clean, say so directly and name what was checked — a review
that never returns "clean" is a review nobody believes.

## Notes

- Reviewers are read-only. Applying fixes is a separate, explicit step.
- The user decides. A finding is a recommendation with evidence attached, and
  they have context the reviewers do not.
- If a rule here is wrong or has been superseded, say so in the report rather
  than following it quietly.
