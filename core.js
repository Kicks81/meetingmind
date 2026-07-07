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

  // KNOWN BUG (backlog Z3): tokenizer only keeps [a-z0-9'], so CJK query
  // terms are dropped entirely and Chinese questions match no notes.
  function tokenizeQuery(query) {
    return [...new Set(query.toLowerCase().match(/[a-z0-9']+/g) || [])]
      .filter(t => t.length > 2 && !STOPWORDS.has(t));
  }

  // notes: [{ path, content }] → top-N [{ path, excerpt }]
  function searchVault(query, notes, topN = 4) {
    if (!notes || !notes.length) return [];
    const terms = tokenizeQuery(query);
    if (!terms.length) return [];

    const scored = notes.map(note => {
      const lower = note.content.toLowerCase();
      let score = 0;
      let firstMatchIdx = -1;
      for (const term of terms) {
        const idx = lower.indexOf(term);
        if (idx === -1) continue;
        score++; // one point per distinct matched term
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

  return {
    normalizeVaultName,
    extractVaultFolders,
    extractQuestions,
    questionKey,
    countWords,
    tokenizeQuery,
    searchVault,
    escapeHtml,
    formatSummaryHtml,
    sanitizeFilename,
  };
});
