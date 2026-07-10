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
  function questionKey(question) {
    return question.toLowerCase().replace(/\s+/g, ' ');
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

  return {
    parseSpeakerSplit,
    dominantLanguage,
    languageInstruction,
    applyCorrections,
    normalizeVaultName,
    extractVaultFolders,
    extractQuestions,
    questionKey,
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
  };
});
