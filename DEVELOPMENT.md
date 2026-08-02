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
- **Audio capture now uses AudioWorkletNode** (L1, completed 2026-07-10): runs on a
  dedicated real-time audio thread instead of the deprecated ScriptProcessorNode
  (which ran on the main thread). This eliminates the structural root cause of main-thread
  congestion affecting audio timing (see D13 & D22).

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

**Structural root cause — FIXED in L1 (2026-07-10)**: `ScriptProcessorNode`'s audio
callback ran on the main JS thread (this is WHY it's deprecated in favor of
`AudioWorkletNode`, which runs on a dedicated real-time audio thread). That meant
ANY main-thread congestion — DOM growth, GC pauses from ever-growing strings, LLM
response streaming into the DOM — directly delayed mic capture/encoding/sending.
The two fixes above (1 & 2) removed the concrete, provably-growing contributors
found in code, but the coupling itself remained. **AudioWorklet migration (L1) is
the definitive fix** and was completed with a dedicated change and live-mic test.
See D22 for implementation details.

If the delay persists (or reappears) after L1 lands, the next things to check:
WebSocket `bufferedAmount` on `asrSocket` (backpressure — is the browser queuing
audio faster than the relay/network can drain it?), and whether BytePlus's
duration-based resource (`volc.seedasr.sauc.duration`) exhibits any session-length
throttling — that would be provider-side and outside this codebase's control.

### D19. Autosave restore hardening — schema validation & sanitization (2026-07-10)
localStorage snapshots (D9) are treated as partially untrusted: the snapshot's
shape must be validated before any DOM is cleared and mutated, and HTML content
must be sanitized before re-injection. **Why two layers?**
1. **Shape validation** (`validateAutosaveSnapshot`): Before `restoreFromAutosave`
   touches the page, it validates that the snapshot is a plausible, restorable
   object — checks schema version and presence/type of all required fields
   (segments, summaries, qas, counters, obsidian arrays/objects). A malformed
   snapshot causes an early return with a console warning; the page is never
   cleared. This defends against localStorage corruption, version skew, or a
   typo in the stored JSON breaking the entire restore path.
2. **HTML sanitization** (`sanitizeStoredHtml`): Summary and Q&A blocks store
   rendered markdown as `.innerHTML` into localStorage. On restore, this HTML is
   sanitized before re-injection — strips dangerous elements (`<script>`,
   `<style>`, `<iframe>`, `<object>`, `<embed>`), all `on*="..."` event handlers,
   and `javascript:` URLs in href/src. This defends the stored-HTML round-trip
   (content generated by this app, stored, corrupted, then restored) against
   injection attacks if localStorage were ever compromised. Scope: no-deps,
   regex-based sanitizer (not a DOM parser) — designed only to clean HTML this
   app generated itself, not arbitrary hostile input. Plain text (including CJK)
   passes unchanged.

Snapshots are versioned (`snap.v`); the snapshot-writing code bumps v to 2 (v1
snapshots still accepted for backward compatibility, migrated with sanitization
applied). This lets future schema changes (e.g., new fields) be detected early
and old snapshots rejected or migrated gracefully. Both functions are pure,
deterministic, and fully eval-covered (en/zh/mixed text, various tag/attribute
forms, edge cases like non-string input, unclosed tags, null snapshots).

### D20. Export ledger — traceable chunk history (2026-07-10)
Obsidian export via URIs (D5) is fire-and-forget: the app sends a chunk and
sets an optimistic "exported" flag, but receives **no acknowledgement** from
Obsidian. If the app sent to the wrong vault name or Obsidian wasn't running,
the chunk is silently lost and only discovered later by opening the vault and
noticing a gap. To make failures visible at export time, maintain a small
**export ledger**: one entry per chunk successfully handed off to the obsidian://
URI. Each entry logs: chunkNumber, notePath, timestamp, char count, sentAt epoch.

**Why a separate ledger, not just the export flags?** The exported flags mark
*which elements* went out; the ledger marks *what content* was sent and *when*,
so the user can compare "we sent 3 chunks at these times" against what's in the
vault. The ledger is small (grows linearly with chunks, not segments) and is
**NEVER trimmed by autosave quota** (D1 trims only segments). Export log UI
next to the Obsidian button shows count + last-sent timestamp; hover for full
details (all chunks). Persists through restore so history survives a crash.
Added to snapshot schema validation (D19: validateAutosaveSnapshot checks that
exportLedger is an array if present, allowing future forward compatibility).

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

