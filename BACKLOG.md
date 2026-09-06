# Backlog — prioritized work queue

Ordered by (user impact × risk of data loss × Chinese-language correctness).
The loop always takes the top unchecked item. Add new findings to the right tier;
never silently delete an item — strike it through with a reason.

## P0 — Chinese/English correctness (core requirement; release-blocking)
*(Empty. Cleared by Z4 — do not read the emptiness as "zh is done"; it means no
known zh defect is open. Every text-logic change still needs zh/en/mixed fixtures.)*

## P1 — Data safety & reliability
- [x] **A5. Same title + same day silently overwrites the earlier meeting.** The note
  path was `{folder}/{YYYY-MM}/{date} - {title}` with no collision check — two
  meetings on one day whose LLM-suggested titles collide resolved to the same path,
  and because `isFirstChunk` is true for the second one too, it wrote with
  `append: false`, destroying the first meeting's note via `writeVaultNote`'s
  unconditional `createWritable()` truncation. Fixed with `nextAvailableNotePath()`:
  probes the vault (via the existing `vaultDirHandle`, `NotFoundError`-only-means-new
  pattern already used by `writeVaultNote`) and appends ` (2)`, ` (3)`, ... until it
  finds a path nothing already occupies. Only meaningful in direct-vault-write mode —
  the `obsidian://`-URI and download fallbacks have no filesystem read access to probe
  against, so those paths are unchanged. Found while fixing V2; pre-existing and
  unrelated to that change.
