# Multi-model improvement loop

Roles (fixed):
- **Fable 5 — Orchestrator.** Owns the roadmap, sequences items, writes each item's task spec, never writes app code directly.
- **Sonnet 5 — Executor.** Implements exactly one backlog item per iteration. Must run `node evals/run.mjs` and report results honestly. May not touch scoring, evals' pass criteria, or unrelated code.
- **Opus — Auditor (gatekeeper).** Reviews the diff against the item's acceptance criteria: correctness, CJK safety (zh/en/mixed), no regressions, no scope creep. Verdict is **APPROVE** or **REJECT + concrete required fixes**. Work does not advance until Opus approves.
- **Haiku — Scribe.** After (and only after) Opus approves: updates BACKLOG.md status, appends any new decision to DEVELOPMENT.md, commits with the `<id>: summary` convention, and pushes to GitHub (origin/main).

Loop per item:

```
Fable writes spec → Sonnet implements + evals → Opus audits
        ▲                                          │
        └────────── REJECT (max 3 rounds) ◄────────┘
                                                   │ APPROVE
                              Haiku: docs + commit + push → next item
```

Rules:
- One item at a time; never start item N+1 before Haiku has pushed item N.
- If Opus rejects 3 times, the loop halts and escalates to the human with the full rejection history.
- Hard constraints from CLAUDE.md apply to every role: no build step, relay stays a dumb pipe, CJK-safe text processing, no hardcoded keys.
- Evals must pass before Opus even sees the diff; a failing eval run is an automatic bounce back to Sonnet.

Current queue: Phase 1 "Stop the crashes" (see BACKLOG.md P0 items), then Phase 2 data safety, Phase 3 structural, Phase 4 hardening.
