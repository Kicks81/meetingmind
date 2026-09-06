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
forget calls (detectActionItems, maybeSplitSpeakers, generateSummary) have `.catch(err =>
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
3. Only raw audio *sample capture* (reading mic samples into a buffer) moved off the
   main thread. Chunk transmission (gzip via `CompressionStream` + `ws.send()` in
   `sendAudioChunk`) still runs on the main thread once the worklet hands off a
   completed chunk — this is not a full elimination of main-thread coupling, but
   capture stalls under main-thread load are real and meaningfully reduced.
4. The Web Audio graph topology stays the same; only the callback mechanism changed.

**Verification:** Live-mic test confirmed audio flows smoothly through long meetings
(no input queue buildup, no frame transmission delays). The two code-verified growing
costs from D13 (unbounded meetingContext, autosave re-serialization) plus this
structural fix together eliminate the ~1hr transcription delay observed in practice.

**Backward compatibility:** `createCaptureNode()` DOES provide a ScriptProcessorNode
fallback for browsers where `audioContext.audioWorklet` is unavailable or `addModule`
fails; `currentDiagState()` reports `captureMode` as `"worklet"` or `"fallback
(ScriptProcessorNode)"`. The audio pipeline is otherwise unchanged and transparent to
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

### D25. Relay localhost-only binding (E1, completed 2026-07-10)
Hardened relay.js to bind exclusively to `127.0.0.1` (not `0.0.0.0`) to prevent
network exposure of the BytePlus ASR proxy. **Why this matters:** The relay holds
the user's BytePlus API key, sent by the browser in the first WebSocket message as JSON
(`{ apiKey, mode: ASR_MODE, resourceId: ASR_RESOURCE_ID }`) and forwarded per connection;
the relay never reads the key from an environment variable, nor persists its own copy.
It forwards opaque frames to/from the ASR service (D2). If the relay were reachable from other
machines on the network, a compromised peer could intercept frames, extract metadata,
or proxy malicious requests. Localhost-only binding (enforced at both the HTTP server
and WebSocket listener) ensures only the local Chrome browser can reach it.

Also implemented:
1. **Port-conflict detection**: If the default port (8765) is already in use, the relay
   exits immediately with an error naming the conflicting port and instructing the user
   to pass a different port manually (`node relay.js --port <n>`); it does not auto-select
   an alternate port. (An earlier version accepted a bare positional port argument —
   e.g. `node relay.js 8766` — but that silently absorbed any stray extra word on the
   command line as a port number, landing the user on an unexpected origin with an
   empty localStorage. It now requires the explicit `--port` flag; meeting.html also
   surfaces the current `window.location.origin` in the UI so a wrong port is visible
   immediately.) start.bat logs the actual port so the user can navigate to the
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
  derive a key using `crypto.subtle.deriveBits` (PBKDF2, 200k iterations, random salt),
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
4. **Constants hardcoded**: PBKDF2 iterations (200k, matches OWASP recommendations),
   salt/IV sizes (16/12 bytes, standard for GCM), AES-256-GCM algorithm.

### D27. Relay diagnostics drawer — observability for troubleshooting (E4, completed 2026-07-10)
Connection failures, ASR stalls, and frame delivery issues are hard to diagnose without
visibility into relay state. E4 adds a lightweight, always-visible **diagnostics drawer**
(🔧 button in the header, `id="diagToggle"`, `onclick="toggleDiagnostics()"`) to
meeting.html — there is no Settings gate; it is directly reachable at all times.

`currentDiagState()` shows live scalar counters: ASR state, socket readyState,
bufferedAmount, seconds since last frame, reconnect count, capture mode (worklet vs.
ScriptProcessorNode fallback), mic/system track state, audioCtx state,
summary/question/action call and failure counts, summary queue state, last autosave
result, snapshot bytes/budget, and export ledger chunk count — refreshed every 2s while
the drawer is open or the meeting is recording.

A "Copy diagnostics" button (`copyDiagnostics()`) writes a text dump to the clipboard
only (`navigator.clipboard?.writeText(dump)`); no file download is provided.

**Design rationale:** Failures are the most important events to make visible — silent
failures defeat diagnostics. The drawer is a single button away so on-call engineers or
the user during troubleshooting can open it and immediately see current ASR/audio/LLM/
storage health without needing console access or asking the user to paste logs. No new
dependencies.

### D28. Direct vault writes replace the obsidian:// hand-off (E5, 2026-08-02)
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

### D29. Role lenses — orthogonal to meeting type (E6, 2026-08-02)
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

