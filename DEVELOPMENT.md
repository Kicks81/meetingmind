# MeetingMind — Developer Notes: Architecture, Rationale & Decisions

For the next developer (human or AI). This documents **why** things are the way they
are, so you don't undo a deliberate decision or re-fight a battle that's already been
lost once. Read [CLAUDE.md](CLAUDE.md) for hard constraints, [BACKLOG.md](BACKLOG.md)
for what's next, [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md) for how changes get made.

---

## 1. What this product is

A local, single-user Granola replacement: live meeting transcription (mic + system
audio), rolling LLM summaries, automatic + manual Q&A grounded in the user's Obsidian
vault, and export into Obsidian — with **first-class Chinese + English support,
including code-switching**, which is the product's key edge over Granola.

The primary user runs Windows 11 + Chrome, keeps notes in an Obsidian vault, and
attends meetings in mixed zh/en (Singapore business context).

## 2. File map

| File | Role |
|---|---|
| [meeting.html](meeting.html) | The entire app: UI, audio capture, BytePlus binary protocol, LLM calls, Obsidian export. No build step. |
| [core.js](core.js) | Pure text-processing logic (UMD). Loaded by meeting.html **and** by the Node eval harness. No DOM, no network, no timers — keep it that way. |
| [relay.js](relay.js) | Node WebSocket relay + static file server. Dumb byte pipe to BytePlus. |
| [evals/run.mjs](evals/run.mjs) | Regression suite for core.js (zh / en / mixed fixtures). `node evals/run.mjs` |
| [start.bat](start.bat) | One-click startup: installs `ws`, starts relay, opens Chrome at localhost. |

## 3. Architecture decisions & rationale

