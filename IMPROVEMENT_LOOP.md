# Continuous Improvement Loop

Goal: iterate MeetingMind past Granola's standard, with Chinese + English always
working. The loop is deliberately small: **one backlog item per iteration**, always
verified, always committed, so quality ratchets upward and never regresses.

## How to run it
- **On demand:** tell Claude Code — *"run one improvement iteration"* (or several).
- **Continuously:** `/loop run one improvement iteration per IMPROVEMENT_LOOP.md` —
  Claude self-paces and keeps taking the top backlog item until stopped.

## One iteration
1. **Pick** — take the top unchecked item in [BACKLOG.md](BACKLOG.md) (P0 before P1, etc.).
   If an item is blocked (needs the user, an API key, or a design decision), note why
   next to it and take the next one.
2. **Implement** — smallest change that fully solves the item. Respect CLAUDE.md
   constraints (no build step, relay stays a dumb pipe, CJK-aware text handling).
3. **Verify** — this gate is what makes the loop safe:
   - Run `node evals/run.mjs` (zh / en / mixed fixtures). All checks must pass.
   - If the change touches text processing, ADD fixtures covering it — in all three
     language modes — before considering it done.
   - If the change touches UI/audio, open meeting.html and check it loads with no
     console errors (audio-path changes additionally need a manual mic test —
     flag those for the user instead of pretending they're verified).
4. **Commit** — one commit per item, message `<item-id>: <summary>` (e.g. `Z1: CJK
   question detection`).
5. **Update the backlog** — move the item to Done with the commit hash; append any
   new issues discovered while working (with tier). This step is what makes the loop
   *continuous*: the backlog never empties, it re-prioritizes.
6. **Re-audit trigger** — after every 5 completed items, or whenever P0+P1 are empty,
   run a fresh audit pass: compare against Granola's current feature set, review new
   BytePlus/OpenRouter capabilities, and refill the backlog.

## Guardrails
- Never mark verified what wasn't run. Audio/ASR paths that need a live meeting are
  reported as "needs manual test" to the user.
- No regressions: evals accumulate — a fixture, once added, is never removed.
- Chinese-language behavior is release-blocking, not nice-to-have: every text-logic
  change ships with zh + mixed fixtures or it doesn't merge.
- Data-safety items (P1) may jump the queue over P0 if a real loss was just observed.

## Definition of "better than Granola"
Checklist to re-score at each re-audit:
- [x] Live transcription (Granola: yes) — plus live streaming display Granola lacks
- [x] Live rolling summaries (Granola: post-meeting only)
- [x] In-meeting auto Q&A with personal-vault RAG (Granola: no)
- [ ] Chinese + English + code-switching, end to end (Granola: weak — our key edge)
- [ ] Post-meeting structured synthesis w/ action items (Granola: yes — we're behind)
- [ ] User notes merged with transcript (Granola: yes — we're behind)
- [ ] Crash-safe: no meeting ever lost (Granola: yes — we're behind)
- [ ] Templates per meeting type (Granola: yes — we're behind)