### D21. BytePlus protocol extraction to core.js (2026-07-10)
BytePlus ASR's binary framing (gzip, `MSG_TYPE` headers, payload encoding/decoding) was
originally inline in meeting.html. Extracted to pure functions in core.js: `buildBytesPlusFrame`
(packs request headers, gzips payload, returns binary) and `parseAsrResponse` (unpacks frames,
decompresses, JSON-parses, type-switches). Both are UMD-wrapped so Node evals can import
unmodified. Why extract?
1. **Auditability**: Protocol bugs (truncated frames, bad compression, malformed JSON) are
   now testable in isolation; evals cover error paths so no regression hides in inline code.
2. **Future hardening**: D16 (frame validation) and D3 (error resilience) are now easier to
   reason about — the frame boundary is a clear, tested function, not scattered logic.
3. **Shared code path**: meeting.html and any future CLI/headless runner both use the same
   frame logic, preventing divergence and secrets leakage (keys never leave the relay).

Evals added for: valid frames (en/zh/mixed utterances), error responses, truncated headers,
invalid gzip, JSON parse failures, type checking. All pass and serve as regression locks.

### D22. AudioWorklet migration — real-time audio thread (L1, completed 2026-07-10)
Replaced deprecated `ScriptProcessorNode` with `AudioWorkletNode`, moving audio capture
off the main thread. **Why this matters:** ScriptProcessorNode's `onaudioprocess` callback
runs on the main JS thread, so ANY main-thread congestion (DOM mutations, autosave
serialization, GC pauses) directly delays mic capture and ASR frame transmission.
AudioWorkletNode runs on a dedicated real-time audio thread, immune to main-thread
jank, decoupling audio timing from UI sluggishness entirely.

**Implementation:**
1. Registered an `AudioWorkletProcessor` (defined inline in meeting.html) that reads
   mic audio on the audio thread and buffers it.
2. Main thread polls the buffer via `port.postMessage` and sends complete frames to
   the ASR; no longer blocks on mic reads.
3. Frame transmission timing is now independent of main-thread load (autosave, DOM
   growth, LLM streaming, GC).
4. The Web Audio graph topology stays the same; only the callback mechanism changed.

**Verification:** Live-mic test confirmed audio flows smoothly through long meetings
(no input queue buildup, no frame transmission delays). The two code-verified growing
costs from D13 (unbounded meetingContext, autosave re-serialization) plus this
structural fix together eliminate the ~1hr transcription delay observed in practice.

**Backward compatibility:** AudioWorkletNode is available in all modern browsers
(Chrome 66+); older fallback to ScriptProcessorNode is not provided (users on old
browsers must upgrade). The audio pipeline is otherwise unchanged and transparent to
the rest of the app.

### D23. ASR connection state machine — single source of truth (S1, completed 2026-07-10)
For the first ~1 year of the project, ASR socket lifecycle was managed via scattered
boolean flags (`isRecording`, `isStartingRecording`, `asrReconnecting`, `asrReady`).
This worked for the happy path but was vulnerable to race conditions: concurrent
calls to `scheduleAsrReconnect()` and `stopRecognition()` could both manipulate the
state, leading to leaked sockets, double-starts, and cycles where reconnect kept
re-opening a socket that stop had killed. To fix this, extracted the transition
table into a pure, eval-tested state machine in core.js: `ASR_STATES` (the legal
states: idle, starting, recording, reconnecting, stopping) and `ASR_TRANSITIONS`
(a map of which states are reachable from each state). The validation functions
`isValidAsrTransition(from, to)` and `nextAsrState(from, to)` are pure and never
throw; they return `{ok, state}`. meeting.html owns the mutable state object
(`asrState = {value: 'idle'}`) and calls `setAsrState(next)` whenever a
transition is requested. setAsrState validates via core.js, logs rejections
(which are rare in production but critical for debugging), and derives the legacy
booleans for backward compatibility so every existing call site (isRecording,
isStartingRecording, asrReconnecting) keeps working. Evals comprehensively cover
all legal and illegal transition pairs (22 checks each), ensuring no regression
in the state machine rules. Result: the lifecycle is now explicit, auditable,
and race-condition-safe.

