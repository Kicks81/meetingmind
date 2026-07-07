# Backlog — prioritized work queue

Ordered by (user impact × risk of data loss × Chinese-language correctness).
The loop always takes the top unchecked item. Add new findings to the right tier;
never silently delete an item — strike it through with a reason.

## P0 — Chinese/English correctness (core requirement, currently broken for zh)
- [ ] **Z1. Question detection misses Chinese questions.** `QUESTION_PATTERN = /[^.!?]*\?/g`
  (meeting.html:433) only matches ASCII `?`. BytePlus punctuation emits full-width `？`
  for Chinese. Also split sentences on `。！？` — and catch Chinese question forms that
  end without `？` (吗/呢/多少/什么/怎么...) via the existing LLM classifier.
- [ ] **Z2. Word-count triggers never fire in Chinese.** All `split(/\s+/)` counts
  (summary trigger at :1038/:1048, final-summary gate at :1089, word counter at :1020)
  treat an entire Chinese utterance as 1 word → summaries effectively never trigger in
  zh meetings. Use a CJK-aware count: CJK chars count individually (÷~2 to approximate
  words) + whitespace tokens for Latin.
- [ ] **Z3. Vault RAG returns nothing for Chinese queries.** `match(/[a-z0-9']+/g)`
  (meeting.html:598) drops all CJK characters. Tokenize CJK as bigrams (or per-char
  substring match) alongside Latin words; keep STOPWORDS Latin-only.
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
- [ ] **L0. Extract pure text logic + eval harness.** Move question detection, word
  counting, vault search, markdown formatting into a shared module loadable by both
  meeting.html and Node; add `evals/run.mjs` with zh/en/mixed fixtures. (Do this
  before or together with Z1–Z3 so they land tested.)
- [ ] **L1. Replace deprecated ScriptProcessorNode with AudioWorklet.**
- [ ] **L2. Key hygiene.** Warn that Save Config writes keys in plaintext; consider
  encrypting the config export with a passphrase.
- [ ] **L3. Fix stray `btn` element selector** (`btn, .btn` in CSS, meeting.html:69).

## Done
(move completed items here with commit hash)
