# Backlog — prioritized work queue

Ordered by (user impact × risk of data loss × Chinese-language correctness).
The loop always takes the top unchecked item. Add new findings to the right tier;
never silently delete an item — strike it through with a reason.

## P0 — Chinese/English correctness (core requirement, currently broken for zh)

## P1 — Data safety & reliability
## P2 — Granola-parity features (the "better than Granola" gap)
- [ ] **G2. User notes pane.** Let the user jot rough notes during the meeting; merge
  them with the transcript in the final synthesis (Granola's signature interaction).
- [ ] **G3b. Templates should also shape the final synthesis** once G1 exists (the
  live-summary template part shipped as U5).
- [ ] **G4. Speaker attribution.** Investigate BytePlus utterance speaker fields /
  channel separation (mic vs system stream = "me" vs "them") for cheap 2-way diarization.

## P3 — Engineering health
- [ ] **L1. Replace deprecated ScriptProcessorNode with AudioWorklet.** PROMOTED to
  P1-priority by the U10 investigation below — this is the structural root cause of
  the growing transcription delay, not just a cleanliness item. ScriptProcessorNode's
  audio callback runs on the MAIN thread, so any main-thread congestion (DOM growth,
  autosave, GC pauses) directly delays mic capture/encoding — and that congestion
  provably grows with meeting length. AudioWorkletNode runs on a dedicated
  realtime-audio thread, immune to main-thread jank, and is the definitive fix.
  Needs a dedicated change + live-mic test (audio pipeline surgery, per
  DEVELOPMENT.md D11) — do this next.
- [ ] **L2. Key hygiene.** Warn that Save Config writes keys in plaintext; consider
  encrypting the config export with a passphrase.
- [ ] **L3. Fix stray `btn` element selector** (`btn, .btn` in CSS, meeting.html:69).

## Done
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