### D1. Single HTML file, no build step
The user opens the app directly; there is no deploy pipeline, bundler, or framework.
This is deliberate: the whole product must be runnable by double-clicking `start.bat`
on a corporate Windows laptop with only Node + Chrome installed. Resist the urge to
introduce npm build tooling — every dependency is a support burden on a machine we
don't control. `core.js` was split out **only** because testability required it
(Node can't import from an HTML file); it uses a UMD wrapper so both environments
load the same file unmodified.

### D2. The relay is a dumb pipe (and also the web server)
Browsers cannot set HTTP headers (`X-Api-Key` etc.) on a WebSocket handshake, and
BytePlus requires them — hence the relay. It deliberately contains **zero protocol
logic**: it forwards opaque bytes both ways. All BytePlus framing (gzip, binary
headers, sequence flags) lives in meeting.html, so protocol bugs are debuggable in
one place, in DevTools.

The relay also serves meeting.html/core.js over `http://localhost:8765`. Reason:
Chrome **refuses to persist microphone permission for `file://` pages**, which forced
a permission prompt on every single meeting. Serving from a localhost origin makes
"Allow while visiting the site" stick permanently. Static serving is infrastructure,
not protocol logic — it does not violate the dumb-pipe rule.

### D3. BytePlus Seed-ASR (`bigmodel_async`) for speech
Chosen because it is one of the few streaming ASRs genuinely strong at zh/en
**code-switching** (mid-sentence language changes), which Web Speech API and most
Western ASRs handle poorly. Details that matter:
- 16 kHz PCM16 mono, gzip-framed binary protocol (implemented in meeting.html).
- `end_window_size: 800` controls utterance finalisation latency.
- **Hotwords** (`request.corpus.context`) bias recognition toward names/jargon —
  the correction dictionary's "right" terms are auto-fed here (see D8).
- Each new session numbers utterances from 0 — on reconnect you MUST reset
  `finalizedUtteranceCount` or segments get skipped/duplicated.
- BytePlus kills sessions that receive no audio within ~8s of opening. That's why
  all audio-capture setup (including the user-facing share picker!) happens BEFORE
  the socket opens.

### D4. OpenRouter for LLM, user-selectable model
One API for many models lets the user trade cost/speed/quality per meeting.
DeepSeek V4 Flash is the recommended default for zh-heavy meetings (zh-native,
cheap, fast). All calls stream (`stream: true`) into the DOM for perceived speed.
`max_tokens` is 512 for rolling summaries/answers, 1200 for the final synthesis.

### D5. Obsidian export via `obsidian://new` URIs — and its landmines
There is no filesystem access from the browser, and no Obsidian REST API without
plugins the user would have to install. The URI scheme is the zero-setup path, but
it has sharp edges (all discovered the hard way):
- **~30k char URI limit.** One meeting = one note, grown via `append=true` chunks.
  Anything bigger than one URI is **bisected** into multiple appends, sent ~600ms
  apart (Obsidian drops rapid back-to-back protocol navigations).
- **Never fall back to silent downloads.** The original fallback downloaded a .md
  with only a console.warn — the user lost days of notes to it before noticing.
  If a single element is genuinely too big for a URI, download it AND `alert()`.
- **Vault NAME, not path.** `vault=` takes the name; users paste paths, so
  `normalizeVaultName()` reduces a path to its basename.
- **Manual encoding.** `encodeURIComponent`, not `URLSearchParams` — the latter
  encodes spaces as `+`, which Obsidian does not decode back.
- **Fire-and-forget.** There is NO acknowledgement that Obsidian received a URI.
  Export state (`data-obsidian-exported`) is optimistic; that's why "Add to
  Obsidian" offers a full re-send when everything is already marked exported.

### D6. CJK-aware text processing (the reason core.js exists)
Chinese has no spaces and different punctuation. Every text function has an
explicit CJK strategy, and each was a real bug once:
- **Question detection**: matches `？` as well as `?`; treats `。！？` as sentence
  boundaries; lower min-length floor for CJK (a real zh question can be 5 chars).
- **Word counting**: CJK characters count ÷2 (avg zh word ≈ 2 chars) + Latin word
  tokens. Whitespace splitting counted a whole zh utterance as "1 word", so the
  80-word summary trigger *never fired* in Chinese meetings.
- **Vault search**: CJK query terms become character **bigrams** (zh words are
  mostly 2 chars); bigrams containing function characters (的/是/谁…) are dropped
  as noise; Latin terms score 2× a bigram so exact terms rank first.
- **Language pinning**: LLMs answer in English by default. `dominantLanguage()`
  classifies each batch by CJK share (≥70% zh, ≤30% en, else mixed) and appends a
  response-language instruction to every prompt.

**Rule: any new text-processing logic goes in core.js with zh + en + mixed
fixtures in evals/run.mjs, or it will regress.** This is enforced by culture, not
tooling — keep the culture.

### D7. Eval harness philosophy
`evals/run.mjs` is dependency-free Node (no test framework — nothing to install).
Two assertion types:
- `check(name, actual, expected)` — normal regression fixture. Never delete one;
  update an expectation only when behaviour intentionally improves.
- `expectFail(name, actual, desired)` — documents a **known bug**: it passes while
  the bug exists and fails loudly the moment the behaviour is fixed, forcing the
  fixture to be promoted to `check()` in the same change. This is the ratchet that
  kept the Z1–Z3 Chinese bugs from being forgotten.
It also greps meeting.html to ensure logic isn't duplicated inline again.

### D8. Correction dictionary (ASR fix-ups) — two-layer design
ASR consistently mis-hears names ("Swetha" → "chata chataly"). Fixes are applied at
two layers on purpose:
1. **Post-ASR text substitution** (core.applyCorrections): longest-wrong-first;
   Latin = case-insensitive with per-edge word boundaries (a `\b` is only added
   next to a word char, so "a.f.o." still matches); CJK = plain substring (no \b
   in CJK). Runs *before* summaries/Q&A/export see the text.
2. **ASR biasing**: every correction's "right" term is merged into the BytePlus
   hotword list at session start, so recognition itself improves over time.
Stored in localStorage (`meetingmind_corrections`). UI: select text → ✏️ Fix;
manage via the 📖 button.

### D9. Crash-safety via localStorage snapshots (not IndexedDB)
The whole session serialises to ONE localStorage key every 5s + on `beforeunload`,
with restore offered on load. localStorage was chosen over IndexedDB deliberately:
synchronous, 3 lines of code, and a 2-hour meeting serialises to ~200KB — nowhere
near the ~5MB quota. If multi-meeting history is ever added (backlog), migrate to
IndexedDB then, not before. The snapshot includes export flags and the Obsidian
note path so a restored session continues appending to the *same* note.

### D10. Auto-reconnect keeps the audio graph alive
On mid-meeting socket drop: retry with 1s→15s backoff while `isRecording`. The Web
Audio graph is left running throughout — only the socket is rebuilt — so the gap in
the transcript is just the disconnected seconds, not a mic re-permission or picker
re-prompt. `asrReady` gates the audio sender; `asrReconnecting` prevents loop pile-up.

### D11. UI decisions worth knowing
- **Summary panel gets ~2/3 width** and unconditional auto-scroll
  (`data-autoscroll="always"`); the transcript keeps *conditional* auto-scroll so
  users can scroll back to select/fix text without the panel jumping away.
- After streaming finishes, the plain streamed text is swapped for rendered
  markdown, which is TALLER — you must re-pin scroll after that swap.
- Markdown rendering happens once at stream end (not per-token) so a half-streamed
  `**` never renders broken.
- ScriptProcessorNode is deprecated but kept for now (works everywhere, one code
  path); AudioWorklet migration is backlog L1 — do it in one dedicated change.

### D12. Keys & config
API keys are user-supplied at runtime, persisted per-origin in localStorage, and
optionally exported to a JSON file (Save/Load Config) because corporate browser
policies sometimes wipe site data. The config file is plaintext — encrypting it is
backlog L2. **Never hardcode keys anywhere, including tests.**

### D13. Growing transcription delay over long meetings — investigation (2026-07-09)
Users reported transcription falling further and further behind the live speech
the longer a meeting ran (noticeable by ~1hr). Investigation (code-level, not live
profiling — no way to reproduce a 1hr session in this environment) found two
concrete, evidenced, growing-with-time costs and one structural vulnerability that
lets them translate into audio delay specifically (not just UI sluggishness):

1. **Unbounded `meetingContext`** (was backlog R3) — every summary/Q&A LLM call
   sent the ENTIRE rolling context, which only ever grew. After ~1hr that's tens of
   thousands of characters on every single call — more input tokens, strictly
   increasing latency per call. Fixed: capped at `MEETING_CONTEXT_CHAR_CAP` (6000
   chars, oldest dropped) right after each append in `generateSummary`. Safe to
   truncate because `meetingContext` is only the rolling PROMPT — the actual
   content is already preserved in the on-screen summary blocks and the Obsidian
   export regardless.
2. **`autosave()` re-serialized the ENTIRE meeting every 5 seconds, forever.**
   `snapshotState()` used to call `.querySelectorAll` + read `.innerHTML`/
   `.textContent` off EVERY transcript segment / summary block / Q&A card ever
   created — O(total meeting size) — on every single tick, regardless of whether
   anything had changed. This cost strictly grows with meeting length. Fixed: each
   element caches its own snapshot fragment (`el.__snap`), computed once and
   invalidated only at real mutation points (segment correction retro-apply,
   Obsidian export-flag toggle in both directions, summary edit-commit). Snapshot
   is now O(unchanged-elements-are-free) instead of O(total size) every 5s.

**Not fixed here — the structural root cause**: `ScriptProcessorNode`'s audio
callback runs on the main JS thread (this is WHY it's deprecated in favor of
`AudioWorkletNode`, which runs on a dedicated real-time audio thread). That means
ANY main-thread congestion — not just the two items above, but also DOM growth,
GC pauses from ever-growing strings, LLM response streaming into the DOM — directly
delays mic capture/encoding/sending. The two fixes above remove the two concrete,
provably-growing contributors found in code, but the coupling itself remains.
**AudioWorklet migration (backlog L1) is the definitive fix** and has been promoted
above cleanliness-tier priority — it's audio-pipeline surgery, needs a dedicated
change and a live-mic test per the guidance in D11, and was deliberately not
attempted as a side effect of this investigation.

If the delay persists (or reappears) after L1 lands, the next things to check:
WebSocket `bufferedAmount` on `asrSocket` (backpressure — is the browser queuing
audio faster than the relay/network can drain it?), and whether BytePlus's
duration-based resource (`volc.seedasr.sauc.duration`) exhibits any session-length
throttling — that would be provider-side and outside this codebase's control.

### D18. Autosave quota safety — byte-budget trimming (2026-07-10)
localStorage has a ~5MB quota. Long meetings' autosave snapshots can exceed it,
causing silent write failures (`QuotaExceededError`) and data loss — the meeting
would restore with missing transcript. Solution: measure in **UTF-8 bytes**
(TextEncoder available in both Node and browsers), not JS string length
(which counts UTF-16 code units and is wrong for CJK). Two functions:
1. `trimSegmentsToByteBudget(segments, budget)` — pure function, drops oldest
   segments until the tail fits the byte budget. A single oversized segment is
   never truncated (always kept whole).
2. `trimSnapshotToByteBudget(snap, budget)` — applies trimming to the entire
   snapshot and **rebuilds `finalTranscript` from the kept segments**. Reason:
   `finalTranscript` is an untrimmed running duplicate of the same segment text
   (see meeting.html `finalTranscript += ' ' + text`); trimming segments alone
   never shrinks the snapshot enough because the duplicate defeats the trim.
   This was caught in auditor rejection notes and is why both per-segment and
   whole-snapshot functions exist.
Byte budget set to 4MB in meeting.html (leaving 1MB headroom for corrections +
browser overhead under the ~5MB quota). When trimming is necessary, the user sees
a warning banner ("Autosave is trimming old transcript…", 15s + close button).
Restored sessions show a marker in the transcript panel indicating trimmed
segment count; summaries/Q&A/actions/meetingContext are untouched (only raw
transcript is trimmed). Evals: `lengthInUtf8Bytes` (ASCII/CJK), `trimSegmentsToByteBudget`
(empty/en/zh/mixed/oversized input), `trimSnapshotToByteBudget` (end-to-end,
verifies finalTranscript is rebuilt correctly and other snapshot fields untouched).

### D17. Q&A panel split layout and action-item dismissal (2026-07-10)
The Q&A panel is split into two independently-scrolling halves (top: Q&A,
bottom: Action Required) so long meetings don't starve the action list at the
bottom. Each gets ~50% flex space and `min-height` to ensure both remain usable.
Action items are user-dismissible (✕ button) — deletion moves the action's key
into `dismissedActions`, which persists across the session. Reason: the LLM will
likely re-extract the same false-positive action from similar speech later; by
tracking dismissed keys, we prevent it from re-surfacing. Final synthesis uses the
curated list (actions not in `dismissedActions`) verbatim instead of asking the
LLM to re-derive actions — this ensures a user's deletions are honored in the
exported note. The same dismissal pattern could apply to Q&A in future (backlog item).
Evals cover parseActionList/actionKey (zh/en/mixed); action **detection** and UI
integration require a live BytePlus key and are manually tested only.

### D14. LLM pipeline error resilience — never lose transcript text
All LLM call sites (rolling summary, final synthesis, Q&A answers) wrap streaming
calls in try-catch-finally: request failures / mid-stream network drops / JSON parse
errors are caught, never propagated as unhandled rejections. Failed text batches are
re-queued to `pendingText` so they're covered by the next summary update. Fire-and-
forget calls (detectAndAnswerQuestions, generateSummary) have `.catch(err =>
console.error(...))` guards. The spinner is always cleared in `finally` blocks, even
on failure. Errors are shown to the user via `flashStatusError()` (visible in the
status bar for 4s), not just logged. The philosophy: a flaky network or slow API must
never cause data loss, a stuck spinner, or an unhandled promise rejection.

### D15. Serialized summary generation — preventing concurrent mutations
Multiple async triggers fire independently: the word-count threshold timer, the
silence-timeout timer, and the stop-recording button can all call `generateSummary()`
at overlapping times. Without serialization, concurrent calls would interleave their
streaming output and `meetingContext`/`pendingText` mutations, corrupting meeting
state. Solution: `summaryQueue` (a Promise chain) ensures at most one summary streams
at a time. The public API `generateSummary(newText)` appends to the queue; the actual
implementation `runGenerateSummary()` never throws (errors are caught and pendingText
is re-queued), so the chain never breaks. This is the only place in the codebase where
we explicitly serialize async work; any other async flow that shares mutable state
should follow this pattern.

### D16. ASR frame validation — stream liveness only after successful parse
The watchdog reconnect (D10) uses `lastAsrFrameAt` to detect whether the stream is
alive or stalled. Initially, this was set whenever a binary frame *arrived*. Problem:
malformed frames (truncated headers, JSON parse failures, relay glitches) could be
received and counted as "proof the stream is alive" even though no transcript was
generated — delaying reconnection while the user heard silence. Fix: `lastAsrFrameAt`
is now set only after a frame **successfully parses** (`JSON.parse` succeeds and
`processAsrResult` is called). Error frames from the ASR itself (MSG_ERROR_RESPONSE)
are also counted as liveness proof (they indicate the service is responding) but any
malformed binary, truncated header, or decode failure is silently caught and ignored.
Consequence: a bad frame no longer defeats the watchdog. The try-catch around
`handleAsrFrame` ensures malformed frames never throw unhandled exceptions.

## 4. Known limitations / sharp edges (as of 2026-07-10)
- The screen-share picker for system audio cannot be skipped (Chrome security);
  the no-picker path is a loopback *input* device (VB-Cable / Stereo Mix) chosen in
  the system-audio dropdown, whose permission persists.
- Obsidian hand-off has no receipt (see D5) — full re-send is the recovery path.
- zh questions ending without `？` (…吗 punctuated with `。` by the ASR) are missed
  by regex detection; acceptable so far, LLM-side catch is a backlog option.
- `meetingContext` grows unboundedly during very long meetings (backlog R3).
- One meeting at a time; no history browser (autosave holds only the latest session).
- Evals cover core.js logic + a few DOM-wiring greps; audio/ASR paths need a live
  BytePlus key and are manually tested only.

## 5. How to keep improving
Run the loop: pick the top of [BACKLOG.md](BACKLOG.md) → implement → verify
(`node evals/run.mjs` + browser check; add zh/en/mixed fixtures for any text-logic
change) → one commit per item (`<id>: summary`) → move the item to Done with notes.
Details in [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md), which also has the
"better than Granola" scorecard — re-score it whenever P0/P1 empties.
