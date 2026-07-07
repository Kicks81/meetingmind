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
  // KNOWN BUG (backlog Z1): only matches ASCII "?", so Chinese questions
  // ending in full-width "？" are never detected.
  const QUESTION_PATTERN = /[^.!?]*\?/g;

  // Returns candidate question strings found in a chunk of transcript text.
  // Dedupe against previously-seen questions is the caller's job.
  function extractQuestions(text) {
    const matches = text.match(QUESTION_PATTERN) || [];
    return matches.map(q => q.trim()).filter(q => q.length >= 10);
  }

  // Normalised form used to dedupe repeated questions.
  function questionKey(question) {
    return question.toLowerCase().replace(/\s+/g, ' ');
  }

  // ── Word counting (summary triggers, footer counter) ───────────────────
  // KNOWN BUG (backlog Z2): whitespace splitting counts an entire Chinese
  // utterance as one word, so word-threshold triggers never fire in zh.
  function countWords(text) {
    return text.trim().split(/\s+/).filter(Boolean).length;
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
