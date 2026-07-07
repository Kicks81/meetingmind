# Backlog — prioritized work queue

Ordered by (user impact × risk of data loss × Chinese-language correctness).
The loop always takes the top unchecked item. Add new findings to the right tier;
never silently delete an item — strike it through with a reason.

## P0 — Chinese/English correctness (core requirement, currently broken for zh)
- [ ] **Z4. LLM prompts don't pin output language.** Summaries/answers/titles should
  respond in the meeting's dominant language (or mirror mixed zh-en). Add explicit
  instruction + detect dominant script of the batch.

## P1 — Data safety & reliability
- [ ] **R1. A page refresh/crash loses the entire meeting.** All state lives in the DOM.
  Autosave transcript/summaries/Q&A to localStorage or IndexedDB every few seconds;
  offer restore on load.
- [ ] **R2. No ASR reconnect.** If the relay/BytePlus socket drops mid-meeting, recording
  silently dies (onclose only console.warns, meeting.html:986). Auto-reconnect with
  backoff and a visible "reconnecting" status.
- [ ] **R3. Unbounded meetingContext.** Rolling context grows forever and is resent on
  every summary/Q&A call — long meetings blow up cost/latency. Cap with a rolling
  condensation (summarize-the-summaries past ~3k chars).

## P2 — Granola-parity features (the "better than Granola" gap)
- [ ] **G1. Post-meeting synthesis.** On Stop, generate a structured final note:
  TL;DR, decisions, action items (owner + due), open questions, key topics. This is
  Granola's core value and is currently missing entirely.
- [ ] **G2. User notes pane.** Let the user jot rough notes during the meeting; merge
  them with the transcript in the final synthesis (Granola's signature interaction).
- [ ] **G3. Meeting templates.** Selectable note templates (1:1, standup, client call,
  interview) that shape the final synthesis.
- [ ] **G4. Speaker attribution.** Investigate BytePlus utterance speaker fields /
  channel separation (mic vs system stream = "me" vs "them") for cheap 2-way diarization.

## P3 — Engineering health
- [ ] **L1. Replace deprecated ScriptProcessorNode with AudioWorklet.**
- [ ] **L2. Key hygiene.** Warn that Save Config writes keys in plaintext; consider
  encrypting the config export with a passphrase.
- [ ] **L3. Fix stray `btn` element selector** (`btn, .btn` in CSS, meeting.html:69).

## Done
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