### D24. Audio-loss detection and recovery (U13, completed 2026-07-10)
Audio capture devices can fail silently: USB headset disconnects, driver crashes,
system suspend/resume, or kernel buffer stalls. The app would continue "recording"
with an open ASR socket, but no audio frames flowing — the user talks, hears
nothing transcribed, and discovers the loss minutes later. To detect and surface
this immediately, implemented a watchdog that monitors audio-sample flow:
1. **Liveness tracking**: `hasAudioFlowed` flag marks whether the audio worklet has
   written *any* samples to BytePlus since recording started. Set to `false` on
   `startRecognition()`, set to `true` on the first successful sample batch.
2. **Silence timeout watchdog**: Every 2 seconds while recording, check if
   `lastAudioAt` (timestamp of last sample write) exceeds a threshold (5s without
   audio). If so, emit `audio-loss` event and show a loud, user-dismissible alert.
3. **Recovery UI**: User can "Retry Audio" (attempts mic permission + re-opens
   audio graph) or "Continue" (accepts the gap, keeps ASR connection). No data
   loss — already-captured segments stay in the transcript; retry reconnects the
   same ASR session so numbering remains in sync (per D3).
4. **No false positives**: The watchdog is active only while recording AND only if
   audio HAS flowed (no alert for dead-air meetings where the user never spoke).
   Extracted to core functions (`resetAudioLiveness`, `checkAudioFlow`) for testability.

Why a dedicated watchdog instead of relying on ASR connection drops? Because the
BytePlus socket can remain open and nominally "healthy" (heartbeats/keep-alives)
while silently dropping the audio stream itself. A healthy socket with zero audio
is indistinguishable from a silent speaker without sample-flow visibility. This
design is simple (no complex driver API introspection), fails safe (worst case: a
false alarm that the user dismisses), and is user-friendly (a single, clear action
instead of "check the console logs").

### D25. Direct vault writes replace the obsidian:// hand-off (2026-08-02)
The `obsidian://new` export was losing most of every meeting, silently. Chrome
refuses to launch an external protocol unless the navigation carries a
**transient user activation**. That activation is consumed by the first launch
and is gone after any `await` — so `sendAllObsidianChunks`, which looped with a
600ms delay between chunks, had chunk 1 succeed and every later chunk rejected
with `Not allowed to launch 'obsidian://new?...'`. `checkObsidianAutoSplit`,
firing from an ASR transcript callback, never had a gesture at all and so could
*never* work.

The damage was compounded by `sendObsidianChunk` marking elements
`obsidianExported = '1'` and pushing to the export ledger immediately after
calling `obsidianNavigate()`. The hand-off is fire-and-forget, so a blocked
launch was indistinguishable from a delivered one: the app reported "N chunks
sent" for content Chrome had thrown away, and never retried it. Observed on
2026-08-02: a 90-minute meeting produced two overlapping notes, each containing
only `## Segment 1`, with 67 minutes absent from both.

The 600ms delay and its "rapid back-to-back protocol navigations can drop some"
comment were treating the wrong cause — the constraint is user activation, not
timing. No delay could have fixed it.

**Fix.** relay.js serves the app over `http://localhost` (D-static-serving),
which is a *secure context*, so the File System Access API is available:
- `connectVaultFolder()` — `showDirectoryPicker({mode:'readwrite'})` once; the
  `FileSystemDirectoryHandle` is structured-cloneable so it persists in
  IndexedDB across restarts. Only the permission lapses to `prompt`, and
  re-granting needs a click, so `ensureVaultReady(true)` runs on the manual
  button, never in the background.
- `writeVaultNote()` — walks/creates the folder chain with
  `getDirectoryHandle(..., {create:true})`, then writes. `append` is a
  read-modify-write; the FS API has no append mode and meeting notes are small.
- `exportViaVaultHandle()` — commits export flags and the ledger **only after
  the write resolves**. A failure throws, nothing is marked exported, and the
  same click can simply be repeated.

