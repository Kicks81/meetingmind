# MeetingMind — Granola-replacement live meeting note taker

## What this is
A local, single-file web app that live-transcribes meetings (mic + system audio),
generates rolling summaries, auto-answers questions asked in the meeting (with
Obsidian-vault RAG), and exports notes into Obsidian. Goal: **exceed Granola's
standard**, with first-class **Chinese + English (incl. code-switching)** support.

## Architecture
- [meeting.html](meeting.html) — the entire app (UI + logic, no build step). Open directly in Chrome.
- [relay.js](relay.js) — tiny Node WebSocket relay; adds the auth headers browsers can't set on a
  WS handshake and pipes bytes to BytePlus ASR untouched. Run with `node relay.js` (port 8765).
- [start.bat](start.bat) — installs `ws` if missing, starts relay, opens Chrome.
- ASR: BytePlus Seed-ASR streaming (`bigmodel_async`, resource `volc.seedasr.sauc.duration`),
  16 kHz PCM16 mono, gzip-framed binary protocol implemented in meeting.html.
- LLM: OpenRouter (user-selectable model), streaming responses.
- Export: `obsidian://new` URIs, one note per meeting grown via `append=true` chunks
  (~30k char URI limit → auto-split).

## Hard constraints
- **Chinese + English must both work end to end.** Any logic that tokenizes, counts words,
  or matches punctuation MUST handle CJK (no-space text, full-width ？。！，) as well as ASCII.
  Test every text-processing change against zh, en, and mixed zh-en input.
- No build step. meeting.html stays openable from disk (file://). Keep it dependency-free.
- The relay stays a dumb pipe — no protocol logic in relay.js.
- API keys are user-supplied at runtime; never hardcode keys.

## Continuous improvement loop
See [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md) for the iteration protocol and
[BACKLOG.md](BACKLOG.md) for the prioritized work queue. One iteration = pick top
backlog item → implement → verify (evals + manual check) → commit → update backlog.

## Verification
- Pure text-processing logic lives in (or should be extracted to) testable functions;
  run `node evals/run.mjs` (once it exists — backlog item L0) for regression checks.
- For UI/audio changes: open meeting.html in Chrome, use the relay, and sanity-check
  with a short recording. ASR requires a valid BytePlus key — evals must not depend on it.
