# MeetingMind — Granola-replacement live meeting note taker

## What this is
A local, single-file web app that live-transcribes meetings (mic + system audio),
generates rolling summaries, offers proactive
role-relevant question suggestions, answers questions the user types, and
exports notes into Obsidian. Goal: **exceed Granola's
standard**, with first-class **Chinese + English (incl. code-switching)** support.

## Architecture
- [meeting.html](meeting.html) — the entire app (UI + logic, no build step). Open directly in Chrome.
- [relay.js](relay.js) — tiny Node WebSocket relay; adds the auth headers browsers can't set on a
  WS handshake and pipes bytes to BytePlus ASR untouched. Run with `node relay.js` (port 8765).
- [start.bat](start.bat) — installs `ws` if missing, starts relay, opens Chrome.
- ASR: BytePlus Seed-ASR streaming (`bigmodel_async`, resource `volc.seedasr.sauc.duration`),
  16 kHz PCM16 mono, gzip-framed binary protocol implemented in meeting.html.
- LLM: OpenRouter (user-selectable model), streaming responses.
- Export: direct writes to the vault folder via the File System Access API (no size
  limit, one write per chunk; see D25/D28/E5) once a vault directory is connected;
  `obsidian://new` URIs (grown via `append=true`, ~30k char limit → auto-split) remain
  as the `file://`-mode fallback when no vault handle is available.

## Hard constraints
- **Chinese + English must both work end to end.** Any logic that tokenizes, counts words,
  or matches punctuation MUST handle CJK (no-space text, full-width ？。！，) as well as ASCII.
  Test every text-processing change against zh, en, and mixed zh-en input.
- No build step. meeting.html stays openable from disk (file://). Keep it dependency-free.
- The relay stays a dumb pipe — no protocol logic in relay.js.
- API keys are user-supplied at runtime; never hardcode keys.

## Developer onboarding
[DEVELOPMENT.md](DEVELOPMENT.md) records every architecture decision and its
rationale (D1–D12), known sharp edges, and the eval philosophy — read it before
changing anything non-trivial.

## Continuous improvement loop
See [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md) for the iteration protocol and
[BACKLOG.md](BACKLOG.md) for the prioritized work queue. One iteration = pick top
backlog item → implement → verify (evals + manual check) → commit → update backlog.

## Verification
- Pure text-processing logic lives in (or should be extracted to) testable functions;
  run `node evals/run.mjs` for regression checks (289 checks at time of writing).
- For UI/audio changes: open meeting.html in Chrome, use the relay, and sanity-check
  with a short recording. ASR requires a valid BytePlus key — evals must not depend on it.