### D30. Consolidated live summary (E7, 2026-08-02)
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

### D31. Model selection integrity (E8, 2026-08-02)
Two independent faults, both silent.

`modelSelect` was never in `PERSISTED_FIELDS`, so the model reverted to the
first `<option>` on every reload. A meeting could be summarised by a different
model than the one the user believed they had picked, with nothing on screen to
say so. Now persisted like every other field.

Separately, the dropdown carried **ids that do not exist on OpenRouter**:
`anthropic/claude-haiku-4-5` (dash where the id uses a dot) and
`google/gemini-flash-1.5` (a version since retired). Selecting either would have
failed the request. Corrected to `anthropic/claude-haiku-4.5` and
`google/gemini-3.5-flash`; all ten ids verified against
`https://openrouter.ai/api/v1/models` (337 models) on 2026-08-02.

Default is now `deepseek/deepseek-v4-flash-0731`, first in the list. Pinned to a
dated build rather than the floating `deepseek/deepseek-v4-flash` alias, so a
model revision upstream cannot silently change how meetings are summarised.

**Verification note:** `WebFetch` answered this question wrongly — it reported 5
of 7 ids as missing because it saw a truncated view of a 337-model list. Query
the API directly (`Invoke-RestMethod`) for catalogue questions; do not trust a
summarising fetch over a large JSON response.

### D32. Suggested questions must never look like asked questions (E9, 2026-08-02)
`unexportedObsidianElements` selects every `#qaPanel .qa-card`, and role-lens
suggestions are `.qa-card`s. They therefore exported as `**Q:** <question>` —
identical in shape to a question someone actually asked. Read back weeks later
there is no way to tell them apart, which makes the note assert that something
was said when it was not. That is fabricated meeting content and the contract
forbids it outright.

Suggestions now export as
`**Suggested question (not asked in the meeting) — <role> lens:** …`. They are
still exported, because they are the follow-ups worth chasing; they are simply
never disguised as transcript.

This is the clearest case so far of why a *second, independent* auditor is worth
the cost: three passes of Nemotron 3 Ultra returned PASS on this code. GLM 5.2
(added as a `zai` provider in `audit.py`, using `ZAI_API_KEY`/`ZAI_BASE_URL` and
native model ids like `glm-5.2`) found it on its first look — in fact in the
*visible reasoning* of a run that then failed to emit a verdict at all, because
GLM reasons at length and exhausted `max_tokens=8000` before answering. The
provider now requests 32000 and reports truncation by name rather than calling
the output unparseable.

Also fixed in that pass: `parseSuggestedQuestion` stripped only `-`, `*` and `•`,
but a zh-locale model told to emit `- [role] …` frequently answers with `・`,
`·`, `．`, `、` or an ideographic space, and the unstripped marker rode into the
question text. And the pinned consolidated block was inserted empty before its
stream began, so a slow API showed a blank box; it now reads "Consolidating…".

### D33. Summary column split, one-click export, and markdown fidelity (V1/V2/V3, 2026-08-18)

Three user-reported problems, one commit each. They turned out to be connected:
the second and third were both caused by reading rendered HTML back as text.

**V1 — the consolidated view had its own pane instead of floating.** D30 pinned it
with `position: sticky; top: 0` inside `#summaryPanel`, which meant it *covered*
the topmost rolling updates rather than having room of its own. It now lives in
`#consolidatedPanel`, a second `.panel-body` in a `.panel-split` — the same
pattern the Q&A panel has used since D17 (top Q&A / bottom Action Required), so
`.qa-split`'s rules were generalised rather than duplicated.

Two traps in that move, both of which would have shipped silently:

- **`clearAll()` used to wipe the consolidated block for free**, because it reset
  `#summaryPanel.innerHTML` and the block lived inside it. It no longer does. Without
  an explicit reset, a consolidated summary from the previous meeting sits beside a
  new one and reads as belonging to it — fabricated meeting content by staleness.
  `resetConsolidatedPanel()` is now called from both `clearAll()` and the autosave
  restore (the block is derived and deliberately not snapshotted, so restore has
  nothing to put back and must show the empty state instead).
- **The three `:not(.consolidated)` selectors are still load-bearing.** Scoping to
  `#summaryPanel` now excludes the block on its own, so they *look* redundant. They
  are kept as belt-and-braces and grep-guarded: the exclusion in `consolidatedSource()`
  is what stops the consolidation feeding on its own output and drifting, and the one
  in `unexportedObsidianElements()` is what stops a near-duplicate of the whole
  meeting being appended to the note every four summaries (D30).