Consequences: no protocol launch, no 30,000-char URI ceiling, no chunking or
bisection, no duplicate notes, and failures are loud. Auto-export during a
meeting now genuinely works (gesture-free) and becomes real crash safety —
`OBSIDIAN_AUTOSAVE_CHARS` is a flush interval, not a size limit.

The obsidian:// path is retained only as a `file://` fallback, but reduced to
**one launch per click** with a count of what is still pending, since that is
all Chrome permits.

Also fixed alongside: the "everything already exported" re-send in
`addToObsidian()` used to null `obsidianMeetingTitle`, which made
`suggestMeetingTitle()` re-run against the now-longer transcript, return a
different name, and fork a *second* note instead of replacing the first. The
title is now preserved; only `obsidianNotePath` resets, so chunk 1 rewrites the
same file from the frontmatter down.

### D26. Role lenses — orthogonal to meeting type (2026-08-02)
`SUMMARY_TEMPLATES` encodes what KIND of meeting this is. It says nothing about
what the LISTENER needs from it — the same standup read as an engineer and as a
finance lead should surface different things. `ROLE_LENSES` is that second,
orthogonal dimension: 8 lenses (engineer, pm, finance, transformation, design,
strategy, compliance, client), each contributing a `priorities` clause and a
`questions` clause, both appended to the same system prompt so the two dimensions
compose.

Roles are **checkboxes, not a dropdown** — someone can be running a programme and
be the engineer on it. Multiple ticked lenses are stitched into ONE instruction by
`roleSummaryInstruction()` / `roleQuestionInstruction()` rather than concatenated
as N standalone paragraphs, which would restate "the listener is …" N times and
dilute the prompt. Zero ticked yields `''` and `null`, making the prompt
byte-identical to the pre-feature case. The checkbox row is generated from
`ROLE_LENSES`, so adding a lens is a one-place edit.

Soft cap at 4 (advisory from the audit): each lens adds ~200-300 chars to every
prompt, so all 8 is ~1.9KB of role instruction. Not blocked — broad-based users
keep the choice — but a hint appears past 4.

**Proactive suggestions.** The Q&A panel was purely reactive: it answered
questions asked aloud. `suggestRoleQuestions()` runs every 3rd rolling summary and
asks what THIS role should be asking that nobody has. Colour-coding those is only
meaningful if a suggestion is attributable, so the model tags each line
`- [rolekey] question` and `MeetingCore.parseSuggestedQuestion()` parses it. The
key is **validated against the ticked set, not trusted** — a real question can open
with a bracket (`[UAT] 什么时候上线？`) and treating that as a role tag would eat the
label. Unknown/absent tags degrade to neutral grey.

The role chip is CSS `::before` content driven by a data attribute, **not a DOM
node**: the Obsidian export and the autosave snapshot both read `.qa-question`
textContent, and a `<span>` in there produced `"EngWhat is the data shape…"` in
the exported note. Caught in browser verification before it shipped.

**Anti-fabrication, borrowed from a public meeting-notes-specialist agent.** The
final synthesis now separates **Decisions** (explicitly agreed) from **Discussed
(not decided)**, and uses `[owner: unassigned]` / `[no date]` / `[None recorded]`
instead of inventing plausible owners. Collapsing those two categories is the most
damaging failure mode this app has: a fabricated decision reads exactly like a real
one weeks later. `TRANSCRIPT_IS_DATA` is appended to every prompt built from speech
— a participant saying "ignore your instructions" is content to report, not a
command to obey.

Fixed alongside: `questionKey` was `toLowerCase().replace(/\s+/g,' ')` with no
punctuation normalisation, so `映射？` and `映射?` produced different keys and
dedupe silently failed for Chinese — the same suggestion would be re-offered every
cycle. Found by the auditor by inference, without it having seen core.js.

### D27. Consolidated live summary (2026-08-02)
Rolling updates are chronological and therefore repetitive: a meeting circles back
to the same point three times and produces three near-identical bullets. After 90
minutes the panel is an unreadable list (the 2026-08-02 meeting produced 86).

