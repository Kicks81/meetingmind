# Backlog — prioritized work queue

Ordered by (user impact × risk of data loss × Chinese-language correctness).
The loop always takes the top unchecked item. Add new findings to the right tier;
never silently delete an item — strike it through with a reason.

## P0 — Chinese/English correctness (core requirement, currently broken for zh)

## P1 — Data safety & reliability
- [x] **E9. Suggested questions no longer export as if they were asked.** Role-lens
  suggestions are `.qa-card`s, so the Obsidian export wrote them as `**Q:**` —
  indistinguishable from questions actually asked, i.e. fabricated meeting content.
  Now exported under an explicit "not asked in the meeting" label. Found by GLM 5.2
  after three Nemotron passes said PASS. Also: CJK list markers in
  `parseSuggestedQuestion`, and a blank pinned consolidated block on slow streams.
  Evals 232 → 238. See D32.
- [x] **E8. Model selection integrity.** `modelSelect` was never persisted, so the
  model silently reverted to the first option every reload. Two dropdown ids
  (`claude-haiku-4-5`, `gemini-flash-1.5`) did not exist on OpenRouter and would have
  failed on selection. All 10 ids verified against the live API; default is now the
  pinned `deepseek/deepseek-v4-flash-0731`. See D31.
- [x] **E7. Consolidated live summary.** Rolling updates repeat as the meeting circles
  back (86 near-identical blocks in the 2026-08-02 meeting). One pinned, grouped,
  deduplicated block above the chronological list, rewritten every 4th summary;
  excluded from its own source, the snapshot, and the Obsidian export. See D30.
- [x] **E6. Role lenses + proactive questions + anti-fabrication.** 8 role lenses
  (checkboxes, colour-coded, composable) orthogonal to the meeting-type template;
  proactive "what should I be asking" suggestions tagged by role; Decisions vs
  Discussed split with [owner: unassigned]/[None recorded] markers; TRANSCRIPT_IS_DATA
  injection guard on every speech-derived prompt. Fixed questionKey losing zh dedupe
  on full-width punctuation. Audited 3 passes (Nemotron 3 Ultra): PASS/PASS/PASS.
  Evals 218 → 232. See D29.
- [x] **E5. Obsidian export writes directly to the vault folder (supersedes U3/U2).**
  Root cause of chronic export loss found: Chrome blocks `obsidian://` launches without
  a *transient user activation*, which is consumed by the first launch and gone after
  any `await`. So the chunk loop had #1 succeed and the rest rejected with "Not allowed
  to launch", and auto-export from the ASR callback (no gesture, ever) could never work
  at all — while `sendObsidianChunk` marked all of it exported regardless. A 90-min
  meeting on 2026-08-02 produced two overlapping notes, each holding only Segment 1,
  with 67 minutes lost. U3's 600ms delay was treating timing, not the real constraint.
  Now: File System Access API (the app is served over http://localhost = secure
  context), directory handle persisted in IndexedDB, one direct write with no size
  limit and no chunking; export flags commit only after the write resolves, so failures
  are loud and retryable. obsidian:// kept as a file:// fallback, one launch per click.
  Also fixed the re-send nulling `obsidianMeetingTitle`, which renamed the meeting and
  forked a second note instead of replacing the first. See DEVELOPMENT.md D28.
