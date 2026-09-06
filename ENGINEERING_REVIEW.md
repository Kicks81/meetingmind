# MeetingMind — Mixture-of-Agents engineering review (06/09/2026)

Five models reviewed this codebase independently, then argued about it across two reaction
rounds, using the new `/moa` skill (`C:\Users\CheeKuangTan\.claude\skills\moa\`). No
orchestrator, no pass/fail gate — every seat was a peer. This document is the synthesis: a
Principal Engineer / agency-lens read of what's still wrong, organized by theme, with every
finding attributed to whoever raised or contested it. It supersedes nothing in
[BACKLOG.md](BACKLOG.md) or [DEVELOPMENT.md](DEVELOPMENT.md) — it's a second opinion layered on
top, aimed specifically at gaps the existing audit history hadn't logged.

## Method

- **Roster**: Sonnet 5, Opus 5, Fable 5.1 (local, full repo read access) + Mimo V2.5 Pro and a
  GLM-5.3-Flash seat (external, dispatched via `multiagent`'s `run_agent.ps1`, everything inlined
  into one ~300KB briefing packet — architecture docs, backlog, contract, and the full source).
- **Rounds**: 1 independent review → 2 reaction rounds (each seat sees every other seat's most
  recent position, labeled by name, and is asked to agree/disagree/build on specifics) →
  this synthesis.
- **Data point worth recording, corrected after the fact**: the real GLM-5.3-Flash model
  returned empty completions on every attempt across the original three rounds. At the time this
  looked like a z.AI-side outage (`run_agent.ps1`'s retry/fallback logging showed clean HTTP-0
  "provider returned an empty completion" failures, and the seat fell back each time to the
  configured cross-provider backup, **minimax/minimax-m3 via OpenRouter**). It wasn't an outage.
  A one-line smoke-test prompt succeeded against the same key/role instantly, which pointed at
  the actual cause: `multiagent`'s `providers.json` had the `auditor` role's `default_max_tokens`
  set to 12000, and GLM-5.3-Flash reasons at length before producing visible output — on a large,
  complex packet like this one, it can exhaust the whole budget in reasoning tokens and return an
  empty completion instead of a truncation error. (This is the same failure this project's own
  DEVELOPMENT.md documented once before, at D32, at `max_tokens=8000`.) Fixed permanently:
  `providers.json`'s `auditor.default_max_tokens` raised 12000 → 32000, with the symptom and
  diagnostic written up as a dated entry in `multiagent/SKILL.md` so a future session hitting this
  doesn't have to re-diagnose it. With the higher budget, GLM-5.3-Flash answered for real on retry
  — genuine model, not a fallback — and **a short reconciliation round was then run**, showing all
  four other seats GLM's actual Round 1 answer (which they'd never seen — they'd only reacted to
  the minimax stand-in) and asking whether its findings changed anything. All four independently
  spot-checked GLM's claims against the actual code before answering. The findings below are the
  result of that reconciliation: GLM's real contributions, credited to GLM by name, folded into
  the themed sections alongside everyone else's. The minimax stand-in's few genuinely correct
  contributions (Round 1 and Reaction Round 1 only, before the fix) are credited to minimax and
  kept; its three checked-and-wrong claims are kept in "Discarded claims" below as a record of
  what a same-slot but different model got wrong, not as GLM's output.

---

## Do this first, before anything else in this document

**The repo has ~751 uncommitted lines (dated 18/08/2026) sitting inside a OneDrive-synced folder,
and `git log` stops five commits before `origin/main`.** (Fable, corroborated by Opus and Mimo.)
BACKLOG.md's "Done (commit V1:)" notation for V1–V3 has no corresponding commit — the loop has
been recording completions it never verified. A stray `meeting note taker/` duplicate already
sits in this tree; that's what a OneDrive sync conflict on `meeting.html` produces (a renamed
copy plus a reverted original), and CONTRACT.md already has to tell auditors to ignore it. Every
finding below is one sync event from disappearing until this is committed and pushed, and ideally
moved out of the OneDrive-synced path entirely. Fable and the minimax seat both flagged this as a
mechanical action, not a code change — do it in the first hour, separately from the ranked list.

---

## 1. The silent total-data-loss paths (four, not two)

**Stop-path export silently fails when Chrome has reverted the vault-folder permission to
`prompt`, and the status dot stays green.** Found independently by Opus (#5) and Fable (R1),
corroborated by Mimo and the minimax seat. `toggleRecording()`'s stop branch calls
`sendAllObsidianChunks()` with `interactive = true` after several `await`s have already consumed
the click's transient user activation — Chrome rejects `requestPermission()` at that point, the
branch has no try/catch, and `updateVaultStatusUI()` paints the vault status green off *handle
existence*, never off actual `queryPermission()` state, so nothing on screen says anything is
wrong. Fable's addition is what makes this urgent rather than an edge case: Chrome reverts File
System Access permission to `prompt` whenever the origin's last tab closes, so this is the
**normal state on the first meeting of any day**, not a rare fault. It compounds with
`maybeShowVaultHint()` also returning early for the same reason — the one banner that could have
warned the user is suppressed by the same condition that broke the export.
*Fix shape (converged):* call `ensureVaultReady(true)` as the first synchronous statement of the
Stop branch, while the click's activation is still alive — not deferred into an `await` chain;
wrap the whole branch in try/catch with a loud persistent banner; drive every status indicator
off `queryPermission()`, not handle presence. Fold in Opus's #4 here too — `writeVaultNote`'s
append path blanket-catches the read and then truncates on *any* failure, not just "file doesn't
exist," which matters directly because this vault lives under OneDrive and a transient sync lock
is not hypothetical. Distinguish `NotFoundError` from everything else; two lines.

**`Clear` has no confirmation, and a second door behind it makes the fix bigger than it looks.**
Found independently by all five seats. `clearAll()` wipes the DOM and
`localStorage.removeItem(AUTOSAVE_KEY)` — the only crash-safety copy — with zero `confirm()`,
sitting in the header next to low-stakes buttons like Save/Load Config. Mimo's addition is the
sharper mechanism underneath: there's no epoch counter or abort mechanism, so a summary or
action-item call still in flight when Clear fires can land *after* the wipe and repopulate
`meetingContext`/`summaryCount`/DOM panels with ghost content from the meeting that was just
cleared. Fable and Opus also independently found a second door: declining the restore-on-load
prompt keeps the previous meeting's snapshot in `localStorage`, but the very next `autosave()`
tick (five seconds into the new meeting) overwrites that key unconditionally — so "Cancel, let me
look first" quietly destroys the meeting it was trying to preserve.
*Fix shape (converged):* `confirm()` naming what's unexported ("N segments, M summaries not yet
written to your vault"); a `_prev` snapshot key written before the first overwrite (three lines,
closes the decline-restore door); an epoch counter checked by every async callback plus an
`AbortController` on in-flight fetches, so a wipe actually wipes.

**Action Items and Decisions reach the vault only through one LLM call, and its failure looks
like success.** (GLM's finding, verified independently against the code by Opus, Fable, and
Mimo.) `unexportedObsidianElements()` selects transcript segments, non-consolidated summary
blocks, and Q&A cards for export — it never selects `.action-card` elements. The curated action
list only reaches the vault as text inside `generateFinalSynthesis()`'s output. So if that one
LLM call fails — and D14's own error-handling philosophy assumes LLM calls fail sometimes — the
failed block is removed, a 4-second `flashStatusError` fires, and `sendAllObsidianChunks()` still
runs and still writes a note. The result is a complete, successful-looking export with no Action
Items and no Decisions section, and nothing about the write itself signals that anything is
missing. Opus's addition: `generateFinalSynthesis` also returns silently when the API key is
blank or the source text is empty — an even quieter version of the same failure.
*Fix shape (converged):* export the curated action list as its own deterministic section,
independent of the final-synthesis LLM call succeeding — the same instinct as §3's fix for the
final synthesis itself, applied to a different input.

**A specific permission-decline path produces a false "everything's already exported — re-write?"
dialog, and clicking through it wipes the export ledger.** (GLM's finding, verified against the
code by all four other seats.) When a connected vault folder's permission has been declined (or
lapsed, per the bug above) and the `obsidianVault` name field is empty, `sendObsidianChunk()`
returns `false` on the empty name, `exportGuarded()` propagates `false`, and `addToObsidian()`
falls into the branch that assumes everything is already exported — offering a full "RE-WRITE the
whole meeting" confirm. Nothing was actually exported. Clicking through clears every
`data-obsidian-exported` flag, nulls `obsidianNotePath`, and empties `exportLedger` — destroying
the one audit trail (D20) that could have shown the user nothing had gone out. Fable's framing:
this is a sibling failure mode to the permission-lapse bug above, not a duplicate — different
trigger condition, and worse in one respect (it destroys the ledger rather than just failing
silently).
*Fix shape (converged):* make `sendAllObsidianChunks()`/`exportGuarded()` return a tri-state
(exported / nothing pending / blocked-with-a-reason) instead of a boolean, and only offer the
re-write path when the export ledger shows genuine prior successful exports.

## 2. The audit chain has been certifying things that aren't true

Four independent doc/code divergences surfaced across three reviewers, and the group converged
that this is one process finding, not four unrelated bugs:

- **`SUGGEST_EVERY_N_SUMMARIES = 1` in code vs. D29's documented "every 3rd rolling summary."**
  (Opus, Mimo.) Mimo priced it at roughly 40 unnecessary suggestion calls per two-hour meeting,
  each carrying the full context plus the already-raised list — real, uncosted OpenRouter spend
  nobody sees.
- **D25 states the relay holds the BytePlus key via a `BYTEPLUS_KEY` environment variable; the
  code takes it from the browser's per-connection init frame and never touches an env var.**
  (Sonnet, confirmed by Fable and the minimax seat.) Anyone reasoning about relay hardening, log
  redaction, or attack surface from D25's description would reason about the wrong thing.
- **Z4 ("output language pinned to the speech") is marked Done, and P0's emptiness partly rests
  on it — but the code deliberately does the opposite** via an `ENGLISH_ONLY` instruction hard-pinning
  summaries/synthesis/Q&A to English regardless of the speech's language, with only the note
  *title* following `languageInstruction()`. (Fable.) A Chinese meeting gets a Chinese filename
  over an English body, and the reversal is recorded only in a code comment, not a BACKLOG
  strikethrough with a reason — which BACKLOG's own house rule requires.
- **CONTRACT.md's known-items list cites D25 for the direct-vault-writes decision; that decision
  is D28.** (Fable.) A small thing, but symptomatic of the same pattern.
- **DEVELOPMENT.md's D27/E4 "Done" entry describes a diagnostics UI that doesn't exist in the
  shipped code.** (GLM, verified independently by Sonnet, Opus, and Fable.) D27 claims a 50-frame
  inspection buffer with per-frame timestamps and error tags, an immutable connection timeline,
  and a downloadable diagnostics report behind a "Settings button → Diagnostics tab." The actual
  drawer's `renderDiagnostics()` prints only the scalar counters in `currentDiagState()` — no
  frame buffer, no timeline, no file export (`copyDiagnostics()` copies to the clipboard, nothing
  more), and no Settings button. This matters more than the other three divergences in this
  cluster: it's the tool a debugger reaches for *during* an incident, and right now it isn't the
  tool the docs describe.
- **Two more instances of the same pattern, same D-note family.** D25 claims the relay "tries the
  next available port" on a conflict; `relay.js` actually just exits on `EADDRINUSE` and tells the
  user to pass a port manually — there's no automatic fallback. D26 documents PBKDF2 at 100,000
  iterations for config-export encryption; the code hardcodes 200,000. (GLM; both verified by
  Opus, who flags the PBKDF2 one as a divergence that runs *safe* — the code is stronger than the
  doc claims, not weaker — so a "fix the docs to match the code" pass must correct the doc upward,
  not quietly weaken the code to 100k to match it.)
- **D22/L1's AudioWorklet claim overstates what actually changed.** (GLM, verified by Sonnet,
  Opus, and Fable.) D22 says frame transmission timing is "now independent of main-thread load."
  It isn't, fully: the worklet moves audio *capture* off the main thread, but `onCaptureChunk()`
  → `sendAudioChunk()` (gzip + `ws.send()`) still runs on the main thread per chunk. A multi-second
  main-thread stall — the original D13 symptom — still delays transmission; it now presents as a
  burst of catch-up rather than steady drift, which is a real improvement, just not the
  elimination the doc claims. Opus also notes the reverse-direction divergence in the same
  decision: D22 says the old `ScriptProcessorNode` fallback "is not provided," but
  `createCaptureNode()` implements exactly that fallback — correct code, wrong doc, the opposite
  error from the diagnostics/relay/PBKDF2 cases above. The asymmetry is itself worth naming: the
  doc/code gap in this project runs in both directions, which means neither can be trusted as the
  source of truth without checking the other.

**Bigger than any one of these: the flagship auto-Q&A feature described in CLAUDE.md,
CONTRACT.md, D6, and D14 does not exist in the shipped app.** (Fable — the single most important
finding of the whole exercise by the other four seats' own final assessment.) `core.extractQuestions`
is exported and carries ten eval fixtures, but the root `meeting.html` never destructures or calls
it (line 813's destructure omits it); the only remaining reference is in the stale
`meeting note taker/` duplicate. The Q&A panel's own empty-state text quietly confirms it ("Tick a
role lens… or ask your own"). Auditors handed CONTRACT.md verbatim — as this project's own process
does — have been auditing a feature that was deleted, and D7's "ratchet" evals prove the
underlying functions still work without ever proving the app calls them. This needs an explicit
yes/no decision (restore the wiring, or strike it from CLAUDE.md/CONTRACT.md/D6 with a dated
D-entry) before anything else here gets prioritized against a contract that may be describing a
phantom.

**Process fix, agreed by all five:** extend `evals/run.mjs`'s existing `meeting.html` greps — which
already catch structural duplication — to also assert (a) every exported `core` function is
referenced somewhere in the root file, and (b) tuning constants match the number their own
D-note claims. Cheap, and it's exactly the category of bug that just cost this review its most
important finding.

## 3. The one artifact the product exists to produce is quietly wrong

**`generateFinalSynthesis()` reads only the last ~15–20 minutes of a multi-hour meeting, always,
by construction — not as an occasional degradation.** (Mimo #3/#12, independently reinforced by
Fable and conceded by Opus and the minimax seat.) `meetingContext` is capped at 6000 characters
(D13); `generateFinalSynthesis` reads `(meetingContext || finalTranscript).slice(-12000)` — since
`meetingContext` is non-empty after the first summary, the `finalTranscript` fallback is dead code
at that call site, and slicing the last 12000 characters of a string capped at 6000 is a no-op.
For a 90-minute meeting, the "definitive record" DEVELOPMENT.md §4 already flags as reading only
the tail is understating it: the fix is half-built and sitting unused. D30's consolidated block is
already a deduplicated, whole-meeting view with the raw markdown (`__md`) stashed on it, excluded
from its own source and from the Obsidian export loop for good documented reasons — and excluded
from final synthesis for no reason anyone can find. Wiring the consolidated block into synthesis
instead of the capped rolling context is, by the roster's own assessment, the single biggest
correctness gain per line changed in this entire review. §4's framing of this as a "tolerable
limitation" should be corrected — it's a correctness bug in the artifact the whole product exists
to produce, and CONTRACT.md's own words apply directly: "a note that is subtly wrong is worse than
a note that is visibly incomplete." GLM's reconciliation finding widens this beyond final
synthesis: `answerQuestion()` and `suggestRoleQuestions()` read the same 6000-character tail, so a
manually-asked or auto-suggested question about anything from the first hour of a long meeting is
answered ungrounded, with no signal to the user that the context wasn't actually available — this
was not covered by DEVELOPMENT.md §4's original framing of the limitation at all, and the same
fix (feed from the consolidated block or a proper map-reduce over the full transcript) should
cover all three call sites, not just the one in final synthesis.

## 4. Fabricated content in the export, again

**Every remaining `**Q:**` line in an exported note is now, unconditionally, a question nobody
asked in the meeting.** (Opus #1, elevated further by Fable's finding above and endorsed by the
minimax seat.) With spoken-question auto-detection gone (§2), the only surviving `.qa-card`
producer is `answerQuestion()`, wired to the manual "ask the AI" box — and it sets no
`data-suggested` or origin marker before export. So a RAG-derived answer to a question the user
typed to the assistant now exports under the exact `**Q:** … / **A:** …` heading reserved for
things actually said aloud. This is the identical failure class D32/E9 fixed for role-lens
suggestions — but that fix was scoped to the one card type the original auditor happened to name,
not to the underlying invariant ("only content actually spoken exports in speech shape"). The
lesson the group converged on, credited to Opus: **when a fabricated-content bug is found,
enumerate every producer of the affected element class before closing it** — not just the one an
auditor pointed at. Fix is a one-screen diff: tag the manual-ask card with an explicit
`data-origin="asked-of-ai"` at creation, and make the export logic a whitelist (only export
`.qa-card`s with a recognized origin marker as spoken content; anything else exports under a
clearly-labeled "asked of the assistant, not in the meeting" heading, the same pattern D32 already
established for suggestions).

## 5. D9 (localStorage vs. IndexedDB) — the roster's clearest disagreement-with-a-past-decision

All five seats independently arrived at the same position: D9's threshold ("migrate to IndexedDB
when multi-meeting history arrives, not before") was already crossed by the time D1 shipped, not
merely tested by it. D1 had to build a whole trim-and-recover subsystem
(`trimSegmentsToByteBudget`, a user-facing "autosave is trimming" warning) *precisely because* real
long meetings hit the 5MB quota — that's direct evidence D9's estimate failed, and the response
was to patch around localStorage's ceiling rather than revisit the choice. Mimo's addition sharpens
it: the trimmer permanently discards the *oldest* transcript segments, and CJK is 3 bytes/char in
UTF-8, so a Chinese-heavy meeting exhausts the trim budget roughly three times sooner than an
English one — the crash-safety layer degrades fastest in exactly the language this product is
supposed to be best at. The marginal cost of fixing this is now low: D28 already introduced
IndexedDB plumbing for the vault directory handle (`openHandleDb`/`idbOp`), thirty lines from
where autosave lives. **Converged fix:** ship a `_prev` snapshot key immediately (three lines,
closes the Clear/decline-restore footgun from §1); schedule the full snapshot migration to the
existing IndexedDB store as a near-term item, not "when multi-meeting history arrives."

## 6. User curation never propagates — corrections AND deletions

`addCorrection()` only patches on-screen transcript segments — it never touches `finalTranscript`,
`meetingContext`, or `pendingText`. (Opus #7, reinforced by Sonnet and Fable.) So the ✏️ Fix
affordance — built specifically for the case where a user notices an ASR error *after* it's been
said — corrects the visible transcript but leaves the final note, the note's filename, and every
subsequent rolling summary saying the mis-heard variant forever, because those all read from the
uncorrected context buffers. This disproportionately hits the exact zh/en name-correction case
(“Swetha”, “AFO”, mixed names) CLAUDE.md calls a hard constraint, and it compounds with Sonnet's
finding that the correction/hotword list has no size cap — a long-lived user could silently exceed
an undocumented BytePlus hotword limit with no error surfaced anywhere.

**GLM independently found the broader version of the same bug, and it's worse than the
correction-only framing above: deletion has the identical defect.** (Verified against the code by
Sonnet, Opus, and Fable.) `deleteSegment()` (small-talk cleanup, or a manual ✕) only calls
`el.remove()` on the DOM node — `finalTranscript` and `meetingContext` are append-only and never
have the deleted text removed from them. Since `generateFinalSynthesis()` reads
`(meetingContext || finalTranscript)`, small talk the user explicitly deleted, and text later
corrected, can both resurface in the one artifact meant to be the definitive record — while the
on-screen transcript agrees with the user that the cleanup worked. Fable's framing is the sharpest:
this is fabrication-by-staleness, the exact failure class CONTRACT.md calls worst, because the
user has no reason to suspect it — the screen shows the fix took.
**Fix (converged):** rather than patching each mutation site individually, rebuild
`meetingContext`/`finalTranscript` from the live DOM (`.seg-text` elements) whenever a
deletion or correction happens — the codebase already treats the DOM as the source of truth for
export and autosave (D33/V3's own reasoning), so this extends an existing pattern rather than
introducing a new one. Add zh/en/mixed eval fixtures on the rolling-context path specifically, not
just the DOM path D8's evals already cover.

## 7. CJK correctness gaps an English-only test session cannot surface

Two related findings, both invisible unless someone actually tests in Chinese:

- **Streamed LLM output is decoded without a streaming-safe decoder, and partial SSE lines are
  silently dropped.** (Opus #2, independently confirmed by GLM's own review before reconciliation
  even paired them up — the strongest possible form of convergence, two seats finding the same
  three-line bug with no visibility into each other.) `decoder.decode(value)` is called without
  `{stream: true}`, so decoder state resets on every network chunk — a UTF-8 sequence split across
  a chunk boundary becomes a replacement character — and a `data:` line cut mid-chunk fails
  `JSON.parse` and is swallowed by a bare `catch {}`. Mimo pushed back usefully on the initial
  framing (a chunk boundary landing mid-codepoint is *possible* for CJK's multi-byte sequences and
  *impossible* for single-byte ASCII — not literally "3× the exposure" as first stated), and Opus
  added on reconciliation the half everyone had under-weighted: **the dropped-line failure mode is
  not CJK-specific at all** — a `data:` line split across a read boundary loses a token in English
  output exactly as readily as Chinese, it's just invisible unless someone is watching closely.
  That makes this a general streaming-robustness bug with an additional, CJK-specific corruption
  mode layered on top, not a CJK-only issue. Severity scoping (converged): `suggestMeetingTitle()`
  (a corrupted character in the **filename**) and `maybeSplitSpeakers()` (writing a corrupted
  character back into the **authoritative transcript**, where `parseSpeakerSplit`'s length-based
  guard doesn't catch it) are the sharpest paths; a stray replacement character or a silently
  dropped word inside a rendered summary pane is real but lower-severity by comparison. Fix: a
  persistent `TextDecoder(..., {stream:true})` plus a residual-line buffer across `reader.read()`
  iterations, with an eval fixture that splits a CJK SSE stream mid-codepoint and a second that
  splits an SSE line across two reads regardless of language. **Worth noting for its own sake**:
  this bug was independently found twice, confirmed by four of five seats on reconciliation, is
  cited in this very document, and the fix is roughly ten lines — it should not still be sitting
  in a review document instead of a diff. Multiple seats flagged on reconciliation that this
  deserves to sit higher in the final recommendation than its original placement below; the
  ordering at the end of this document reflects that.
- **No CJK font stack, and `lang="en"` on a Chinese-first product.** (Fable.) The body font stack
  is Segoe UI + generic sans-serif, which has no Han glyphs — every mixed zh/en transcript line
  gets per-glyph font substitution with mismatched weight and baseline, and `lang="en"` can steer
  shared Han codepoints toward the wrong regional font fallback on some Windows configurations.
  For a product whose stated differentiator is code-switched Chinese/English, this is the first
  thing a Chinese-reading user notices. Cheap fix: add CJK-capable fonts to the stack, set `lang`
  per segment from the existing `dominantLanguage()` classifier.

## 8. Secondary robustness cluster (converged, lower individual severity than 1–7)

- **Stop Meeting appears finished when it isn't.** (Opus #10, Fable.) The button flips to "Start
  Meeting" and status to "Stopped" immediately, then 20–60 seconds of un-guarded work follows
  (final summary, streaming synthesis, vault write) with the button fully re-armed. A user who
  reasonably clicks again — thinking the first click didn't register, or starting the next
  back-to-back meeting — re-enters the start branch mid-export. **The roster explicitly rejected
  the minimax seat's proposed fix (a confirmation dialog on Stop)** as solving the wrong problem:
  Stop is the single most common action in the app, and a modal there taxes every meeting to guard
  a rare misclick while leaving the real defect (Stop *looks* done when it isn't) untouched.
  Converged fix instead: disable the button through the whole pipeline, relabel it by actual phase
  ("Writing final summary…", "Saving to vault…"), and finish with a dismissible banner naming the
  written path and segment count.
- **Audio frames can reach BytePlus out of order, and the terminal frame can overtake a
  still-compressing chunk at Stop.** (Opus #3.) `sendAudioChunk()` is async (awaits a
  `CompressionStream` round-trip) but invoked un-awaited from the capture callback — nothing
  serializes it, and the terminal packet at Stop is awaited and sent while earlier chunks may
  still be in flight, discarding them after the last-packet flag. Mimo initially argued reordering
  was near-impossible given a single ordered WebSocket hop; Opus's rebuttal, which the roster
  accepted, is that the race is decided client-side (by whichever `CompressionStream` promise
  resolves first, before anything reaches the socket), not on the wire — so the ordering guarantee
  genuinely doesn't exist. The mid-meeting reordering risk stays a probabilistic, unconfirmed
  concern (P2a); the Stop-time tail-truncation is deterministic under load and worth fixing
  regardless. Fix: a `sendQueue` promise chain — the codebase already has this exact pattern twice
  (`summaryQueue`, vault-write queue).
- **Reconnect gaps are silently absent from the transcript.** (Opus #6, endorsed by Mimo.) Nothing
  buffers audio while `!asrReady` during reconnect backoff, and nothing marks the gap — the
  transcript and export read as continuous when minutes of discussion are simply missing. D14's
  "never lose transcript text" guarantee is accurate for the LLM pipeline and inaccurate for the
  audio pipeline; either implement a short PCM ring buffer to flush on reconnect, or narrow the
  documented guarantee — leaving the mismatch as-is is the one option the roster agreed against.
- **LLM call failures by HTTP status (401/402/429) never reach the user-visible error path.**
  (Opus #8, verified by Fable.) `runGenerateSummary`'s failure branch removes the block and logs a
  `console.warn` — no `flashStatusError`. Credit exhaustion or a rate limit, the single most likely
  real-world LLM failure, currently produces zero UI signal.
- **Background LLM traffic per utterance is uncapped, unqueued, and its failures are console-only**
  (Opus's original Round 1 finding, independently reinforced by GLM with the specific
  rate-limit-starvation angle). `detectActionItems()` fires per finalized utterance and
  `maybeSplitSpeakers()` per utterance over ~12 words, both fire-and-forget with no shared queue
  or concurrency cap — a fast zh/en exchange can put a dozen parallel OpenRouter calls on one key
  at once, which can starve the rolling-summary/final-synthesis calls sharing that same key.
  `detectActionItems`'s failure path deliberately only logs ("log and move on"), so a missed
  commitment — arguably the costliest silent failure this app can produce — leaves no signal
  anywhere except a counter inside the diagnostics drawer nobody has open. Fix: route all
  fire-and-forget per-utterance LLM calls through one shared, concurrency-limited queue (the same
  `summaryQueue`/vault-write-queue pattern already used twice elsewhere), with a persistent badge
  once background extractions fail more than a couple of times in a row.
- **No `beforeunload` guard while recording** (Fable, independently confirmed by GLM). The only
  `beforeunload` handler autosaves; nothing sets `event.returnValue`, so a stray Ctrl-W or a
  Chrome update prompt during a multi-hour meeting ends capture instantly with no confirmation.
  Restore recovers the transcript text captured so far, but not the meeting from that point
  forward, and the user may not immediately notice recording stopped. Cheap, standard
  confirm-on-unload fix.
- **Changing the relay's port stashes every local artifact behind a different origin** (GLM). All
  `localStorage` state — both API keys, the correction dictionary, role-lens choices, and the
  `AUTOSAVE_KEY` crash snapshot — is scoped per-origin. The relay URL is user-editable, and a port
  conflict on `:8765` (already a documented scenario per D25b) means running on `:8766` afterward
  puts the app on a new origin with zero keys, an empty dictionary, and — worst case — no
  visibility into the autosave snapshot of the meeting that just crashed under the old port. Low
  frequency, but worth a loud warning rather than silent stranding: refuse non-default ports
  without an explicit flag, and surface the active origin somewhere visible.

## 9. PDPA / third-party data flow — flagged for compliance review, not shipped as a code fix

Per InCorp_SG policy (customer/employee data, cross-border transfer, third-party sharing all
require compliance review before action), the roster is unanimous that this cluster should route
there before any engineering change assumes an answer:

- `hotwords` and `userName` are in `PERSISTED_FIELDS` but not `SECRET_FIELDS` — a config export
  with API keys already cleared downloads colleagues' names in plaintext with **no prompt at
  all**. (Opus #16.)
- `detectActionItems` injects `userName` into the LLM prompt, directly contradicting backlog item
  A1's own stated principle ("never send names to the LLM"). (Fable R7.)
- No OpenRouter provider preference (e.g. a data-retention-deny routing flag) is set on any
  request; up to four ~1000-character vault excerpts go out per Q&A call. (Fable R7.)
- The correction dictionary's "right" terms are transmitted to BytePlus as ASR hotwords on every
  session start (D8) — an undocumented, recurring cross-border transfer of what is very plausibly
  personal name data, with no policy note anywhere acknowledging it.

None of this should be treated as a queued backlog ticket to close unilaterally — flag it up per
[org policy] for a compliance read on data retention / cross-border transfer / third-party sharing
before deciding what changes.

## 10. The process finding the roster rated above any individual bug

**Before picking the next item off BACKLOG.md, open the last real meeting's exported note and
check that it is actually complete.** (Fable's meta-finding — independently endorsed by Opus, Mimo,
and the minimax seat as the single most valuable recommendation in the whole discussion, and yet
the one that got the least airtime in every individual review.) The current improvement loop has
repeatedly shipped engineering hygiene (E1–E4: relay hardening, preflight checks, config
encryption, a diagnostics drawer) ahead of verifying the actual output was correct — and that gap
is exactly how the deleted auto-Q&A feature, the 15-minute-only final synthesis, and the
lapsed-permission silent non-export all went unnoticed for weeks. This one check — read the last
note, not the code — would have caught all three without anyone opening `meeting.html`. Add it as
the first filter in [IMPROVEMENT_LOOP.md](IMPROVEMENT_LOOP.md), ahead of "pick the top unchecked
item."

---

## What the roster explicitly said NOT to prioritize (and why that's worth stating)

- **Header/toolbar density** (all five seats found it independently — the widest convergence of
  any finding in the review) was nonetheless pushed *down* to P2b by explicit multi-seat argument:
  convergence here measures *visibility*, not *severity*. It's the first thing every reviewer sees,
  which is exactly why it causes one confused first session and nothing after — it produces no
  data loss and no silent corruption, unlike everything ranked above it. Opus flagged this
  explicitly as the one place where "everyone found it" should not be read as "it's the most
  important thing."
- **A confirmation dialog on Stop Meeting** (proposed by the minimax seat) was rejected 3–1 as
  solving the wrong problem — see §8.
- **Autosave's per-tick `JSON.stringify` cost** (raised by Mimo, initially agreed to by the
  minimax seat) was downgraded by Opus and Fable to cleanup-only: roughly a millisecond of work,
  twelve times a minute, off the audio-capture thread since the AudioWorklet migration. Mimo
  itself conceded this in the final round.
- **`.qa-answer` exporting as run-on text** (currently sitting in BACKLOG P1) is real and ships
  daily, but the roster agreed it's a legible defect in an otherwise-correct note, and does not
  belong ahead of items that make the note *silently wrong or fabricated* (§§1–4 above).
- **GLM's remaining lower-severity findings** (from its real, reconciled Round 1 answer) largely
  reinforce themes already covered above rather than opening new ones, and the roster left them at
  the tier they were already at: no in-app readiness check before Start (reinforces §1's header/
  setup-clarity theme), suggested questions having no one-click "ask" action (a UX gap, not a
  correctness one), no single resolved-destination line for "where do my notes go" (the same
  two-vault-mechanisms confusion already discussed), no CSS distinguishing exported from pending
  content, the split panes reserving 50% for an often-empty half (already covered above under the
  consolidated-pane finding), the Live Summary header wrapping into multiple lines on common laptop
  widths (the same header-density theme, already deliberately ranked down), and errors
  self-erasing after a fixed 4-second timer rather than persisting until resolved (reinforces the
  error-visibility point already made about LLM failures above). None of these are wrong; they
  just don't change the ranking already established.

### Discarded claims (from the minimax-fallback seat, factually checked and rejected)

Three of this seat's Round 1 claims were checked against the actual code by other seats and found
incorrect — noted here so they aren't accidentally reintroduced later: the header row does *not*
lack `flex-wrap` (its own quoted evidence contradicts the claim); the Rephrase flow retaining a
question's old key is what *prevents* the same wording from being re-offered, not a bug that
causes it; and the Dismiss button does clear a suggestion for the rest of the session (only a
reload can bring a dismissed suggestion back, a narrower and real but different problem than
described). Its genuine, verified contributions (the missing `.obsidian/` folder check on vault
connect, and Save Config's "Cancel" path still downloading plaintext keys) are folded into the
relevant sections above.

**Reconciliation note**: the real GLM-5.3-Flash's Round 1 answer superseded the minimax stand-in's
Round 1 contribution once the token-budget fix (see "Method" above) let it answer for real. All
four other seats were shown GLM's actual answer and asked to react — every one of them
independently spot-checked GLM's load-bearing claims against the working-tree code before
answering, and every claim they checked held up (the AudioWorklet-overclaim and
diagnostics-drawer findings above, in particular, were each verified line-by-line by three of the
four). Nothing in GLM's real answer was found wrong. The findings credited to GLM throughout this
document — most notably the streaming-decoder confirmation in §7, the two new silent-loss paths in
§1, the broadened corrections-and-deletions finding in §6, and the additional doc/code divergences
in §2 — are from that real answer, reconciled against the other four seats' reactions to it, not
from the minimax stand-in described above.

---

## Recommendation

Revised after the reconciliation round (GLM's real answer moved three items up from where the
roster first placed them — see §§1, 2, 6, 7 above for the reasoning). In order, before touching
anything else in BACKLOG.md:

1. Commit and push the outstanding ~751 lines; get the repo out of the OneDrive-synced path.
2. Resolve the auto-Q&A phantom-feature question (restore the wiring or strike it from
   CLAUDE.md/CONTRACT.md/D6 with a dated entry) — everything else here is being measured against a
   contract that may currently describe a feature that doesn't exist.
3. Fix the streaming SSE decoder (§7) — roughly a ten-line change, found independently twice, the
   fix protects the app's core differentiator in its hottest code path, and there is no good reason
   for it to still be an open finding rather than a diff by the time anything else on this list
   ships.
4. Fix the four silent total-loss paths in §1: Stop-path export permission, Clear, Action Items
   reachable only through one LLM call, and the false re-write dialog that wipes the export ledger.
5. Wire the consolidated block into final synthesis *and* into `answerQuestion`/
   `suggestRoleQuestions` (§3) — highest quality gain per line changed in this entire review, now
   scoped to all three call sites reading the same capped tail, not just one.
6. Fix the manual-Q&A fabrication (§4), rebuild `meetingContext`/`finalTranscript` from live DOM on
   any deletion or correction (§6, broadened from corrections-only to corrections-and-deletions),
   the doc/code divergence cluster — now four confirmed instances plus its grep-guard (§2), and add
   Fable's "read the last note before grooming the backlog" gate to IMPROVEMENT_LOOP.md (§10).
7. Everything remaining in §8, roughly in the order given there.
8. Route §9 (PDPA) to compliance review in parallel with the above — it doesn't block engineering
   work, but it shouldn't be resolved by a code change made without that input.

This is the roster's converged read, not a verdict — three items above are documented, resolved
disagreements-in-judgment rather than settled fact (audio-frame reordering severity, CJK-decoder
severity split, and the `obsidian://`-fallback deprecation question, which the roster agreed is an
owner decision to relax a CLAUDE.md hard constraint, not something a backlog item can decide
unilaterally). Flag that one for a decision from whoever owns the constraint.
