// MeetingMind core — pure text-processing logic shared between meeting.html
// (via <script src="core.js">) and the Node eval harness (evals/run.mjs).
//
// Everything in here must stay side-effect free: no DOM, no network, no
// timers. That's what makes it testable — keep it that way.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MeetingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Question detection ──────────────────────────────────────────────────
  // A question is any sentence ending in ASCII "?" or full-width "？"
  // (BytePlus punctuation emits ？ for Chinese speech). Sentence boundaries
  // include the CJK terminators 。！？ so a preceding Chinese statement
  // doesn't bleed into the extracted question.
  const QUESTION_PATTERN = /[^.!?。！？]*[?？]/g;
  const HAS_CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

  // Returns candidate question strings found in a chunk of transcript text.
  // Dedupe against previously-seen questions is the caller's job. The
  // min-length filter drops conversational fragments ("Really?") — CJK text
  // packs a whole question into few chars, so it gets a lower floor.
  function extractQuestions(text) {
    return (text.match(QUESTION_PATTERN) || [])
      .map(q => q.trim())
      .filter(q => q.length >= (HAS_CJK.test(q) ? 5 : 10));
  }

  // Normalised form used to dedupe repeated questions.
  //
  // Whitespace+case folding alone is not enough once CJK is involved: the same
  // question comes back as "谁负责映射？" and "谁负责映射?" depending on the
  // model's IME conventions, and those are different strings. Full-width and
  // half-width terminal punctuation must therefore fold together, or dedupe
  // silently fails for zh and the same suggestion is re-offered every cycle.
  // Trailing punctuation carries no meaning for identity, so drop it entirely.
  const TRAILING_PUNCT = /[?？!！.。,，、;；:：\s]+$/;

  function questionKey(question) {
    return String(question || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(TRAILING_PUNCT, '');
  }

  // ── Role-tagged suggestion parsing (E6) ─────────────────────────────────
  // With several role lenses ticked at once, a suggested question is only
  // worth colouring if we know WHICH role it came from, so the model is asked
  // to prefix each line with a bracketed role key: "- [pm] Who owns this?".
  //
  // The key is validated against the known set rather than trusted: a real
  // question can legitimately open with a bracket ("[UAT] 什么时候上线？"), and
  // treating that as a role tag would silently eat the label. Unknown or
  // absent tags fall back to role:null, which renders in the neutral colour
  // with the question text intact.
  function parseSuggestedQuestion(line, validKeys) {
    // A zh-locale model asked for "- [role] …" often answers with a CJK list
    // marker instead (・ · ． 、 　), and an unstripped marker rides along into
    // the question text. \s does not cover U+3000 in all engines, so it is
    // listed explicitly.
    const text = String(line == null ? '' : line).replace(/^[\s　]*[-*•·・．、]?[\s　]*/, '').trim();
    const m = text.match(/^\[([^\]]{1,32})\]\s*(.+)$/);
    if (!m) return { role: null, question: text };
    const key = m[1].trim().toLowerCase();
    const known = Array.isArray(validKeys) && validKeys.indexOf(key) !== -1;
    return known ? { role: key, question: m[2].trim() } : { role: null, question: text };
  }

  // ── Action-item detection (U11) ─────────────────────────────────────────
  // The LLM is asked to list commitments/action items found in a chunk of
  // speech, one per line prefixed with "- ", or reply "NONE" if there
  // aren't any. Parse that reply defensively: strip the bullet marker,
  // drop stray blank/"NONE" lines, and filter out fragments too short to
  // be a real action (CJK gets a lower floor, same rationale as
  // extractQuestions — a whole commitment fits in very few characters).
  function parseActionList(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw.trim().split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l && l.toUpperCase() !== 'NONE')
      .filter(l => l.length >= (HAS_CJK.test(l) ? 4 : 8));
  }

  // Normalised form used to dedupe repeated/dismissed action items —
  // mirrors questionKey.
  function actionKey(action) {
    return action.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // ── Word counting (summary triggers, footer counter) ───────────────────
  // CJK text has no spaces, so whitespace splitting would count a whole
  // Chinese utterance as one "word" and the word-threshold triggers would
  // never fire in zh meetings. Count CJK characters individually (÷2 — a
  // Chinese word averages ~2 chars) plus whitespace-delimited Latin words.
  const CJK_CHARS = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

  function countWords(text) {
    const cjkChars = (text.match(CJK_CHARS) || []).length;
    const latinWords = (text.replace(CJK_CHARS, ' ').match(/[\p{L}\p{N}']+/gu) || []).length;
    return latinWords + Math.ceil(cjkChars / 2);
  }

  // ── Obsidian vault keyword search (Q&A RAG) ─────────────────────────────
  const STOPWORDS = new Set(['the','a','an','is','are','was','were','be','been','to','of','in','on','for','and','or','with','that','this','it','what','who','when','where','why','how','do','does','did','can','could','will','would','should','i','you','we','they','he','she']);

  // CJK has no spaces to split on, so Chinese query terms are matched as
  // character bigrams (the typical zh word length). Bigrams containing
  // high-frequency function characters (的/是/谁...) are dropped — they'd
  // match almost any note. Latin terms score double: a whole matched word
  // (e.g. "AFO") is far stronger evidence than one bigram.
  const CJK_STOP_CHARS = new Set('的了是在和与及就都也很吗呢吧啊这那有个人我你他她它们');

  function cjkBigrams(query) {
    const terms = new Set();
    for (const run of query.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]+/g) || []) {
      if (run.length === 1) { terms.add(run); continue; }
      for (let i = 0; i < run.length - 1; i++) terms.add(run.slice(i, i + 2));
    }
    return [...terms].filter(t => ![...t].some(c => CJK_STOP_CHARS.has(c)));
  }

  function latinTerms(query) {
    return [...new Set(query.toLowerCase().match(/[a-z0-9']+/g) || [])]
      .filter(t => t.length > 2 && !STOPWORDS.has(t));
  }

  function tokenizeQuery(query) {
    return [...latinTerms(query), ...cjkBigrams(query)];
  }

  // notes: [{ path, content }] → top-N [{ path, excerpt }]
  function searchVault(query, notes, topN = 4) {
    if (!notes || !notes.length) return [];
    const weighted = [
      ...latinTerms(query).map(term => ({ term, weight: 2 })),
      ...cjkBigrams(query).map(term => ({ term, weight: 1 })),
    ];
    if (!weighted.length) return [];

    const scored = notes.map(note => {
      const lower = note.content.toLowerCase();
      let score = 0;
      let firstMatchIdx = -1;
      for (const { term, weight } of weighted) {
        const idx = lower.indexOf(term);
        if (idx === -1) continue;
        score += weight;
        if (firstMatchIdx === -1 || idx < firstMatchIdx) firstMatchIdx = idx;
      }
      return { note, score, firstMatchIdx };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topN).map(({ note, firstMatchIdx }) => {
      const start = Math.max(0, firstMatchIdx - 200);
      const excerpt = note.content.slice(start, start + 1000);
      return { path: note.path, excerpt };
    });
  }

  // ── Speaker-turn splitting (text-based, not audio-based) ────────────────
  // BytePlus's streaming ASR has no confirmed speaker-diarization field —
  // its utterances carry text/timing only. When two people speak with no
  // silence gap between them (interruptions, quick back-and-forth, or two
  // audio sources summed into one mono stream), BytePlus's own utterance
  // segmentation can merge both into one text blob. This asks the LLM to
  // find a conversational turn boundary and split it back into paragraphs
  // labeled by speaker — inference from the words, not the voice, so it
  // will be wrong on ambiguous exchanges. Never invoked for the common case
  // (one utterance, one speaker) — that stays exactly as ASR produced it.
  //
  // Expected raw LLM reply:
  //   "UNCHANGED"                              — no turn boundary found
  //   "SPLIT\nA: <verbatim text>\nB: <verbatim text>\n..."
  //
  // Returns null (keep the single segment as-is) unless the reply parses
  // cleanly AND the reconstructed text is close in length to the original —
  // that guard catches a model that summarised/rewrote instead of splitting.
  function parseSpeakerSplit(raw, originalText) {
    if (!raw || typeof raw !== 'string') return null;
    const lines = raw.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || lines[0].toUpperCase() !== 'SPLIT') return null;

    const turns = [];
    for (const line of lines.slice(1)) {
      const m = line.match(/^([AB]):\s*(.+)$/);
      if (!m) return null; // one malformed line invalidates the whole split — never guess
      turns.push({ speaker: m[1], text: m[2].trim() });
    }
    if (turns.length < 2) return null; // not actually a split

    const strip = s => s.replace(/\s+/g, '');
    const originalLen = strip(originalText).length;
    if (!originalLen) return null;
    const reconstructedLen = strip(turns.map(t => t.text).join('')).length;
    const ratio = reconstructedLen / originalLen;
    if (ratio < 0.7 || ratio > 1.3) return null; // model rewrote/summarised instead of splitting

    return turns;
  }

  // ── Output-language pinning (Z4) ─────────────────────────────────────────
  // Without an explicit instruction, LLMs tend to answer in English even for
  // Chinese meetings. Classify the speech's dominant script and produce the
  // instruction line appended to summary/Q&A/title prompts.
  function dominantLanguage(text) {
    const cjk = (text.match(CJK_CHARS) || []).length;
    const latin = (text.match(/[a-zA-Z]/g) || []).length;
    if (!cjk && !latin) return 'en';
    const share = cjk / (cjk + latin);
    if (share >= 0.7) return 'zh';
    if (share <= 0.3) return 'en';
    return 'mixed';
  }

  const LANGUAGE_INSTRUCTIONS = {
    zh: 'Respond in Chinese (中文). Keep proper names and technical terms in their original language.',
    en: 'Respond in English.',
    mixed: 'Respond in the same mix of Chinese and English as the speech — Chinese for discussion, keeping English names and technical terms as-is.',
  };

  function languageInstruction(text) {
    return LANGUAGE_INSTRUCTIONS[dominantLanguage(text)];
  }

  // ── Correction dictionary (fix recurring ASR mis-transcriptions) ────────
  // corrections: [{ wrong, right }]. Longest `wrong` wins first so an entry
  // like "chata chataly" is fixed before a shorter overlapping "chata".
  // Latin terms match case-insensitively on word boundaries; CJK terms match
  // as plain substrings (CJK has no spaces, and \b doesn't work against it).
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyCorrections(text, corrections) {
    if (!corrections || !corrections.length) return text;
    const sorted = [...corrections].sort((a, b) => b.wrong.length - a.wrong.length);
    let out = text;
    for (const { wrong, right } of sorted) {
      if (!wrong || typeof right !== 'string') continue;
      const cjk = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/.test(wrong);
      // \b only exists next to a word char — apply it per edge, so terms
      // ending in punctuation ("a.f.o.") still match.
      const lead = !cjk && /^\w/.test(wrong) ? '\\b' : '';
      const tail = !cjk && /\w$/.test(wrong) ? '\\b' : '';
      const pattern = lead + escapeRegExp(wrong) + tail;
      out = out.replace(new RegExp(pattern, cjk ? 'g' : 'gi'), right);
    }
    return out;
  }

  // ── Vault name normalisation ─────────────────────────────────────────────
  // The obsidian:// URI wants the vault NAME, but users naturally paste the
  // vault's full filesystem path — which makes Obsidian error with "Vault
  // not found". If the value looks like a path, keep only the last segment.
  function normalizeVaultName(value) {
    return value.trim().replace(/[\\/]+$/, '').split(/[\\/]/).pop().trim();
  }

  // ── Vault folder listing (Obsidian export destination picker) ───────────
  // Input: webkitRelativePath strings from a directory picker pointed at the
  // vault root, e.g. "MyVault/Projects/Meeting Notes/2026-07/note.md".
  // Output: unique folder paths relative to the vault root ("Projects",
  // "Projects/Meeting Notes", ...), hidden folders (.obsidian, .trash)
  // excluded, sorted. The first path segment (the picked root) is stripped.
  function extractVaultFolders(relativePaths) {
    const folders = new Set();
    for (const p of relativePaths || []) {
      const segments = p.split('/').slice(1, -1); // drop picked-root prefix + filename
      if (segments.some(s => s.startsWith('.'))) continue;
      for (let i = 1; i <= segments.length; i++) {
        folders.add(segments.slice(0, i).join('/'));
      }
    }
    return [...folders].filter(Boolean).sort();
  }

  // ── Autosave quota safety (D1) ───────────────────────────────────────────
  // localStorage has a ~5MB quota; a long meeting's snapshot can exceed it.
  // Trim the OLDEST transcript segments (never summaries/Q&A/actions) until
  // the remaining tail fits the byte budget. CJK characters are multi-byte
  // in UTF-8, so the budget must be measured in bytes, not JS string length
  // (.length counts UTF-16 code units) — use TextEncoder, available in both
  // Node and browsers.
  function lengthInUtf8Bytes(str) {
    return new TextEncoder().encode(str).length;
  }

  // segments: array of segment strings (oldest first), in the same order
  // they'd be serialised. Returns { kept, trimmedCount } where `kept` is the
  // longest possible tail (oldest-first order preserved) whose total UTF-8
  // byte size is <= byteBudget, and `trimmedCount` is how many oldest
  // segments were dropped to get there. A single segment larger than the
  // whole budget is still kept (never truncated mid-segment) so restore
  // never sees a corrupted/partial transcript line.
  function trimSegmentsToByteBudget(segments, byteBudget) {
    if (!segments || !segments.length) return { kept: [], trimmedCount: 0 };
    let total = 0;
    let startIdx = segments.length;
    for (let i = segments.length - 1; i >= 0; i--) {
      const size = lengthInUtf8Bytes(segments[i]);
      if (total + size > byteBudget && startIdx !== segments.length) break;
      total += size;
      startIdx = i;
    }
    return { kept: segments.slice(startIdx), trimmedCount: startIdx };
  }

  // Trimming segments alone is not enough: the autosave snapshot ALSO stores
  // finalTranscript, an untrimmed running duplicate of the exact same
  // transcript text (see meeting.html — finalTranscript accumulates every
  // final segment's text in parallel with the segments array). If we trim
  // segments but leave finalTranscript untouched, the snapshot still doesn't
  // fit (the duplicate text alone can be ~half the snapshot), and the retry
  // write fails again silently. This whole-snapshot version:
  //   1. computes the byte cost of everything EXCEPT segments/finalTranscript
  //      (summaries, Q&A, actions, counters, etc.) — the "base" cost,
  //   2. drops the oldest segments (as trimSegmentsToByteBudget does) until
  //      segments + their duplicated text fit in the remaining budget,
  //   3. rebuilds finalTranscript from ONLY the kept segments, so the
  //      duplicate can never outlive the trim.
  // `snap.segments` here is the array of already-snapshotted segment objects
  // ({t,x,e,sp} — see snapSegment in meeting.html), oldest first.
  function trimSnapshotToByteBudget(snap, byteBudget) {
    const segments = snap.segments || [];
    const restNoSegments = Object.assign({}, snap, { segments: [], finalTranscript: '' });
    const baseBytes = lengthInUtf8Bytes(JSON.stringify(restNoSegments));
    const available = Math.max(0, byteBudget - baseBytes);

    let total = 0;
    let startIdx = segments.length;
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      const segJsonBytes = lengthInUtf8Bytes(JSON.stringify(seg));
      // finalTranscript will store this segment's text again (plus a join
      // space), so budget for both copies together.
      const textBytes = lengthInUtf8Bytes((seg && seg.x) || '') + 1;
      const size = segJsonBytes + textBytes;
      if (total + size > available && startIdx !== segments.length) break;
      total += size;
      startIdx = i;
    }
    const kept = segments.slice(startIdx);
    const trimmedCount = startIdx;
    const finalTranscript = kept.map(s => (s && s.x) || '').join(' ');

    return {
      snapshot: Object.assign({}, snap, { segments: kept, finalTranscript }),
      trimmedCount
    };
  }

  // ── Autosave restore hardening (D2) ─────────────────────────────────────
  // Snapshot schema versions this build understands. v1 predates the
  // sanitize-on-restore fix; v1 snapshots are still accepted (migrated) but
  // get sanitizeStoredHtml applied same as v2. Bump this when the shape of
  // snapshotState()'s output changes in a way that would break restore.
  const KNOWN_SNAPSHOT_VERSIONS = [1, 2];

  // Checks the snapshot is a plausible, restorable shape BEFORE any DOM is
  // touched — restoreFromAutosave must never clear panels and then throw
  // partway through destructuring fields off a malformed/corrupt snapshot.
  // Deliberately conservative: only checks presence/type of the fields
  // restoreFromAutosave actually reads, not a full deep schema.
  function validateAutosaveSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return false;
    if (!KNOWN_SNAPSHOT_VERSIONS.includes(snap.v)) return false;
    if (!Array.isArray(snap.segments)) return false;
    if (!Array.isArray(snap.summaries)) return false;
    if (!Array.isArray(snap.qas)) return false;
    if (snap.actions !== undefined && !Array.isArray(snap.actions)) return false;
    if (snap.exportLedger !== undefined && !Array.isArray(snap.exportLedger)) return false;
    if (!snap.counters || typeof snap.counters !== 'object') return false;
    if (!snap.obsidian || typeof snap.obsidian !== 'object') return false;
    return true;
  }

  // Sanitizes HTML fragments captured from summary/Q&A innerHTML before they
  // are re-injected into the page on restore. Scope: this defends the
  // stored-HTML ROUND TRIP (content this same app generated and saved to
  // localStorage) against corruption/tampering of that localStorage entry —
  // it is NOT a general-purpose HTML sanitizer for arbitrary hostile input.
  // Regex/string-based on purpose (no-deps constraint): strips
  // script/style/iframe/object/embed elements (open+content+close, and
  // self-closing forms), all on*="..." event-handler attributes, and
  // javascript: URLs in href/src attributes. Plain text (including CJK)
  // passes through unchanged.
  function sanitizeStoredHtml(html) {
    if (typeof html !== 'string') return '';
    let out = html;
    // Dangerous elements: drop the whole element including its content.
    out = out.replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    // Self-closing / unclosed forms of the same tags.
    out = out.replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, '');
    // on* event-handler attributes (onclick="...", onerror='...', onload=...).
    out = out.replace(/\son\w+\s*=\s*"(?:[^"\\]|\\.)*"/gi, '');
    out = out.replace(/\son\w+\s*=\s*'(?:[^'\\]|\\.)*'/gi, '');
    out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
    // javascript: URLs in href/src attributes.
    out = out.replace(/(\s(?:href|src)\s*=\s*)"(?:\s|&#x?0*9;|&#x?0*[aA];)*javascript:[^"]*"/gi, '$1"#"');
    out = out.replace(/(\s(?:href|src)\s*=\s*)'(?:\s|&#x?0*9;|&#x?0*[aA];)*javascript:[^']*'/gi, "$1'#'");
    return out;
  }

  // ── Config export/import envelope (E3) ──────────────────────────────────
  // Save Config can export either a plain settings object or, when it holds
  // API keys, a passphrase-encrypted envelope. These helpers only build/parse/
  // validate the JSON shape — meeting.html owns the actual WebCrypto calls
  // (PBKDF2 + AES-GCM), which can't run in the Node eval harness.
  const CONFIG_ENC_VERSION = 'v1';

  // True if any of `secretFields` is present in `config` with a non-empty
  // (after trimming) string value. Used to decide whether Save Config should
  // offer/require the encryption choice.
  function configHasSecrets(config, secretFields) {
    if (!config || typeof config !== 'object') return false;
    return secretFields.some(f => typeof config[f] === 'string' && config[f].trim().length > 0);
  }

  // Builds the JSON envelope written to disk for an encrypted export. Inputs
  // are already base64-encoded strings produced by the caller's crypto step.
  function buildConfigEnvelope(saltB64, ivB64, dataB64) {
    return { enc: CONFIG_ENC_VERSION, salt: saltB64, iv: ivB64, data: dataB64 };
  }

  // True if the parsed JSON looks like one of our encrypted envelopes (as
  // opposed to a plain config object saved before this feature existed).
  function isEncryptedConfigEnvelope(obj) {
    return !!obj && typeof obj === 'object' && obj.enc === CONFIG_ENC_VERSION;
  }

  // Validates an encrypted envelope's shape and returns the three fields the
  // caller needs to feed WebCrypto, or null if the envelope is malformed
  // (missing/non-string fields) — never throws.
  function parseConfigEnvelope(obj) {
    if (!isEncryptedConfigEnvelope(obj)) return null;
    const { salt, iv, data } = obj;
    if (typeof salt !== 'string' || !salt || typeof iv !== 'string' || !iv ||
        typeof data !== 'string' || !data) return null;
    return { salt, iv, data };
  }

  // ── Rendering helpers ────────────────────────────────────────────────────
  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Renders the model's "- bullet" / "**highlight**" markdown into safe HTML.
  function formatSummaryHtml(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let html = '';
    let inList = false;
    for (const line of lines) {
      const isBullet = /^[-*•]\s+/.test(line);
      const raw = line.replace(/^[-*•]\s+/, '');
      const content = escapeHtml(raw).replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>');
      if (isBullet) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${content}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += `<p>${content}</p>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80);
  }

  // ── Local (not UTC) date formatting (B1) ────────────────────────────────
  // Date#toISOString() always renders the UTC date, so for users east of
  // UTC (e.g. SGT, UTC+8) any meeting before 08:00 local gets stamped with
  // yesterday's date in the note title/frontmatter/folder/heading. Use the
  // Date object's local getters instead. Takes the Date as a parameter so
  // it's testable without mocking the clock.
  function localDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ── BytePlus ASR binary frame protocol (F1) ─────────────────────────────
  // Pure byte-level build/parse for the gzip-framed binary protocol used to
  // talk to BytePlus Seed-ASR streaming. Mechanical extraction from
  // meeting.html's buildFrame/handleAsrFrame — no semantic changes; this
  // talks to a live wire protocol. gzip/gunzip stay in meeting.html
  // (CompressionStream/DecompressionStream are browser-only); parseAsrFrame
  // returns the raw (still-possibly-gzipped) payload bytes plus enough
  // metadata for the caller to decide whether/how to decompress and decode.
  const ASR_MSG_FULL_CLIENT_REQUEST = 0b0001;
  const ASR_MSG_AUDIO_ONLY_REQUEST = 0b0010;
  const ASR_MSG_FULL_SERVER_RESPONSE = 0b1001;
  const ASR_MSG_ERROR_RESPONSE = 0b1111;
  const ASR_SER_NONE = 0b0000, ASR_SER_JSON = 0b0001;
  const ASR_COMP_NONE = 0b0000, ASR_COMP_GZIP = 0b0001;

  // Builds one binary frame per the BytePlus header layout: 4-byte header
  // (version/header-size, message-type/flags, serialization/compression,
  // reserved) followed by a big-endian uint32 payload length and the
  // payload bytes themselves.
  function buildAsrFrame(messageType, flags, serialization, compression, payload) {
    const out = new Uint8Array(8 + payload.length);
    out[0] = (0x1 << 4) | 0x1;                       // version 1, header size 1 (4 bytes)
    out[1] = (messageType << 4) | flags;
    out[2] = (serialization << 4) | compression;
    out[3] = 0x00;                                   // reserved
    new DataView(out.buffer).setUint32(4, payload.length, false);
    out.set(payload, 8);
    return out;
  }

  // Parses one binary frame received from BytePlus. `buf` is anything
  // DataView accepts (ArrayBuffer or a typed-array's .buffer). Never
  // throws for malformed/truncated input — callers on a live socket must
  // not have a single bad frame kill the connection (see C1) — instead
  // returns { type: 'malformed', error }.
  //
  // Return shapes:
  //   { type: 'error', errorCode, msg }                      — MSG_ERROR_RESPONSE
  //   { type: 'response', serialization, compression,
  //     needsGunzip, isJson, payloadBytes }                  — MSG_FULL_SERVER_RESPONSE
  //   { type: 'ignored', messageType }                       — any other message type
  //   { type: 'malformed', error }                           — truncated/corrupt buffer
  function parseAsrFrame(buf) {
    try {
      const view = new DataView(buf);
      const headerBytes = (view.getUint8(0) & 0x0f) * 4;
      const messageType = view.getUint8(1) >> 4;
      const serialization = view.getUint8(2) >> 4;
      const compression = view.getUint8(2) & 0x0f;
      let offset = headerBytes;

      if (messageType === ASR_MSG_ERROR_RESPONSE) {
        const errorCode = view.getUint32(offset, false); offset += 4;
        const msgSize = view.getUint32(offset, false); offset += 4;
        const msg = new TextDecoder().decode(new Uint8Array(buf, offset, msgSize));
        return { type: 'error', errorCode, msg };
      }

      if (messageType !== ASR_MSG_FULL_SERVER_RESPONSE) {
        return { type: 'ignored', messageType };
      }

      const flags = view.getUint8(1) & 0x0f;
      if (flags & 0b0001) offset += 4; // sequence field present only when this bit is set
      const payloadSize = view.getUint32(offset, false); offset += 4;
      const payloadBytes = new Uint8Array(buf, offset, payloadSize);

      return {
        type: 'response',
        serialization,
        compression,
        needsGunzip: compression === ASR_COMP_GZIP,
        isJson: serialization === ASR_SER_JSON,
        payloadBytes,
      };
    } catch (err) {
      return { type: 'malformed', error: err };
    }
  }

  // ── ASR connection lifecycle state machine (S1) ─────────────────────────
  // Consolidates the previously-scattered isRecording/asrReady/asrReconnecting
  // bookkeeping into one explicit state field with a validated transition
  // table. Pure and side-effect free — meeting.html owns the actual mutable
  // state and derives its legacy booleans from it; this module only decides
  // whether a requested transition is legal.
  const ASR_STATES = ['idle', 'starting', 'recording', 'reconnecting', 'stopping'];
  const ASR_TRANSITIONS = {
    idle: ['starting'],
    starting: ['recording', 'idle'],
    recording: ['stopping', 'reconnecting'],
    reconnecting: ['recording', 'stopping'],
    stopping: ['idle'],
  };

  function isValidAsrTransition(from, to) {
    return !!(ASR_TRANSITIONS[from] && ASR_TRANSITIONS[from].includes(to));
  }

  // Returns { ok, state }: the resulting state and whether the requested
  // transition was accepted. Illegal transitions are rejected (state left
  // unchanged) — never throws; the caller decides how to log the rejection.
  function nextAsrState(from, to) {
    if (!isValidAsrTransition(from, to)) return { ok: false, state: from };
    return { ok: true, state: to };
  }

  // ── Diagnostics panel (E4) ──────────────────────────────────────────────
  // Pure formatter: a plain state snapshot (numbers/strings/booleans only —
  // never API keys or transcript content) -> a human-readable plaintext dump
  // for the "Copy diagnostics" button. Missing fields render as 'n/a' rather
  // than throwing, so a partially-populated snapshot (e.g. before recording
  // starts) still produces a usable dump.
  function formatDiagnosticsDump(s) {
    s = s || {};
    const na = (v) => (v === undefined || v === null || v === '') ? 'n/a' : v;
    const lines = [
      'MeetingMind diagnostics — ' + na(s.timestamp),
      '',
      '[ASR]',
      `  state: ${na(s.asrState)}`,
      `  socket readyState: ${na(s.socketReadyState)}`,
      `  bufferedAmount: ${na(s.bufferedAmount)}`,
      `  seconds since last ASR frame: ${na(s.secondsSinceLastFrame)}`,
      `  reconnect count: ${na(s.reconnectCount)}`,
      '',
      '[Audio]',
      `  capture mode: ${na(s.captureMode)}`,
      `  mic track: ${na(s.micTrackState)}`,
      `  system track: ${na(s.systemTrackState)}`,
      `  extra tracks live/dead: ${na(s.extraTracksLive)}/${na(s.extraTracksDead)}`,
      `  audioCtx.state: ${na(s.audioCtxState)}`,
      '',
      '[LLM]',
      `  summary calls/failures: ${na(s.summaryCalls)}/${na(s.summaryFailures)}`,
      `  question calls/failures: ${na(s.questionCalls)}/${na(s.questionFailures)}`,
      `  action calls/failures: ${na(s.actionCalls)}/${na(s.actionFailures)}`,
      `  summaryQueue: ${na(s.summaryQueueState)}`,
      '',
      '[Storage]',
      `  last autosave: ${na(s.lastAutosaveResult)}`,
      `  snapshot bytes / budget: ${na(s.snapshotBytes)} / ${na(s.snapshotBudget)}`,
      `  export ledger chunks: ${na(s.exportLedgerChunks)}`,
    ];
    return lines.join('\n');
  }

  // Buffers partial SSE lines across chunk boundaries. When a data: line's
  // trailing \n hasn't arrived yet, splitting eagerly would feed a truncated
  // fragment to JSON.parse, which throws silently and loses that chunk of the
  // response forever. Holding back the last element until a newline confirms it
  // is complete prevents this silent data loss.
  function parseSseChunks(residual, newText) {
    var combined = residual + newText;
    var parts = combined.split('\n');
    // Last element has no guaranteed trailing newline — hold it as residual
    var newResidual = parts.pop();
    return { completeLines: parts, residual: newResidual };
  }

  // ── Clear-confirm helper ─────────────────────────────────────────────────
  // clearAll() used to wipe everything unconditionally. Pure decision logic
  // (what to say, and whether to say anything at all) lives here so it's
  // testable without a DOM; the confirm() call itself stays in meeting.html.
  function shouldConfirmClear(segN, sumN) {
    if (segN === 0 && sumN === 0) return null;
    return (
      'This meeting has ' + segN + ' segment(s) and ' + sumN +
      ' summary block(s) not yet saved to your vault. Clear anyway?'
    );
  }

  // ── Export tri-state decision ───────────────────────────────────────────
  // A bare boolean return from the export path conflated "nothing left to
  // export" with "export was blocked/declined" — both looked like `false` to
  // addToObsidian(), which then offered to destructively re-write (and wipe
  // the export ledger for) a meeting that was never actually exported. This
  // makes the three outcomes explicit and checkable.
  function determineExportStatus({ wroteContent, blocked, blockedReason }) {
    if (wroteContent) return { status: 'exported' };
    if (blocked) return { status: 'blocked', reason: blockedReason || 'Export was blocked or declined' };
    return { status: 'nothing-pending' };
  }

  // ── Full-meeting source selection (D37) ─────────────────────────────────
  // The capped meetingContext is right for the cheap rolling summary prompt,
  // but "whole meeting" reads (final synthesis, Q&A, role-question
  // suggestions) need the uncapped consolidated source instead, falling back
  // to the raw transcript only while no consolidated content exists yet.
  function pickFullMeetingSource(consolidated, transcript) {
    const c = (consolidated || '').trim();
    if (c) return c;
    return (transcript || '').trim();
  }

  // Output language is a user choice, not derived from the meeting's speech.
  // Default to English so an unknown/missing selection never silently drops
  // language pinning (the pre-Z4 behavior this setting replaces).
  function outputLanguageInstruction(selection) {
    if (selection === 'zh') {
      return 'Reply in Chinese (中文), even if the meeting itself is in another language or code-switches. ';
    }
    return 'Reply in English, even if the meeting itself is in another language or code-switches. ';
  }

  // ── Rebuild transcript accumulators from live DOM (A6) ───────────────────
  // Rebuild a single context string from live DOM segment texts, matching the
  // join separator that live transcript ingestion uses (verified against the
  // `finalTranscript += ' ' + text` call site) — DOM-as-source-of-truth
  // (D33/V3 precedent) so corrections/deletions propagate to the
  // finalTranscript/meetingContext accumulators that LLM prompts actually read.
  // Live ingestion's `finalTranscript += ' ' + text` starting from an empty
  // string technically prepends a space before the very first segment, while
  // `segments.join(' ')` does not — but every consumer of the rebuilt string
  // calls `.trim()` on it, so this difference is inconsequential, not a bug.
  function rebuildContextFromSegments(segments) {
    return segments.join(' ');
  }

  // ── Move the final-synthesis block to the top of the note (A4) ──────────
  // The exported note is chronological "## Segment N" blocks, and the
  // 4-section final-synthesis record (TL;DR/Decisions/Action Items/Open
  // Questions) is just another block inside the LAST one — buried at the
  // bottom of a long meeting's note. This moves it to the top on a full
  // rewrite, WITHOUT trusting that move to be safe on faith: `synthesisText`
  // must occur in `fullText` EXACTLY once (not zero — nothing exported yet
  // to move; not more than once — ambiguous which occurrence is the real
  // one, don't guess), and every byte of the file other than the moved block
  // must survive the rewrite completely unchanged. Only meaningful in
  // direct-vault-write mode (see meeting.html) — the obsidian://-URI path
  // has no read access to the file at all, so it can't be attempted there.
  //
  // Returns `{ ok: true, restructured }` or `{ ok: false, reason }` — the
  // caller must NEVER write `fullText` back to disk on `ok: false`; the file
  // is safest left exactly as it already was.
  function restructureFinalSummaryToTop(fullText, synthesisText) {
    if (!fullText || !synthesisText) return { ok: false, reason: 'missing fullText or synthesisText' };

    const occurrences = fullText.split(synthesisText).length - 1;
    if (occurrences !== 1) {
      return { ok: false, reason: `expected the synthesis block to occur exactly once in the file, found ${occurrences}` };
    }

    // Exactly one occurrence was just confirmed above, so a global
    // split/join here removes precisely that one instance — not "all
    // occurrences" in the sense that would be unsafe with more than one.
    const withoutSynthesis = fullText.split(synthesisText).join('');

    const segmentIdx = withoutSynthesis.indexOf('## Segment ');
    if (segmentIdx === -1) {
      return { ok: false, reason: 'could not locate the chronological "## Segment" structure' };
    }

    const header = withoutSynthesis.slice(0, segmentIdx);
    const chronologicalTail = withoutSynthesis.slice(segmentIdx);
    const movedSection = `## Final Summary\n${synthesisText}\n\n`;
    const restructured = header + movedSection + chronologicalTail;

    // Tripwire: reconstruct each part straight back out of `restructured`
    // and require it to match byte-for-byte. This isn't redundant with the
    // construction above — it's an independent assertion that catches a
    // future refactor of this function breaking its own invariant, which a
    // silent "trust the concatenation" would not.
    const rebuiltHeader = restructured.slice(0, header.length);
    const rebuiltMoved = restructured.slice(header.length, header.length + movedSection.length);
    const rebuiltTail = restructured.slice(header.length + movedSection.length);
    if (rebuiltHeader !== header || rebuiltMoved !== movedSection || rebuiltTail !== chronologicalTail) {
      return { ok: false, reason: 'tripwire failed: reconstructed content does not match the expected structure' };
    }

    return { ok: true, restructured };
  }

  // ── Splice independent single-line replacements into exported text ──────
  // Used by G4 to retrofit post-export diarization speaker labels into an
  // already-exported note's transcript lines. Unlike
  // restructureFinalSummaryToTop (one all-or-nothing structural move), this
  // touches N independent lines, so it is NOT all-or-nothing: each
  // replacement is checked to occur EXACTLY once before being applied (0 =
  // not found, 2+ = ambiguous — never guess which occurrence), and a
  // skipped/unmatched line just means that one line stays as originally
  // exported, not a reason to also lose the others that matched cleanly.
  function spliceLinesIntoText(fullText, replacements) {
    let text = fullText || '';
    let appliedCount = 0, skippedCount = 0;
    for (const { oldLine, newLine } of (replacements || [])) {
      if (!oldLine || oldLine === newLine) { skippedCount++; continue; }
      const occurrences = text.split(oldLine).length - 1;
      if (occurrences !== 1) { skippedCount++; continue; }
      text = text.split(oldLine).join(newLine);
      appliedCount++;
    }
    return { restructured: text, appliedCount, skippedCount };
  }

  // ── Markdown -> RTF (G5, no-Obsidian .doc export) ────────────────────────
  // RTF is 7-bit ASCII; every character outside it (all of CJK, full-width
  // punctuation, curly quotes, emoji) MUST go through a \uN escape or Word
  // renders garbage instead of the real text. \u takes a SIGNED 16-bit value,
  // so code units >= 0x8000 are represented as (code - 0x10000) — RTF has no
  // native concept of UTF-16 surrogate pairs, so each UTF-16 code unit is
  // escaped individually (the long-established convention every RTF reader,
  // including Word, actually implements) rather than combining surrogates
  // into one Unicode code point first.
  function rtfEscapeChar(code) {
    if (code === 0x5c) return '\\\\';
    if (code === 0x7b) return '\\{';
    if (code === 0x7d) return '\\}';
    if (code < 0x80) return String.fromCharCode(code);
    var signed = code >= 0x8000 ? code - 0x10000 : code;
    return '\\u' + signed + '?';
  }

  function rtfEscapeText(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) out += rtfEscapeChar(text.charCodeAt(i));
    return out;
  }

  // Only markdown grammar the app actually produces (see formatSummaryHtml):
  // "- "/"* "/"• " bullets and "**bold**" spans. buildObsidianChunkMarkdown
  // additionally adds one literal "# Title" line and one "## Segment N — time"
  // line per chunk of its own.
  function rtfInline(text) {
    var parts = text.split(/\*\*(.+?)\*\*/); // odd indices are the bold spans
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var seg = rtfEscapeText(parts[i]);
      out += (i % 2 === 1) ? ('{\\b ' + seg + '}') : seg;
    }
    return out;
  }

  // ── WAV encoding (G4, post-meeting speaker diarization) ──────────────────
  // Wraps raw PCM16 mono samples (already little-endian, the shape
  // floatTo16BitPCM already produces) in a minimal 44-byte canonical WAV
  // header — no compression, no external library. Byte layout per the
  // canonical RIFF/WAVE spec; verified byte-for-byte in evals rather than
  // just "does it parse", since a diarization API rejecting a malformed file
  // silently wastes the one post-meeting attempt.
  function buildWavHeader(sampleRate, numChannels, bitsPerSample, dataLength) {
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const buf = new ArrayBuffer(44);
    const view = new DataView(buf);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);       // PCM fmt chunk size
    view.setUint16(20, 1, true);        // audio format 1 = PCM (uncompressed)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataLength, true);
    return new Uint8Array(buf);
  }

  function buildWavFile(sampleRate, pcm16Bytes) {
    const header = buildWavHeader(sampleRate, 1, 16, pcm16Bytes.length);
    const out = new Uint8Array(header.length + pcm16Bytes.length);
    out.set(header, 0);
    out.set(pcm16Bytes, header.length);
    return out;
  }

  function markdownToRtf(markdown) {
    var body = (markdown || '');
    // buildObsidianChunkMarkdown's YAML frontmatter is Obsidian-specific
    // metadata with no Word equivalent — drop it, the "# Title" line right
    // after it already carries the meeting name into the document.
    var fm = body.match(/^---\n[\s\S]*?\n---\n/);
    if (fm) body = body.slice(fm[0].length);

    var lines = body.replace(/\r\n/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === '') { out.push('\\par'); continue; }
      var h2 = line.match(/^##\s+(.*)$/); // checked first for clarity — "^#\s+" below never actually matches "## ..." (no whitespace right after the first #), but this keeps the more-specific pattern first regardless
      var h1 = line.match(/^#\s+(.*)$/);
      var bullet = line.match(/^[-*•]\s+(.*)$/);
      if (h2) out.push('{\\b\\fs28 ' + rtfInline(h2[1]) + '}\\par');
      else if (h1) out.push('{\\b\\fs36 ' + rtfInline(h1[1]) + '}\\par');
      else if (bullet) out.push('\\bullet\\tab ' + rtfInline(bullet[1]) + '\\par');
      else out.push(rtfInline(line) + '\\par');
    }
    return '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22\n' + out.join('\n') + '\n}';
  }

  return {
    parseSpeakerSplit,
    dominantLanguage,
    languageInstruction,
    outputLanguageInstruction,
    applyCorrections,
    normalizeVaultName,
    extractVaultFolders,
    extractQuestions,
    questionKey,
    parseSuggestedQuestion,
    parseActionList,
    actionKey,
    countWords,
    tokenizeQuery,
    searchVault,
    escapeHtml,
    formatSummaryHtml,
    sanitizeFilename,
    localDateStr,
    lengthInUtf8Bytes,
    trimSegmentsToByteBudget,
    trimSnapshotToByteBudget,
    validateAutosaveSnapshot,
    sanitizeStoredHtml,
    configHasSecrets,
    buildConfigEnvelope,
    isEncryptedConfigEnvelope,
    parseConfigEnvelope,
    ASR_MSG_FULL_CLIENT_REQUEST,
    ASR_MSG_AUDIO_ONLY_REQUEST,
    ASR_MSG_FULL_SERVER_RESPONSE,
    ASR_MSG_ERROR_RESPONSE,
    ASR_SER_NONE,
    ASR_SER_JSON,
    ASR_COMP_NONE,
    ASR_COMP_GZIP,
    buildAsrFrame,
    parseAsrFrame,
    ASR_STATES,
    ASR_TRANSITIONS,
    isValidAsrTransition,
    nextAsrState,
    parseSseChunks,
    formatDiagnosticsDump,
    shouldConfirmClear,
    determineExportStatus,
    pickFullMeetingSource,
    rebuildContextFromSegments,
    markdownToRtf,
    buildWavFile,
    restructureFinalSummaryToTop,
    spliceLinesIntoText,
  };
});