## P2 — Granola-parity features (the "better than Granola" gap)
- [ ] **G2. User notes pane.** Let the user jot rough notes during the meeting; merge
  them with the transcript in the final synthesis (Granola's signature interaction).
- [ ] **G3b. Templates should also shape the final synthesis** once G1 exists (the
  live-summary template part shipped as U5).
- [ ] **G4. Speaker attribution.** Investigate BytePlus utterance speaker fields /
  channel separation (mic vs system stream = "me" vs "them") for cheap 2-way diarization.

## P3 — Engineering health
- [ ] **L3. Fix stray `btn` element selector** (`btn, .btn` in CSS, meeting.html:69).

## Done
- [x] **S1. Explicit ASR connection state machine.** Consolidated the previously
  scattered `isRecording`, `isStartingRecording`, and `asrReconnecting` booleans
  into a single state object with validated transitions. The transition table
  (`ASR_STATES` and `ASR_TRANSITIONS`) and validation logic (`isValidAsrTransition`,
  `nextAsrState`) live in core.js as pure, eval-tested functions; meeting.html owns
  the mutable state and calls `setAsrState(next)` which validates transitions and
  derives the legacy booleans for backward compatibility. This eliminates race
  conditions (e.g., stop-vs-reconnect transitions that could leak sockets in D10)
  by enforcing a strict state machine: only legal transitions are accepted, illegal
  ones are rejected with a log and no state change. Evals cover all legal and
  illegal transition pairs (22 checks: all reachable paths in idle→starting→recording→
  {stopping,reconnecting}→... and rejection of skipped/self-loop states). Verified:
  transition validation in isolation, correct derivation of legacy booleans,
  integration with autosave/restore (state not persisted, rebuilt on load), and
  no manual testing needed (pure). (commit `S1:`)
- [x] **L1. Replace deprecated ScriptProcessorNode with AudioWorklet.** Migrated
  audio capture from the deprecated ScriptProcessorNode (main-thread callback) to
  AudioWorkletNode (dedicated real-time audio thread). This eliminates the direct
  coupling between main-thread congestion (DOM growth, autosave serialization, GC
  pauses) and audio-capture timing. Audio samples now flow on a dedicated thread,
  immune to UI jank, and the structural root cause of the ~1hr transcription delay
  (identified in U10 / D13) is resolved. Verified with live-mic test; audio pipeline
  remains stable through long meetings. See DEVELOPMENT.md D22 for implementation
  notes. (commit `L1:`)
- [x] **F1. Extract BytePlus binary frame build/parse into core.js with eval fixtures.**
  Moved BytePlus `gzip` binary frame protocol logic (header packing, `MSG_TYPE` flags, payload
  compression, UTF-8 JSON decode) from inline meeting.html into pure, testable functions in
  core.js (`buildBytesPlusFrame`, `parseAsrResponse`), keeping the UMD wrapper so both browser
  and Node evals can import unmodified. Created comprehensive eval fixtures (en/zh/mixed
  utterances, error frames, truncated headers, malformed JSON) that catch any regression in
  framing or message parsing. Validated against live BytePlus output. This extraction unblocks
  future protocol debugging and makes the ASR implementation auditable from a single source.
  (commit `F1:`)
- [x] **D3. Obsidian export ledger — chunks are traceable and recoverable.**
  Each export chunk is logged with: chunkNumber, notePath, timestamp, char count, and sentAt.
  The ledger is small (one entry per chunk sent) and **never trimmed by autosave quota**
  (D1 trims only transcript segments, not export metadata). Export log UI next to the Obsidian
  button shows count + last chunk timestamp; hover for full chunk details. Persists through
  restore, making it obvious when Obsidian silently dropped a chunk (wrong vault name, app
  not running, network glitch) instead of export being fire-and-forget with no visibility.
  Validation: exportLedger array schema check in validateAutosaveSnapshot. (commit `D3:`)
- [x] **D2. Restore hardening — schema validation and HTML sanitization on autosave restore.**
  Snapshots are validated before any DOM is cleared (validates schema version, presence/type of
  all required fields via `validateAutosaveSnapshot`). Summary/Q&A HTML is sanitized before
  re-injection (strips dangerous elements like `<script>`, `<iframe>`, `<object>`, `<embed>`,
  all `on*=` event handlers, and `javascript:` URLs via `sanitizeStoredHtml`) — this defends
  against corruption or tampering of the stored-HTML round-trip (content generated by this app,
  saved to localStorage, then restored). Scope: no-deps regex-based sanitizer, not a general
  HTML parser. Plain text (including CJK) passes unchanged. Snapshot schema versioned to v2;
  v1 snapshots still accepted (migrated, get sanitized same as v2) for backward compatibility.
  Evals: validateAutosaveSnapshot (valid v1/v2, unknown versions, missing fields, non-object
  input), sanitizeStoredHtml (plain en/zh/mixed text, script/style/iframe/object/embed blocks,
  self-closing tags, on* handlers with various quote styles, javascript: URLs, non-string input).
  (commit `D2:`)
- [x] **D1. Autosave quota safety — long meetings must stay crash-safe.**
  localStorage has a ~5MB quota; long meetings' autosave snapshots can exceed it,
  causing silent write failures and data loss. Implemented two-layer trimming:
  `trimSegmentsToByteBudget()` (pure, eval-covered) trims oldest transcript
  segments from an array until byte size fits; `trimSnapshotToByteBudget()`
  applies this to the entire snapshot, rebuilding `finalTranscript` from the
  kept segments (the duplicate was defeating per-segment trims). meeting.html
  catches `QuotaExceededError`, applies the whole-snapshot trim, and shows a
  user-visible warning ("Autosave is trimming old transcript…") with a 15s
  timeout + close button. Restored sessions show a marker ("— N segment(s)
  trimmed by autosave") in the transcript panel; summaries/Q&A/actions are
  never trimmed, only the raw transcript. Byte budget is 4MB (leaving 1MB
  headroom under the quota for corrections + browser overhead). Tested:
  `lengthInUtf8Bytes` with ASCII/CJK, `trimSegmentsToByteBudget` with empty/en/zh/mixed/oversized,
  `trimSnapshotToByteBudget` end-to-end ensuring finalTranscript sync. (commit `D1:`)
- [x] **B1. Obsidian export uses UTC date — meetings before 08:00 SGT get yesterday's date.**
  Fixed the date calculation logic to use SGT (UTC+8) instead of UTC when naming Obsidian
  notes, so meetings that end before 08:00 UTC (which is still today in SGT) now correctly
  export to today's note instead of yesterday's. (commit `B1:`)
- [x] **C1. Harden ASR frame handling to prevent malformed frames from killing transcription.**
  Wrapped `handleAsrFrame()` in try-catch so malformed binary frames (truncated headers,
  invalid compression, JSON parse failures) no longer throw unhandled exceptions that
  could crash the audio pipeline. Moved `lastAsrFrameAt` to only mark the stream alive
  after a frame actually parses successfully, not on error or before validation. Added
  pre-ready message validation (catch malformed control frames). Fire-and-forget call
  to `handleAsrFrame` now has `.catch()` guard. Robustness: a single bad frame from
  the relay or network glitch no longer kills transcription. (commit `C1:`)
- [x] **C4. Serialize summary generation to prevent out-of-order context corruption.**
  Multiple async triggers (word-count threshold, silence timer, stop-recording button)
  could call `generateSummary()` concurrently, allowing their streaming outputs and
  `meetingContext`/`pendingText` mutations to interleave and corrupt state. Introduced
  `summaryQueue` (a Promise chain) so at most one summary streams at a time and batches
  are processed in order. Public API `generateSummary(newText)` queues onto the chain;
  internal `runGenerateSummary()` does the work and never throws (catches failures and
  re-queues pendingText), keeping the chain alive. (commit `C4:`)
- [x] **C3. Fix ASR socket lifecycle and reconnect races.** Eliminated leaked sockets,
  fixed stop-vs-reconnect race condition (e.g., calling stop during backoff could
  kill a socket that reconnect was building), fixed double-start when isRecording
  toggled twice rapidly, and fixed clearAll race where pending reconnects could
  arrive after reset. All socket lifecycle transitions now guard against concurrent
  state changes; guard clauses in place before every socket I/O. (commit `C3:`)
- [x] **C2. LLM pipeline failure paths: never lose transcript text, never stick the spinner.**
  Enhanced error handling across all LLM call sites (rolling summary, final synthesis,
  Q&A answers): API errors / mid-stream network drops / thrown failures are now caught,
  never lose the input text (failed batches re-queued to pendingText, failed Q&A
  becomes no-op), never leave the spinner stuck (try-finally clears processing state),
  and errors are shown to the user via flashStatusError (visible in status bar, not
  just console). New `.qa-answer.failed` CSS styling for visually distinct failed
  answers. Wrapped fire-and-forget LLM calls with `.catch()` so failures are logged.
  (commit `C2:`)
- [x] **U10. Live-summary editing + investigation of the ~1hr transcription delay.**
  Added ✎ edit (contenteditable) / ✕ delete controls to every summary block
  (rolling updates + final synthesis), mirroring the transcript's existing controls.
  **Investigation**: traced the growing delay to two compounding, code-verified
  causes, NOT a single instant bug — see DEVELOPMENT.md D13 for the full writeup:
  (1) `meetingContext` (R3) grew unbounded and was resent in FULL on every single
  summary/Q&A call — fixed, now capped at 6000 chars (oldest content dropped; it's
  already preserved on-screen/in Obsidian, this only bounds the rolling PROMPT).
  (2) autosave() re-read/re-serialized (.innerHTML/.textContent) EVERY element from
  the ENTIRE meeting EVERY 5 seconds regardless of whether it changed — fixed via
  a per-element snapshot cache, invalidated only at the handful of real mutation
  points (create/edit/export-flag-toggle/correction-retro-apply). Both are real,
  now-fixed contributors to main-thread load that grew with meeting length.
  **Root architectural cause identified but NOT fixed here** (see promoted L1):
  ScriptProcessorNode's audio callback runs on the main JS thread, so remaining
  main-thread congestion still couples into audio-capture timing. Needs
  AudioWorklet migration (L1) as the definitive fix — flagged, not attempted in
  this change per the project's own guidance on audio-pipeline changes.
  (commit `U10:`)
- [x] **U9. Split mixed-speaker utterances into separate paragraphs.** BytePlus's
  streaming ASR has no confirmed speaker-diarization field, so this is a text-based
  (not voice-based) turn-splitter: for utterances ≥12 words, the LLM checks for a
  conversational turn boundary and — only if found — splits into Speaker A / Speaker
  B labeled segments (blue/pink badges), keeping the original timestamp on both.
  Guarded by a length-reconstruction check so a model that summarised instead of
  splitting is rejected outright, not guessed at. Fire-and-forget — never blocks live
  ingestion; safe if the segment is deleted/exported before the LLM responds.
  core.parseSpeakerSplit is pure + eval-covered (en/zh/malformed/length-mismatch).
  Wired through autosave/restore and Obsidian export (speaker shown in the note).
  (commit `U9:`)
- [x] **R1. Crash-safe autosave.** Full session (transcript, summaries, Q&A, context,
  export state) snapshots to localStorage every 5s + on unload; restore offered on
  load; Clear wipes it. Verified across a real reload. (commit `R1:`)
- [x] **R2. ASR auto-reconnect.** Mid-meeting socket drops now retry with backoff
  (1s→15s) while recording, with "Reconnecting ASR…" status; each new BytePlus
  session resets utterance numbering. Needs one live-meeting kill-the-relay test.
  (commit `R2:`)
- [x] **G1. Post-meeting synthesis.** On Stop: one structured FINAL SUMMARY block
  (TL;DR / Decisions / Action Items with owners / Open Questions), shaped by the
  selected template + meeting language, 1200-token budget, purple-accented in the
  summary panel, included in the Obsidian export. (commit `G1:`)
- [x] **U6. Small-talk removal.** Hover any transcript segment → ✕ deletes it.
  🧹 button in the transcript header batch-classifies un-exported segments via the
  LLM (conservative: only pure greetings/filler/goodbyes), previews what it found,
  and deletes on confirm. Deleted segments are excluded from Obsidian export;
  already-exported segments are never touched. (commit `U6:`)
- [x] **U5. Manual Q&A + Granola-style summary templates.** Ask-the-AI input at the
  bottom of the Q&A panel (Enter to send; uses meeting context + vault RAG, same
  pipeline as auto-detected questions). Summary template selector in the Live
  Summary header (general / 1:1 / standup / client / interview / brainstorm /
  training) shapes the rolling-summary prompt; choice persists. (commit `U5:`)
- [x] **U3. Oversized exports no longer silently download.** An export bigger than
  one obsidian:// URI now bisects into multiple URI-sized appends (600ms apart, same
  note) instead of falling back to a .md download that nobody notices. Export state
  commits only after a chunk is actually handed off. Recovered all previously
  downloaded chunk files (07-02 → 07-07) from Downloads into the vault. Also: 204
  for /favicon.ico. (commit `U3:`)
- [x] **U2. Re-send meeting to Obsidian.** Chunks are flagged "exported" when the
  obsidian:// URI launches, but the hand-off is fire-and-forget — a wrong vault name
  at export time silently loses the note while the app thinks it's sent. "Add to
  Obsidian" now offers a full re-send (fresh note, all chunks) when everything is
  already marked exported. (commit `U2:`)
- [x] **U1. One-time (not per-meeting) mic permission.** Root cause: Chrome never
  persists mic permission for file:// pages. relay.js now also serves meeting.html
  + core.js at http://localhost:8765 (static serving only — ASR relaying unchanged),
  and start.bat opens that URL. Click "Allow while visiting the site" once and the
  prompt never returns. Screen-share picker is a Chrome security requirement and
  cannot be skipped — the existing system-audio *device* dropdown (e.g. VB-Cable)
  is the no-picker path, and its permission now persists too. (commit `U1:`)
- [x] **Z4. Output language pinned to the speech.** dominantLanguage() classifies each
  batch/question/title source as zh / en / mixed by CJK-vs-Latin share (≥70% zh, ≤30%
  en, else mixed); the matching instruction is appended to summary, Q&A, and title
  prompts. P0 is now empty — Chinese/English correctness backlog cleared. (commit `Z4:`)
- [x] **Z3. Chinese vault search.** Query tokenizer now emits CJK character bigrams
  (function-char bigrams like 的/是/谁 filtered) alongside Latin words; Latin terms
  score 2×. Chinese questions now retrieve zh vault notes; mixed queries rank the
  exact Latin term first. All Z1/Z2/Z3 known-bug fixtures are now promoted — 0 remain.
  (commit `Z3:`)
- [x] **Z2.7. Correction dictionary for recurring mis-transcriptions.** Select wrong
  text in the transcript → ✏️ Fix → type the right term. Stored in localStorage,
  applied to all future ASR text (before summaries/Q&A/export see it), retro-applies
  to on-screen segments, and correction targets are auto-fed to BytePlus as hotwords
  so the ASR starts hearing them right. 📖 button manages/deletes entries.
  CJK-aware (substring match for zh, word-boundary for Latin). (commit `Z2.7:`)
- [x] **Z2.5. Click-to-select Obsidian folder.** 📁 button (and the existing Load
  Vault picker) fill a datalist so the notes-folder input autocompletes from the
  vault's real folders; core.extractVaultFolders is eval-covered incl. zh names.
  OS folder-pick dialog itself needs one manual click-through to fully confirm.
  (commit `Z2.5:`)
- [x] **Z2. CJK-aware word counting.** countWords now counts CJK chars ÷2 plus Latin
  word tokens (punctuation excluded) — live-summary triggers now fire in zh meetings.
  Also added DeepSeek V4 Flash/Pro (zh-native) to the model dropdown; "DSpark" is
  DeepSeek's inference-speedup framework, not a selectable model. (commit `Z2:`)
- [x] **Z1. Chinese question detection.** extractQuestions now matches `？` as well as
  `?`, treats `。！？` as sentence boundaries, and uses a lower min-length floor for
  CJK questions. Note: zh questions ending without `？` (吗/呢 forms that ASR
  punctuates with 。) still rely on ASR punctuation — if this proves lossy in real
  meetings, add an LLM-side catch (new item, not blocking). (commit `Z1:`)
- [x] **L0. Extract pure text logic + eval harness.** core.js (UMD, shared by
  meeting.html and Node) + evals/run.mjs: 22 passing checks, 6 known-bug fixtures
  documenting Z1/Z2/Z3 that flip to failures when the bug is fixed. (commit: see git log, `L0:`)
- [x] **U11. Action-item detection in Q&A panel.** Split Q&A into two independently-
  scrolling halves: top half for Q&A, bottom half for "Action Required". Per-utterance LLM
  call extracts commitments and action items, displayed as dismissible cards. User-deleted
  actions are permanently removed (moved to `dismissedActions`) so they never re-surface
  from similar speech. Core.parseActionList/actionKey (pure, eval-covered) parse/dedupe
  actions. Final synthesis uses the curated list verbatim, never re-derives, so false
  positives deleted by the user don't reappear in the exported note. (commit `U11:`)
- [x] **U12. Transcript panel header buttons truncated/clipped at normal window widths.**
  Fixed CSS layout so the transcript panel header (record/stop, mic/speaker toggles, 🧹 cleanup,
  search, export buttons, and controls) no longer overflow or clip at standard window sizes.
  Adjusted flexbox wrapping and spacing to keep all controls visible and accessible.
  (commit `U12:`)
- [x] **U13. Silent-death protection: detect ended audio tracks and surface recovery UI.**
  Audio capture devices can silently die mid-meeting (driver crash, USB disconnect, system
  suspend/resume), leaving the app recording but with no mic data reaching the ASR. Added
  watchdog that monitors for silence (no audio samples written to BytePlus within a timeout
  window) and surfaces a loud, dismissible recovery UI when detected, not a quiet console
  warning. User can retry (attempts mic permission and re-opens the audio graph) or accept
  the gap and continue with existing ASR connection. Extracted `hasAudioFlowed` state tracking
  and `notifyAudioLoss` alert mechanism to core.js. Verified: manual test with headphone cable
  disconnect during recording. (commit `U13:`)
- [x] **E1. Relay hardening — localhost-only, port-conflict handling, backpressure visibility, useful logs.**
  Hardened relay.js to bind only to localhost (127.0.0.1) for security (prevents network-accessible
  relay from leaking BytePlus keys or proxying to other machines), implemented port-conflict detection
  with automatic fallback or user-visible error, added backpressure monitoring (`socket.bufferedAmount`)
  to detect when browser audio frames are queueing faster than the relay can drain them (early warning
  for network/ASR slowness), and improved logging with request/response counts, relay uptime, and frame
  sizes. See DEVELOPMENT.md D25 for architectural rationale. (commit `E1:`)
- [x] **E2. start.bat preflight — node present, port free, relay actually up.**
  Before opening Chrome, preflight checks verify (1) Node.js is installed on PATH,
  (2) port 8765 is available (not in use by another relay or app), and (3) the relay
  successfully binds and responds on http://localhost:8765/. Batch script polls the
  relay's HTTP endpoint (up to ~10s) instead of a blind sleep, so Chrome only launches
  once the relay is actually accepting requests. If any check fails, reports a clear
  error and pauses; if port 8765 is in use, tells the user to close the stale relay
  window. This prevents the user from opening the app only to find a broken relay,
  and makes port conflicts explicit and recoverable. (commit `E2:`)
- [x] **L2. Key hygiene — config export encryption with user-supplied passphrase.**
  Save Config now optionally encrypts the exported JSON with a user-supplied passphrase using
  `crypto.subtle.encrypt` (AES-GCM), producing a self-contained encrypted artifact with embedded
  IV/salt. Load Config detects encryption via magic header and prompts for the passphrase to decrypt.
  This mitigates risk if the .json export file is checked into git or forwarded insecurely. Encryption is
  optional (user can choose plaintext); plaintext configs remain unencrypted for backward compatibility.
  See DEVELOPMENT.md D26 for format details. This was the E3 enhancement request; moving L2 here
  as complete. (commit `E3:`)
- [x] **E4. In-app diagnostics panel — make failures visible instead of silent.**
  Added a Diagnostics pane (Settings button → Diagnostics tab) that displays live relay health,
  WebSocket connection state (connecting/connected/closed), buffered bytes, frames sent/received
  counts, relay uptime, and backpressure detection. Frame inspection shows the last N parsed frames
  (UTC timestamp, payload size, MSG_TYPE, success/error status) for troubleshooting "why did a frame
  fail?" questions. Connection timeline logs events (open, close, reconnect, backpressure spike) with
  timestamps so users can correlate audio gaps to relay disconnections. Optional diagnostics export
  (text report of full session events + frame stats) for support/debugging. ASR failures, frame decode
  errors, and connection state changes are surfaced in the UI instead of silent console warnings. Pure
  JS — no new dependencies. See DEVELOPMENT.md D27 for design rationale. (commit `E4:`)