**V2 — "export takes several clicks" was never a bug in the export loop.**
`exportViaVaultHandle()` has always written the *entire* backlog in one write
(`buildObsidianChunkMarkdown()` with no `maxItems` bisection — there is no URI
length limit on the direct path). But it is only reachable when a vault folder is
connected: `ensureVaultReady()` returns false the instant `vaultDirHandle` is null,
and the code then degraded *silently* to `obsidian://`, where Chrome permits one
protocol navigation per user gesture — hence one section per click. The reported
symptom was a missing on-ramp, not a defective loop.

The fix is a banner offering `connectVaultFolder()`, shown from the **Start Meeting**
click. It is deliberately **not** a `confirm()` at export time, for the D28 reason:
`showDirectoryPicker()` requires transient user activation, the stop-path export runs
after `await generateFinalSynthesis()` when that activation is long gone, and a modal
dialog can outlive the activation window even on a fresh click. A click on the
banner's own button is always a fresh gesture. `#vaultDirStatus` also turned amber
when unconnected — the degraded mode used to be discoverable only *after* an export
made you click five times.

**V2c — vault writes are now serialised, fixing a latent note-corrupting race.**
`checkObsidianAutoSplit()` is called **un-awaited** from the synchronous ASR frame
loop, once per finalized utterance, and a reconnect backlog delivers several definite
utterances in one frame. Each call awaits `ensureVaultReady` / `suggestMeetingTitle` /
`writeVaultNote` before `exportViaVaultHandle` commits `obsidianNotePath`. Two
overlapping calls therefore both saw `obsidianNotePath === null`, both computed
`isFirstChunk = true`, and **both wrote with `append: false` — the second truncating
the first** — while two `suggestMeetingTitle()` calls returned two different titles
and forked the note. That is D28's exact failure mode arriving from a new cause,
masked until now only by the 4000-char autosplit threshold. `queueVaultWrite()`
follows the D15 `summaryQueue` precedent: `then(fn, fn)` so a rejection never breaks
the chain, while the returned promise still rejects for the caller so
`exportGuarded()`'s alert and retry keep working.