- [x] **`.qa-answer` exports as run-on text.** Identical defect to the one V3 fixed for
  summaries: the export read `.qa-answer.textContent`, but the element holds
  `formatSummaryHtml` output, so bullets and bold were stripped and no newlines survived
  between blocks. Fixed the same way — `answerQuestion()` now stashes the raw markdown
  on `answerEl.__md` at generation time, the export reads it through the existing
  `summaryMarkdown()` helper, and `snapQA`/its restore path carry an additive optional
  `m` field (mirrors `snapSummary`'s `m`) so a reloaded meeting still exports its Q&A
  answers with headings/bullets intact — `snap.v` was NOT bumped.
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
- [x] **G2. User notes pane.** Added a `#userNotes` textarea (same split-pane pattern as
  `.qa-split`, below the live transcript) for the user to jot rough notes during the
  meeting; `generateFinalSynthesis()` now merges them into the final note wherever they
  fit (a note like "follow up with Sarah" becomes an Action Item) rather than dumping
  them as a separate disconnected list — the actual Granola-signature interaction, not
  just a scratchpad. Same lifecycle as A1's attendees field: excluded from
  `PERSISTED_FIELDS` (a fresh meeting starts blank, no carryover), included in the
  autosave snapshot for crash recovery within the same meeting (additive `userNotes`
  field, `snap.v` unchanged), wiped by `clearAll()`.
- [x] **G3b. Templates should also shape the final synthesis** once G1 exists (the
  live-summary template part shipped as U5). Stale — already true: `git log -S` on
  `generateFinalSynthesis`'s `const template = SUMMARY_TEMPLATES[...]` line traces it
  back to G1's own original commit (`2e2854c`), and it's injected into the prompt at
  the same site fixed for A2/A3. Templates have shaped the final synthesis since G1
  shipped; this line was never re-verified against the code before now.
- [x] **G4. Speaker attribution.** BytePlus's streaming ASR (the exact endpoint this app uses) has
  no speaker/channel field at all, and mic+system are summed into one mono stream before BytePlus
  ever sees them, so channel separation was never possible either — see D39 for how this was
  actually confirmed (BytePlus's own docs, not just a web search summary). Implemented instead via
  `microsoft/mai-transcribe-2` on OpenRouter as an **opt-in, post-meeting** step (it's a 60-min
  batch model, not a live API): retain raw PCM during the meeting, encode as WAV
  (`MeetingCore.buildWavFile`, byte-verified in evals) at Stop, send for diarization, match
  returned speaker-labeled segments back onto the transcript by timestamp, reusing the existing
  `.seg-speaker` badge UI. Two things flagged as needing live confirmation (not yet possible without
  a real OpenRouter account + real meeting): whether typical meetings fit the documented 60s
  upstream timeout in one request, and whether Azure's diarization actually discriminates well on
  this app's specific mixed-mono capture (vs. a clean multi-speaker recording).
- [x] **G5. Word-document export for users without an Obsidian vault connected.**
  User request. `downloadEntireMeetingAsMarkdown()` already covered the no-vault
  fallback, but a `.md` file is a dead end for anyone who doesn't already use
  Obsidian/a markdown editor. Added `MeetingCore.markdownToRtf()` (core.js, with
  zh/en/mixed round-trip eval fixtures — RTF is 7-bit ASCII, so every CJK/
  full-width/typographic character MUST go through a `\uN` escape or Word shows
  garbage instead) and `downloadEntireMeetingAsWordDoc()`, reusing
  `buildObsidianChunkMarkdown(Infinity)`'s output exactly like the existing
  markdown download. Saved with a `.doc` extension — Word/LibreOffice/Google Docs
  all open RTF natively. No new runtime dependency: a true `.docx` needs a zip
  library from a CDN, which breaks fully-offline `file://` use (CLAUDE.md's
  dependency-free constraint). `addToObsidian()`'s no-vault dialog now offers a
  choice between `.doc` and `.md`.

## P2 continued — re-audit findings (2026-09-06, IMPROVEMENT_LOOP.md's "P0+P1 empty" trigger)
Compared against Granola's current feature set and checked BytePlus/OpenRouter for new
capabilities since the last audit. Acknowledged and deliberately NOT queuing: Granola's
Notion/Slack/HubSpot/Affinity/Attio/Zapier integrations (out of scope — this app's whole
design center is a single user's own Obsidian vault, not a multi-integration SaaS) and
OpenRouter's 2026 Workspaces/Analytics/video/image APIs (team/org and non-audio features,
not relevant here).

- [ ] **G6. BytePlus's own batch "ASR - Audio File" endpoint may be a better fit for
  diarization than G4's OpenRouter route — or a genuinely different, more reliable
  mechanism entirely.** Distinct from the streaming endpoint D39 investigated (which has
  no diarization), BytePlus's separate async submit/poll batch endpoint
  (`/api/v3/auc/bigmodel/submit`, resource `volc.seedasr.auc`) has real
  `enable_speaker_info` (statistical diarization, ≤10 speakers, same caveat as Azure's
  about acoustic variation) AND `enable_channel_split` (true stereo left/right channel
  identity in the response). The latter is the more interesting option: if mic and
  system audio were captured as separate stereo channels instead of being pre-mixed to
  mono before ever reaching an ASR provider (a capture-pipeline change, not just an API
  swap), channel identity would give a *deterministic* "me vs them" split rather than a
  statistical guess — arguably a better answer to G4's ORIGINAL framing ("channel
  separation... for cheap 2-way diarization") than what G4 actually shipped. Also
  sidesteps D39's open question about OpenRouter's 60s-per-request timeout: this
  endpoint accepts up to 5 hours / 512MB directly. Worth investigating as a G4
  replacement or complement — not urgent, G4 already ships something that works.
- [ ] **G7. Calendar integration / auto-detect upcoming meetings.** Granola's core
  differentiator: syncs the user's calendar, reminds ~1 minute before any call with 2+
  attendees, no manual click needed to start capturing. Large scope (OAuth against
  Google/Outlook calendar APIs, a background polling mechanism) for a single-file,
  no-build-step, no-backend app — flagging as aspirational/large rather than queuing it
  at normal priority. The user already accepts the manual Start Meeting click as this
  tool's tradeoff for staying dependency-free and local-first.
- [ ] **G8. More meeting templates.** Granola ships 29+ (sales calls, investor pitches,
  customer research, etc.); MeetingMind's `SUMMARY_TEMPLATES` has 7 (general, 1:1,
  standup, client, interview, brainstorm, training). Cheap, well-scoped expansion —
  same mechanism (D-entry references U5's original template design), just more entries.
- [ ] **G9. Group/organize exported notes by company or project, not just by date.**
  Granola auto-groups meetings by company; MeetingMind's vault path is
  `{folder}/{YYYY-MM}/{date} - {title}` only. Could add an optional "Company/Project"
  free-text field (same deterministic, never-sent-to-LLM pattern as A1's Attendees) that
  reshapes the folder path when filled in, e.g. `{folder}/{Company}/{YYYY-MM}/{date} -
  {title}`. Moderate scope, low risk given the A1 precedent to follow directly.

## P2b — Meeting Notes Specialist standard (audit 2026-08-18)
Audited the exported note against an external "Meeting Notes Specialist" standard
(a 4-section record: Date & Attendees / Decisions / Action Items / Open Questions,
all four always present, nothing invented). The app already meets or exceeds most of
it — CONTRACT.md independently arrived at the same rules, and the Decisions vs
**Discussed (not decided)** split goes beyond the standard. These are the real gaps.

- [x] **A1. Attendees are absent entirely.** Added a manual free-text `#attendees`
  input in the header toolbar, written **deterministically** into the note header
  (`Attendees: ...`, right after the date/time line — `[None recorded]` when empty) —
  never sent to the LLM, so a model can't invent attendance from a roster or use it to
  *assign* an owner. Deliberately **NOT** in `PERSISTED_FIELDS` (that set is also the
  config-export set for `saveConfig`, and since `SECRET_FIELDS` is keys-only, attendee
  names would otherwise land unencrypted in `meetingmind-config.json`) and reset to `''`
  on every `clearAll()`, so a roster from a past meeting can never carry over and be
  reported as attendance that didn't happen. It IS included in the autosave snapshot
  (additive `attendees` field, does not bump `snap.v`) purely for crash recovery within
  the *same* meeting — a page reload mid-meeting restores it, a genuinely new meeting
  starts blank.
- [x] **A2. "All four sections always present" is self-contradictory in one prompt.**
  The final-synthesis system prompt said an empty section still gets `- [None recorded]`,
  but `actionsInstruction` said *"omit the **Action Items** section entirely"*. Now
  matches the same rule as every other section: always include the heading, with a
  single `- [None recorded]` bullet when nothing was curated. Also fixed the curated-list
  branch running straight into `TRANSCRIPT_IS_DATA` with no separating newline (the last
  action item was reading as part of the instructions) — added a trailing `\n` after the
  bullet list; the other `TRANSCRIPT_IS_DATA` call sites are untouched since they
  continue an ordinary prose sentence, not a list.
- [x] **A3. Action items do not reliably carry an owner.** The prompt asked for
  `what — owner — due`, but the curated list was injected as free text with *"rephrase
  minimally"* and nothing telling the model that instruction still had to end in the
  owner/due structure — so it often didn't. `actionsInstruction`'s curated-list branch
  now explicitly says to still shape each curated item into what/owner/due, adding the
  placeholders when the curated text doesn't already state one. Fixed in the
  **final-synthesis prompt only** — `detectActionItems`' own output format is untouched
  (`actionKey`/`dismissedActions` keys derive from the whole action string; changing that
  format would resurface every dismissed false positive across a restore, breaking D17).
  Also pinned `[owner: unassigned]`/`[no date]` to stay in English exactly as written
  regardless of the output-language selection, so `outputLanguageInstruction` can't turn
  them into `[负责人：未分配]` on a zh meeting and break CONTRACT.md's exact-string greps.
- [x] **A4. The 4-section record is buried at the bottom of the note.** Export was
  chronological `## Segment N` blocks with the final synthesis just another block
  inside the *last* one. Fixed with a post-export, opt-in-by-nature restructure step
  (`restructureExportedNote()` in meeting.html, `MeetingCore.restructureFinalSummaryToTop`
  for the actual byte manipulation — the most dangerous code in the app, so it's pure
  and eval-tested rather than trusted on faith): reads the just-exported file back,
  confirms the final-synthesis text occurs **exactly once** (aborts on 0 — nothing to
  move — or 2+ — ambiguous, don't guess), moves it to a new `## Final Summary` section
  right after the header, and asserts (a second, independent check, not just "trust the
  construction") that every other byte survives unchanged before writing anything back.
  Any failure at any step — including the tripwire declining — leaves the
  already-exported file exactly as it was; this only ever runs *after* a successful
  export, never blocking or risking it. Impossible on the `obsidian://` path (no read
  access to the file at all), so it silently no-ops without `vaultDirHandle`.
- [x] **Diarization labels (G4) didn't reach the exported note.** `applyDiarizationLabels()`
  stamped `.transcript-segment` badges in the live DOM, but diarization runs *after* the
  Stop-path export already wrote the transcript to disk, so the note never got the
  "(Speaker A)" annotations. Fixed with a per-line splice, not a full-section rebuild —
  `applyDiarizationLabels()` now returns which elements actually changed (with each
  one's PRIOR speaker, since it may already carry a label from the unrelated 2-way
  speaker-split feature); `spliceDiarizationIntoExportedNote()` reconstructs each
  changed, already-exported segment's exact old/new line and hands them to
  `MeetingCore.spliceLinesIntoText()` (pure, eval-tested), which verifies each
  replacement occurs **exactly once** before applying it — independently per line
  (unlike A4's all-or-nothing move), so one ambiguous/unmatched line is skipped on its
  own rather than losing the others that matched cleanly.
- [x] **A6. The note header (including A1's Attendees line) is written once, on
  chunk 1**, so a late-joining attendee never reaches it — updating the attendees
  field mid-meeting only affects a future meeting, not the one already in progress.
  Documented as a sharp edge (DEVELOPMENT.md) rather than fixed, per the same A4
  reasoning: rewriting the header after chunk 1 needs a full-note overwrite, the
  riskiest code path in the app.

## P3 — Engineering health
- [x] **L3. Fix stray `btn` element selector.** `btn, .btn` in CSS (meeting.html:69) —
  `btn` matched a nonexistent `<btn>` element (confirmed zero uses in the file); now
  just `.btn`.
- [x] **Stale docs.** CLAUDE.md said `evals/run.mjs` doesn't exist yet ("backlog item
  L0") and still described export as plain `obsidian://new` append chunks. Now
  documents the real precedence: direct vault writes via the File System Access API
  (D25/D28/E5) as primary, `obsidian://` kept as the `file://`-mode fallback. Both
  CLAUDE.md and CONTRACT.md's eval counts updated 218/258 → 289.
- [x] ~~`origin/main` is ~1 month behind HEAD~~ — already stale by the time this was
  read; the ENGINEERING_REVIEW.md remediation run (D34-D38, A5, qa-answer export fix)
  pushed everything current.
- [x] **Removed the `TEMPORARY DIAGNOSTIC` system-audio peak logger** in meeting.html —
  it was scoped to a specific past investigation (D22's Bluetooth-loopback question),
  not ongoing value; not promoted to the diagnostics drawer.

## Done
- [x] D34 — SSE streaming decoder boundary bugs: fix UTF-8 multi-byte corruption and silent line-dropping at chunk boundaries in `streamIntoElement`; extract `parseSseChunks` pure function to `core.js`
- [x] D38 — Audio send-ordering (`sendQueue`/`queueSendAudioChunk`), reconnect-gap PCM ring buffer with gap marker, and a shared concurrency-capped queue (`backgroundExtractionQueue`) for `detectActionItems`/`maybeSplitSpeakers` with a persistent failure-streak badge
- [x] **V3. Export carries markdown again, not run-on text.** `buildObsidianChunkMarkdown`
  read `.summary-text.textContent`, but that element holds `formatSummaryHtml` output —
  `- ` markers stripped, `**bold**` turned into `<mark>`, and `textContent` adds no
  newlines across block elements. Every summary arrived in the vault as one line. Verified
  in the browser before the fix; the zh case was `预算已批准下一步是UAT签核`.
  `consolidatedSource()` read the same way, so the consolidation prompt had been eating
  run-on text since D30. Both now use `summaryMarkdown()`. (commit `V3:`)
- [x] **V2. Obsidian export is one action again.** The multi-click export was never a bug
  in the export loop — `exportViaVaultHandle()` always wrote the entire backlog in one
  write; it is just unreachable without a connected vault folder, and the code degraded to
  `obsidian://` (one launch per gesture) silently. Added a connect banner on the Start
  click (not a confirm at export time — `showDirectoryPicker()` needs live user activation
  that the stop-path export no longer has), amber status when unconnected, and
  `queueVaultWrite` to serialise vault writes. That last one fixed a latent race where two
  un-awaited `checkObsidianAutoSplit()` calls both wrote with `append: false` and forked
  the note — D28's failure mode from a new cause. (commit `V2:`)
- [x] **V1. Summary column split into updates + consolidated panes.** The consolidated view
  was `position: sticky` inside `#summaryPanel` and floated over the rolling updates
  instead of having its own space. Now a second pane in a `.panel-split`, reusing the
  `.qa-split` pattern from D17. `clearAll()` and the autosave restore both needed an
  explicit `resetConsolidatedPanel()` — the block used to be wiped for free by resetting
  `#summaryPanel.innerHTML`, and without the reset a previous meeting's consolidated
  summary would sit beside a new one. (commit `V1:`)
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
  en, else mixed); the matching instruction is appended to the title prompt via
  `languageInstruction()` (unchanged). Note BODY output language (summary, synthesis,
  action items, Q&A, suggested questions) is now the user-selectable `outputLanguageSelect`
  setting (default English) per D36, not automatic speech-matching — some users want
  Chinese notes and others want English regardless of the meeting's spoken language.
  P0 is now empty — Chinese/English correctness backlog cleared. (commit `Z4:`)
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