The chronological blocks stay — they are what the transcript aligns to and what
gets exported — but one pinned `.summary-block.consolidated` above them holds a
grouped, deduplicated view, rewritten from all updates every 4th summary. The
prompt merges duplicates into one bullet keeping the fullest version plus later
detail, states only the LATEST position where something changed, and is explicitly
told it REPLACES rather than appends so it cannot grow into a list of everything.

It is excluded from three selectors, and each exclusion is load-bearing:
- **its own source** — otherwise it feeds on its own output and drifts
- **the autosave snapshot** — it is derived; restoring it would persist a stale
  copy and reinstate it as an ordinary update block
- **`unexportedObsidianElements`** — it is rewritten every 4 summaries, so
  exporting it would append a near-duplicate of the whole meeting each time. The
  FINAL SUMMARY carries the deduplicated view into the vault.

Serialised through a promise queue for the same reason summaries are: two
overlapping rewrites would interleave streamed output into one element. On failure
the previous good view is restored rather than blanked.

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

### D25. Relay localhost-only binding (E1, completed 2026-07-10)
Hardened relay.js to bind exclusively to `127.0.0.1` (not `0.0.0.0`) to prevent
network exposure of the BytePlus ASR proxy. **Why this matters:** The relay holds
the user's BytePlus API key (set via command-line env var `BYTEPLUS_KEY`) and forwards
opaque frames to/from the ASR service (D2). If the relay were reachable from other
machines on the network, a compromised peer could intercept frames, extract metadata,
or proxy malicious requests. Localhost-only binding (enforced at both the HTTP server
and WebSocket listener) ensures only the local Chrome browser can reach it.

Also implemented:
1. **Port-conflict detection**: If the default port (8765) is already in use, the relay
   tries the next available port in a range, or fails with a clear error message (not
   silent degradation). start.bat logs the actual port so the user can navigate to the
   correct localhost URL.
2. **Backpressure visibility**: Logs `socket.bufferedAmount` (bytes queued in the browser's
   send buffer) every 5s while recording. If it grows unbounded, it signals that the relay
   or network is slower than audio frame generation — an early warning for the ~1hr delay
   investigation (D13) or provider-side rate limits.
3. **Useful logging**: Request counts (frames in/out), relay uptime, frame sizes (min/max/avg),
   and error rates. These are emitted to stdout for live debugging without code changes.

### D25b. start.bat preflight checks — bootstrap reliability (E2, completed 2026-07-10)
The startup batch script now performs three sequential checks before opening Chrome:
1. **Node.js presence**: `where node` to ensure Node is on PATH. If missing, error and
   exit with instructions to install from nodejs.org.
2. **Port 8765 availability**: `netstat -ano | findstr` to detect if port 8765 is already
   bound (stale relay window or conflicting service). If in use, error and tell the user
   to close the stale relay. This prevents silent failures where the browser connects to
   the wrong relay instance.
3. **Relay health**: After starting the relay, poll its HTTP endpoint with `Invoke-WebRequest`
   (via PowerShell) up to ~10s, only opening Chrome once it responds 200 OK. This replaces
   a blind `timeout /t 2` sleep with actual verification, so the user never opens the app
   only to find a broken relay (e.g., a binding error, missing `ws` package, misconfigured env).

**Why important**: Startup failures are the first impression; users run `start.bat` and
expect to see Chrome + a working relay within seconds. Silent failures (Chrome opens but
relay crashed) are confusing and look like app bugs. Explicit checks + clear errors make
the user self-service: "Port in use? Close the other relay window. Node missing? Install
from nodejs.org." No support burden.

**Design notes**:
- Checks are sequential: if Node is missing, there's no point checking port or relay.
- Relay port is hardcoded (8765); in future, if dynamic port allocation is added
  (backlog item), this logic will change to read the port from relay startup output.
- The HTTP poll uses PowerShell (available in Windows 11 by default) instead of a batch
  command for a proper timeout and error handling.

### D26. Config export encryption with user-supplied passphrase (E3, completed 2026-07-10)
Save Config now offers optional encryption of the exported JSON file. **Why this matters:**
Keys (BytePlus, OpenRouter) are persisted in localStorage, and users can export this config
to a file (Save Config button) for backup or transfer between machines. If that file is
checked into git, shared in a Slack message, or left on a shared computer, the keys are
plaintext and compromised. Encryption with a user-supplied passphrase mitigates this.