**V3 — the export was losing every heading and bullet.** `buildObsidianChunkMarkdown`
read `.summary-text`**`.textContent`**. That element holds `formatSummaryHtml` output,
which strips `- ` markers and turns `**bold**` into `<mark>` — and `textContent`
contributes **no newlines** across block elements (that is `innerText`'s job). So a
whole summary arrived in the vault as one run-on line. Verified in the browser before
the fix; the Chinese case, where there are no spaces either, was:

    预算已批准下一步是UAT签核

`consolidatedSource()` read the same way, which means **the consolidation prompt has
been eating run-on text since D30** — a likely contributor to the drift that prompted
V1. Both now go through `summaryMarkdown(textEl)`, which prefers raw model output
stashed as `textEl.__md` at generation time and falls back to `textContent`.

Two deliberate details:
- The stash is **dropped when a block is hand-edited** (`toggleSummaryEdit`), because
  the user's contenteditable text is then the truth and the stashed markdown is stale.
- `snapSummary` stores it as an additive optional field `m` and **`snap.v` stays 2**.
  Bumping to 3 would make every older copy of this single-file app reject the snapshot
  outright (`KNOWN_SNAPSHOT_VERSIONS` in core.js) — trading a whole meeting for some
  formatting. Absence of `m` degrades to the old `textContent` read, which is exactly
  right.

Still outstanding from this pass: `.qa-answer` has the identical `textContent` defect
(backlog), and the 4-section record is still buried at the bottom of the note rather
than at the top (backlog A4).

### D34 — SSE streaming decoder boundary bugs

**Problem:** `streamIntoElement()` had two independent bugs: (1) `TextDecoder.decode()` was
called without `{stream: true}`, so multi-byte UTF-8 sequences (any CJK character = 3 bytes)
split across two `reader.read()` boundaries produced U+FFFD replacement characters instead of
the original text; (2) `chunk.split('\n')` eagerly processed the last array element even when
it lacked a trailing `\n`, causing `JSON.parse` to silently throw on a truncated fragment that
was then permanently lost. Both bugs affected every streaming LLM call site (rolling summary,
final synthesis, Q&A, consolidated summary, role suggestions).

**Fix:** Added `{stream: true}` to `TextDecoder.decode()`. Extracted the line-splitting decision
into a new pure function `parseSseChunks()` in `core.js` using a residual-buffer pattern: the
last element from each `split('\n')` is held back and prepended to the next chunk, so only
newline-terminated lines are processed. On stream end, the residual is flushed through the same
handling. Three eval fixtures cover: CJK byte-split recovery, incomplete-line buffering, and
normal-case regression.

**Files:** `core.js`, `meeting.html`, `evals/run.mjs`

### D35 (2026-09-06): Auto-Q&A claim retraction — proactive suggestions are the surviving feature
Automatic spoken-question detection-and-answering was tried and removed because it
produced too many irrelevant detections in real meetings. The feature that actually
serves the original intent — proactive, role-relevant question suggestions via
`suggestRoleQuestions()`/`ROLE_LENSES` (D29), exported under an explicit "not asked in
the meeting" label (D32) — already exists and is not changed by this task. This entry
corrects stale claims elsewhere (CLAUDE.md, CONTRACT.md, IMPROVEMENT_LOOP.md, and D14
above) that described automatic in-meeting Q&A as shipped.

### D36 (2026-09-06): Output-language selector supersedes Z4's automatic speech-matching for note BODY content
`meeting.html` now exposes an `outputLanguageSelect` control (English default / Chinese)
persisted as `meetingmind_output_language`, and every prompt-construction call site that
previously appended the unconditional `ENGLISH_ONLY` constant now calls
`MeetingCore.outputLanguageInstruction(...)`. The `dominantLanguage()`/`languageInstruction()`
mechanism remains for note TITLE generation only (`suggestMeetingTitle()`, unchanged); body
language is a user choice because some users want Chinese notes and others want English
regardless of the meeting's spoken language.

### D37 (2026-09-06): Wire the consolidated source into final synthesis, Q&A, and role-question prompts
`generateFinalSynthesis()`, `answerQuestion()`, and `suggestRoleQuestions()` each read
from `meetingContext`, which is capped at `MEETING_CONTEXT_CHAR_CAP` (6000 chars,
tail-kept) right after every append (D13). That cap is correct for the cheap ROLLING
summary prompt in `runGenerateSummary` (unchanged by this task), but these three call
sites ask "what has this whole meeting been about" — a 6000-char tail of a long
meeting is a tiny fraction of it. Each also applied a dead `.slice(-12000)`/`.slice(-6000)`
on top of the already-≤6000-char value, a no-op left over from before the cap existed.

All three now read from a new `currentFullMeetingSource()` helper in `meeting.html`,
which prefers `consolidatedSource()` (D30) — the uncapped, deduplicated view built from
every rolling summary block — falling back to the raw, uncapped `finalTranscript`
accumulator when the consolidated source is empty (early in a short meeting, before
enough rolling summaries exist to populate it; D30 only rewrites the consolidated
block every 4th summary). The "which one wins" decision is pure text logic, so it is
extracted to `core.js` as `pickFullMeetingSource(consolidated, transcript)` with eval
coverage, rather than living only inline in `meeting.html`.

References: D13 (meetingContext cap), D30 (consolidated block mechanics).

### D38 (2026-09-06): Send-ordering, reconnect-gap buffering, and a shared concurrency cap for background LLM calls
Three related audio/LLM-pipeline hardening fixes, done together since each builds on the last:

- **Send ordering.** `sendAudioChunk()` calls `gzip()` (async, variable duration) before
  `asrSocket.send()`. With no serialization, a slower earlier chunk's gzip round-trip could
  finish AFTER a faster later chunk — worst case, the terminal `isLast:true` frame sent at Stop
  overtaking a still-compressing chunk and truncating the last seconds of a meeting. Fixed with
  `sendQueue`, the same `.then(fn, fn)` chain pattern as `summaryQueue` (D15); every
  `sendAudioChunk` call site now goes through `queueSendAudioChunk` instead.
- **Reconnect-gap buffering.** The D10 reconnect loop deliberately keeps the Web Audio capture
  graph running through a socket drop, but nothing caught the audio captured while `asrReady` was
  false — it was silently dropped. Added a bounded (~6s) ring buffer of raw PCM16 (not
  gzip-compressed, so nothing depends on `CompressionStream` timing during the very outage
  causing the problem), flushed oldest-first through `queueSendAudioChunk` once `asrReady` flips
  back to true. If the outage outlasted the buffer (a real, unrecoverable gap), a distinct
  `.transcript-gap-marker` element is inserted — deliberately not `.transcript-segment.final`, so
  export/corrections/DOM-rebuild logic (D33 pattern) never mistakes it for real speech.
- **Shared concurrency cap for background extraction.** `detectActionItems()` and
  `maybeSplitSpeakers()` fire fire-and-forget per utterance with no shared cap, competing with
  each other and with `summaryQueue`'s calls for the same OpenRouter key's rate limit — a burst
  of fast speech (or a post-reconnect backlog draining at once) could spawn many concurrent
  requests. Routed both through `backgroundExtractionQueue`, a concurrency-ALLOWING (not
  strictly-serial) queue capped at 3 in flight — deliberately NOT merged with `summaryQueue`,
  which must stay strictly serialized (D15: concurrent summary streams would interleave DOM
  writes and `meetingContext` mutations). Both functions already swallow their own errors
  internally by design (a missed action item or speaker split shouldn't interrupt live
  ingestion), so neither call ever actually rejects; failure tracking instead watches their
  existing `diagCounters.actionFailures`/`splitFailures` counters (the latter newly added,
  following the established E4 "counts only, hooked into the existing catch path without
  altering behavior" pattern) for a before/after change per call. Three consecutive failures
  shows a persistent (non-auto-dismissing) badge, dismissed by a real success or explicit user
  dismissal — reusing the D-established persistent-banner pattern (`showExportFailureBanner`).

Send-ordering and reconnect-gap buffering are audio-timing fixes no Node eval harness can prove;
`node evals/run.mjs` only confirms the queueing/buffering structure is present, not that the
race/gap is actually fixed live. Manual verification (real or simulated recording, Stop
immediately after speaking; killing and restarting the relay mid-recording) is required before
these are considered fully confirmed working.

References: D10 (reconnect backoff), D13/D22/D23 (capture graph survives reconnect, ASR state
machine), D15 (summaryQueue serialization), D33 (DOM-as-source-of-truth export pattern).

## 4. Known limitations / sharp edges (as of 2026-08-18)
- The screen-share picker for system audio cannot be skipped (Chrome security);
  the no-picker path is a loopback *input* device (VB-Cable / Stereo Mix) chosen in
  the system-audio dropdown, whose permission persists.
- Obsidian hand-off has no receipt (see D5) — full re-send is the recovery path.
- zh questions ending without `？` (…吗 punctuated with `。` by the ASR) are missed
  by regex detection; acceptable so far, LLM-side catch is a backlog option.
- `meetingContext` is capped at `MEETING_CONTEXT_CHAR_CAP` (6000 chars, tail-kept) —
  see D13. That cap still governs the live ROLLING summary prompt in
  `runGenerateSummary`. `generateFinalSynthesis`, `answerQuestion`, and
  `suggestRoleQuestions` no longer read the capped tail for their own "whole
  meeting" context — they read the uncapped consolidated source instead (D37).
- One meeting at a time; no history browser (autosave holds only the latest session).
- The note header (title/date/tags, and A1's `Attendees:` line) is written once, on
  chunk 1, and never revisited — updating the attendees field mid-meeting only takes
  effect for the *next* meeting, not the one already in progress. Same reasoning as
  A4 (backlog): rewriting the header after chunk 1 needs a full-note overwrite, the
  riskiest code path in the app, so this stays documented rather than fixed for now.
- Evals cover core.js logic + a few DOM-wiring greps; audio/ASR paths need a live
  BytePlus key and are manually tested only.

- Granola is not tuned for Chinese: on zh-heavy meetings its transcript degrades
  into Spanish/Korean fragments. Its *note* (structured English summary) stays
  good. For a meeting both tools recorded, combine rather than dedupe — and never
  edit Granola's own note file, its sync overwrites edits (2026-08-02).
- The `obsidian://` fallback (file:// use only) is limited to ONE launch per user
  gesture; Chrome blocks the rest. Direct vault writes (D28) have no such limit.
- Suggested questions are exported under an explicit "not asked" label (D32). Any
  new panel whose cards reuse `.qa-card` must make the same distinction or it will
  silently export as though someone asked it.
- Visual audit mode is verified only on the `nim` provider; `openrouter` and `zai`
  are substance-mode only.

## 5. How to keep improving
Run the loop: pick the top of [BACKLOG.md](BACKLOG.md) → implement → verify
(`node evals/run.mjs` + browser check; add zh/en/mixed fixtures for any text-logic
change) → one commit per item (`<id>: summary`) → move the item to Done with notes.
Details in [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md), which also has the
"better than Granola" scorecard — re-score it whenever P0/P1 empties.