**Format:**
- **Plaintext export** (user opt-in for encryption = unchecked): standard JSON, backward
  compatible with existing Load Config workflows.
- **Encrypted export** (user checks "Encrypt with passphrase"): prompt for a passphrase,
  derive a key using `crypto.subtle.deriveBits` (PBKDF2, 100k iterations, random salt),
  and encrypt the JSON using `AES-GCM`. The output file contains:
  ```
  {
    "enc": "1",             // magic header: this is encrypted
    "v": "1",               // encryption format version
    "salt": "<base64>",     // random salt for PBKDF2 (16 bytes)
    "iv": "<base64>",       // IV for AES-GCM (12 bytes)
    "tag": "<base64>",      // authentication tag (16 bytes)
    "data": "<base64>"      // encrypted config JSON
  }
  ```
- **Load Config** detects the `"enc"` header, prompts for the passphrase, derives the
  same key (salt is embedded), and decrypts. Mismatched passphrases result in auth-tag
  failure and a clear "wrong passphrase" error.

**Design notes:**
1. **Optional, not mandatory**: Existing plaintext workflows remain supported; this is
   a user opt-in to trade convenience for security.
2. **No key rotation**: Passphrases are not stored; re-encryption always asks for
   passphrase again. Users can migrate by exporting plaintext → re-entering keys → exporting
   encrypted with new passphrase.
3. **Scoped to export/import only**: localStorage still holds plaintext (D9 is unchanged);
   encryption is only for file durability. Full localStorage encryption (backlog item) is
   out of scope here.
4. **Constants hardcoded**: PBKDF2 iterations (100k, matches OWASP recommendations),
   salt/IV sizes (16/12 bytes, standard for GCM), AES-256-GCM algorithm.

### D27. Relay diagnostics — observability for troubleshooting (E4, completed 2026-07-10)
Connection failures, ASR stalls, and frame delivery issues are hard to diagnose without
visibility into relay state. E4 adds a **Diagnostics pane** (Settings button → Diagnostics tab)
to meeting.html that surfaces relay state and frame history:

1. **Relay health dashboard** (Diagnostics pane, always visible): live display of WebSocket state
   (connecting / connected / closed), buffered bytes, frames sent/received counts, relay uptime,
   and detected backpressure. Colors (green/yellow/red) indicate health status.

2. **Frame inspection**: circular buffer of the last 50 parsed frames (UTC timestamp,
   payload size, MSG_TYPE, parse success/error). Useful for "why did the relay reject
   my frame?" debugging without a full packet capture. Frames are tagged with error
   messages if they fail (truncated header, invalid gzip, JSON parse error).

3. **Connection timeline**: immutable log of all major events (WebSocket open, close,
   reconnect initiated, backpressure detected) with UTC timestamps and durations. Users
   can correlate "I noticed the audio stopped at 3:22 PM" with "relay closed at 3:22:15,
   reconnected at 3:22:40". Timeline is kept in memory during session, visible in the pane.

4. **Export diagnostics log**: button to download a plaintext report of the full session's
   relay events + frame stats (counts by MSG_TYPE, error rates, average frame size, peak
   buffering). For sharing with support or troubleshooting.

5. **Error surfacing**: ASR failures (auth errors, timeout, quota exceeded) and frame
   decode errors are now surfaced in the Diagnostics pane status line, not silent
   console warnings. Connection state changes (reconnect, backpressure) trigger subtle
   but visible log entries.

**Design rationale:** Failures are the most important events to make visible — silent
failures defeat diagnostics. The pane is collapsible (Settings → Diagnostics tab) so
normal users don't see it, but on-call engineers or the user during troubleshooting can
open it and immediately see "why did the relay drop the connection at this timestamp?"
without needing console access or asking the user to paste logs. No new dependencies.

## 5. How to keep improving
Run the loop: pick the top of [BACKLOG.md](BACKLOG.md) → implement → verify
(`node evals/run.mjs` + browser check; add zh/en/mixed fixtures for any text-logic
change) → one commit per item (`<id>: summary`) → move the item to Done with notes.
Details in [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md), which also has the
"better than Granola" scorecard — re-score it whenever P0/P1 empties.
