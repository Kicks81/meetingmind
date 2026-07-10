// MeetingMind eval harness — regression checks for the pure logic in core.js.
// Run: node evals/run.mjs   (exit code 0 = all pass)
//
// Fixtures accumulate: once added, never removed (IMPROVEMENT_LOOP.md).
// Known bugs (backlog Z1–Z3) are asserted with expectFail — they document the
// bug and will FLIP to a hard failure once fixed, forcing the fixture to be
// promoted to a normal expectation in the same change.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const core = require('../core.js');

let passed = 0, failed = 0, knownBugs = 0;
const failures = [];

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; }
  else { failed++; failures.push({ name, actual, expected }); }
}

// Documents a known bug: passes while the bug exists, fails loudly once the
// behavior is fixed (so the fixture must then be promoted via `check`).
function expectFail(name, actual, desiredOnceFixed) {
  const fixedAlready = JSON.stringify(actual) === JSON.stringify(desiredOnceFixed);
  if (fixedAlready) {
    failed++;
    failures.push({ name: `${name} — BUG APPEARS FIXED: promote this expectFail to check()`, actual, expected: desiredOnceFixed });
  } else {
    knownBugs++;
  }
}

// ── extractQuestions ───────────────────────────────────────────────────────
check('en: detects a question',
  core.extractQuestions('We shipped the release. Who owns the AFO integration?'),
  ['Who owns the AFO integration?']);

check('en: short questions (<10 chars) are skipped',
  core.extractQuestions('Really? I did not know that.'),
  []);

check('en: multiple questions in one utterance',
  core.extractQuestions('What is the budget? And who approves it after review?'),
  ['What is the budget?', 'And who approves it after review?']);

check('en: no questions → empty',
  core.extractQuestions('Let us move on to the next agenda item.'),
  []);

// Z1 (fixed) — Chinese full-width ？ questions are detected
check('zh: full-width ？ question detected [Z1]',
  core.extractQuestions('我们下一步怎么安排这个项目的预算？'),
  ['我们下一步怎么安排这个项目的预算？']);

check('mixed: zh question about an en term detected [Z1]',
  core.extractQuestions('关于AFO integration，现在谁负责跟进？'),
  ['关于AFO integration，现在谁负责跟进？']);

check('zh: preceding 。statement does not bleed into the question [Z1]',
  core.extractQuestions('预算已经批了。下一步谁来跟进？'),
  ['下一步谁来跟进？']);

check('zh: short-but-real question passes the CJK length floor [Z1]',
  core.extractQuestions('预算是多少？'),
  ['预算是多少？']);

check('zh: statements without ？ are not flagged [Z1]',
  core.extractQuestions('我们今天讨论预算。大家都同意了！'),
  []);

check('mixed: ASCII ? after zh text still detected',
  core.extractQuestions('这个很重要 — who owns the AFO integration?'),
  ['这个很重要 — who owns the AFO integration?']);

// ── questionKey ────────────────────────────────────────────────────────────
check('dedupe key normalises case and whitespace',
  core.questionKey('Who   OWNS the AFO  integration?'),
  'who owns the afo integration?');

// ── parseActionList / actionKey (U11 action items) ─────────────────────────
check('en: parses bulleted action list',
  core.parseActionList('- I will send the report by Friday\n- Please follow up with the client'),
  ['I will send the report by Friday', 'Please follow up with the client']);

check('en: NONE reply yields no actions',
  core.parseActionList('NONE'),
  []);

check('en: blank lines and stray NONE lines are dropped',
  core.parseActionList('- Send the invoice\n\nNONE\n- Call back tomorrow'),
  ['Send the invoice', 'Call back tomorrow']);

check('en: short fragments below the length floor are dropped',
  core.parseActionList('- ok\n- Send the invoice by Monday'),
  ['Send the invoice by Monday']);

check('zh: parses bulleted action list',
  core.parseActionList('- 请你跟进一下这个客户\n- 我明天发给你报告'),
  ['请你跟进一下这个客户', '我明天发给你报告']);

check('zh: short-but-real action passes the CJK length floor',
  core.parseActionList('- 明天发货'),
  ['明天发货']);

check('mixed: zh action referencing an en term',
  core.parseActionList('- 我会跟进AFO integration的进度'),
  ['我会跟进AFO integration的进度']);

check('actionKey: normalises case and whitespace',
  core.actionKey('  Send   the REPORT by Friday '),
  'send the report by friday');

check('actionKey: zh action key is case/whitespace normalised (no-op on CJK)',
  core.actionKey('请你跟进一下这个客户'),
  '请你跟进一下这个客户');

// ── countWords ─────────────────────────────────────────────────────────────
check('en: counts whitespace-separated words',
  core.countWords('  the quick brown fox jumps  '),
  5);

check('empty string counts as 0',
  core.countWords('   '),
  0);

// Z2 (fixed) — CJK characters count toward word totals
check('zh: 15-char sentence counts as ~8 words, not 1 [Z2]',
  core.countWords('我们今天讨论一下项目预算的问题'),
  8);

check('mixed: zh chars and latin words both contribute [Z2]',
  core.countWords('我们讨论一下 the AFO budget 的问题') >= 6,
  true);

check('zh: punctuation does not inflate the count [Z2]',
  core.countWords('好的。！？'),
  1);

check('en: count unchanged by the CJK-aware rewrite [Z2]',
  core.countWords('the quick brown fox jumps'),
  5);

// ── searchVault / tokenizeQuery ────────────────────────────────────────────
const NOTES = [
  { path: 'projects/afo.md', content: 'The AFO integration is owned by Swetha. Kickoff was in June.' },
  { path: 'people/kai.md', content: 'Kai leads the transformation office and reports monthly.' },
  { path: 'zh/预算.md', content: '项目预算由财务部审批，每季度更新一次。负责人是陈伟。' },
];

check('en: finds the right note',
  core.searchVault('who owns the AFO integration?', NOTES).map(r => r.path),
  ['projects/afo.md']);

check('en: stopword-only query returns nothing',
  core.searchVault('what is it for?', NOTES),
  []);

check('en: no match returns empty',
  core.searchVault('quarterly kubernetes migration?', NOTES),
  []);

// Z3 (fixed) — CJK queries tokenize as bigrams and match zh notes
check('zh: query matches the zh note [Z3]',
  core.searchVault('项目预算谁负责审批？', NOTES).map(r => r.path),
  ['zh/预算.md']);

check('zh: tokenizer keeps CJK terms [Z3]',
  core.tokenizeQuery('项目预算谁负责？').length > 0,
  true);

check('zh: function-char bigrams are filtered out [Z3]',
  core.tokenizeQuery('这是谁的？'),
  []);

check('zh: single CJK char run kept as a term [Z3]',
  core.tokenizeQuery('查 budget 表'),
  ['budget', '查', '表']);

check('mixed: latin term outweighs incidental bigram matches [Z3]',
  core.searchVault('AFO的负责人是谁？', NOTES)[0].path,
  'projects/afo.md');

check('mixed: latin term in a zh question still matches, ranked first',
  core.searchVault('AFO的负责人是谁？', NOTES).map(r => r.path),
  ['projects/afo.md', 'zh/预算.md']); // zh note now also matches via 负责 bigram (Z3) — AFO note must stay ranked first

// ── parseSpeakerSplit (speaker-turn splitting) ─────────────────────────────
check('speaker-split: UNCHANGED reply returns null',
  core.parseSpeakerSplit('UNCHANGED', 'some utterance text here'),
  null);

check('speaker-split: valid two-turn split parses',
  core.parseSpeakerSplit('SPLIT\nA: I think we should ship Friday\nB: I disagree, we need more testing', 'I think we should ship Friday I disagree, we need more testing'),
  [{ speaker: 'A', text: 'I think we should ship Friday' }, { speaker: 'B', text: 'I disagree, we need more testing' }]);

check('speaker-split: three alternating turns parses',
  core.parseSpeakerSplit('SPLIT\nA: 预算批准了吗\nB: 批准了\nA: 太好了', '预算批准了吗批准了太好了'),
  [{ speaker: 'A', text: '预算批准了吗' }, { speaker: 'B', text: '批准了' }, { speaker: 'A', text: '太好了' }]);

check('speaker-split: single-line SPLIT (no real second turn) rejected',
  core.parseSpeakerSplit('SPLIT\nA: just one turn here', 'just one turn here'),
  null);

check('speaker-split: malformed line invalidates the whole reply',
  core.parseSpeakerSplit('SPLIT\nA: hello there\nsomething without a speaker prefix', 'hello there something without a speaker prefix'),
  null);

check('speaker-split: reconstructed text far shorter than original is rejected (model summarised)',
  core.parseSpeakerSplit('SPLIT\nA: hi\nB: bye', 'a very long original utterance that goes on for quite a while about the budget and timeline'),
  null);

check('speaker-split: reconstructed text far longer than original is rejected',
  core.parseSpeakerSplit('SPLIT\nA: hi there this is way more text than was ever said originally\nB: and even more padding text appended here too', 'hi there'),
  null);

check('speaker-split: empty/garbage reply returns null',
  core.parseSpeakerSplit('', 'some text'),
  null);

check('speaker-split: only speaker letters A/B accepted, C rejected as malformed',
  core.parseSpeakerSplit('SPLIT\nA: hello\nC: world', 'hello world'),
  null);

// ── dominantLanguage / languageInstruction (Z4) ────────────────────────────
check('lang: pure zh classified zh',
  core.dominantLanguage('我们今天讨论项目预算的安排。'),
  'zh');

check('lang: pure en classified en',
  core.dominantLanguage('Let us review the budget for next quarter.'),
  'en');

check('lang: heavy code-switching classified mixed',
  core.dominantLanguage('这个sprint的retro我们讨论一下deployment的问题'),
  'mixed');

check('lang: zh with a few en terms still zh',
  core.dominantLanguage('我们讨论一下AFO项目的预算和时间表，还有人员的安排问题'),
  'zh');

check('lang: empty/neutral text defaults to en',
  core.dominantLanguage('123 456!'),
  'en');

check('lang: instruction exists for every class',
  ['zh', 'en', 'mixed'].every(l => {
    const samples = { zh: '我们讨论预算问题啊', en: 'discuss the budget', mixed: '讨论budget的roadmap计划' };
    return typeof core.languageInstruction(samples[l]) === 'string' && core.languageInstruction(samples[l]).length > 0;
  }),
  true);

// ── applyCorrections (ASR correction dictionary) ───────────────────────────
const DICT = [
  { wrong: 'chata chataly', right: 'Swetha' },
  { wrong: 'chata', right: 'Swetha' },
  { wrong: '澳福', right: 'AFO' },
  { wrong: 'in corp', right: 'InCorp' },
];

check('en: case-insensitive whole-word correction',
  core.applyCorrections('I spoke to Chata about the rollout.', DICT),
  'I spoke to Swetha about the rollout.');

check('en: longest wrong-term wins over its overlapping prefix',
  core.applyCorrections('chata chataly will present next week', DICT),
  'Swetha will present next week');

check('en: word boundary protects substrings inside other words',
  core.applyCorrections('the chatarooms are busy', DICT),
  'the chatarooms are busy');

check('zh: CJK term corrected as substring (no word boundaries)',
  core.applyCorrections('我们明天和澳福团队开会。', DICT),
  '我们明天和AFO团队开会。');

check('mixed: multiple corrections in one utterance',
  core.applyCorrections('chata说in corp的澳福项目下周启动', DICT),
  'Swetha说InCorp的AFO项目下周启动');

check('corrections: empty dictionary is a no-op',
  core.applyCorrections('nothing changes here', []),
  'nothing changes here');

check('corrections: regex special chars in wrong term are literal',
  core.applyCorrections('the a.f.o. team met', [{ wrong: 'a.f.o.', right: 'AFO' }]),
  'the AFO team met');

// ── normalizeVaultName ─────────────────────────────────────────────────────
check('vault: plain name passes through',
  core.normalizeVaultName('Chee Kuang x incorp'),
  'Chee Kuang x incorp');

check('vault: windows path reduced to vault name',
  core.normalizeVaultName('C:\\Users\\CheeKuangTan\\obsidian\\Chee Kuang x incorp'),
  'Chee Kuang x incorp');

check('vault: forward-slash path and trailing slash handled',
  core.normalizeVaultName('/home/user/obsidian/Chee Kuang x incorp/'),
  'Chee Kuang x incorp');

check('vault: whitespace trimmed',
  core.normalizeVaultName('  Chee Kuang x incorp  '),
  'Chee Kuang x incorp');

// ── extractVaultFolders (Z2.5 folder picker) ───────────────────────────────
check('folders: strips vault root, includes ancestors, sorts, dedupes',
  core.extractVaultFolders([
    'MyVault/Projects/Meeting Notes/2026-07/a.md',
    'MyVault/Projects/Meeting Notes/2026-07/b.md',
    'MyVault/Daily/2026-07-01.md',
  ]),
  ['Daily', 'Projects', 'Projects/Meeting Notes', 'Projects/Meeting Notes/2026-07']);

check('folders: hidden folders (.obsidian, .trash) excluded',
  core.extractVaultFolders(['V/.obsidian/app.json', 'V/.trash/old.md', 'V/Notes/x.md']),
  ['Notes']);

check('folders: root-level files produce no folder entries',
  core.extractVaultFolders(['V/readme.md']),
  []);

check('zh: Chinese folder names preserved',
  core.extractVaultFolders(['V/会议记录/2026-07/记录.md']),
  ['会议记录', '会议记录/2026-07']);

check('folders: empty input → empty list',
  core.extractVaultFolders([]),
  []);

// ── formatSummaryHtml ──────────────────────────────────────────────────────
check('bullets + highlights render as list with <mark>',
  core.formatSummaryHtml('- Budget approved for **Q3**\n- Kai owns follow-up'),
  '<ul><li>Budget approved for <mark>Q3</mark></li><li>Kai owns follow-up</li></ul>');

check('plain lines render as paragraphs',
  core.formatSummaryHtml('Intro line\n- one bullet'),
  '<p>Intro line</p><ul><li>one bullet</li></ul>');

check('html in model output is escaped',
  core.formatSummaryHtml('- use <script> tags "carefully" & safely'),
  '<ul><li>use &lt;script&gt; tags &quot;carefully&quot; &amp; safely</li></ul>');

check('zh bullets render fine',
  core.formatSummaryHtml('- 预算已批准，负责人是**陈伟**'),
  '<ul><li>预算已批准，负责人是<mark>陈伟</mark></li></ul>');

// ── escapeHtml / sanitizeFilename ──────────────────────────────────────────
check('escapeHtml escapes the four specials',
  core.escapeHtml('<a href="x">&'),
  '&lt;a href=&quot;x&quot;&gt;&amp;');

check('sanitizeFilename strips forbidden chars, keeps zh, caps at 80',
  core.sanitizeFilename('预算会议: Q3/Q4 review?' + 'x'.repeat(100)),
  ('预算会议 Q3Q4 review' + 'x'.repeat(100)).slice(0, 80).trim().slice(0, 80));

// ── localDateStr (B1: local, not UTC, date for Obsidian export) ────────────
check('localDateStr formats a normal date',
  core.localDateStr(new Date(2026, 6, 10, 15, 30)), // 2026-07-10 15:30 local
  '2026-07-10');

check('localDateStr zero-pads single-digit month/day',
  core.localDateStr(new Date(2026, 0, 5, 9, 0)), // 2026-01-05 local
  '2026-01-05');

// Documents that LOCAL components are used, not UTC: a Date built from local
// wall-clock time just after midnight must keep "today"'s local date even
// though toISOString() (UTC-based) would render the previous day for any
// timezone east of UTC (e.g. UTC+8 SGT before 08:00 local).
check('localDateStr uses local date components near local midnight',
  core.localDateStr(new Date(2026, 6, 10, 0, 15)), // 2026-07-10 00:15 local
  '2026-07-10');

// ── trimSegmentsToByteBudget (D1: autosave quota safety) ───────────────────
check('lengthInUtf8Bytes: ASCII is 1 byte/char',
  core.lengthInUtf8Bytes('hello'), 5);

check('lengthInUtf8Bytes: CJK chars are multi-byte in UTF-8',
  core.lengthInUtf8Bytes('你好'), 6); // 2 chars * 3 bytes each in UTF-8

check('trimSegmentsToByteBudget: empty input',
  core.trimSegmentsToByteBudget([], 100), { kept: [], trimmedCount: 0 });

check('trimSegmentsToByteBudget: en fits entirely under budget → nothing trimmed',
  core.trimSegmentsToByteBudget(['one', 'two', 'three'], 1000),
  { kept: ['one', 'two', 'three'], trimmedCount: 0 });

check('trimSegmentsToByteBudget: en drops oldest first, keeps newest tail',
  core.trimSegmentsToByteBudget(['aaaaa', 'bbbbb', 'ccccc', 'ddddd'], 12),
  { kept: ['ccccc', 'ddddd'], trimmedCount: 2 });

check('trimSegmentsToByteBudget: zh — budget counted in UTF-8 bytes, not chars',
  // each segment is 3 CJK chars = 9 bytes in UTF-8; budget 18 → keep last 2 (18 bytes), drop older
  core.trimSegmentsToByteBudget(['你好世', '早上好', '再见了', '谢谢你'], 18),
  { kept: ['再见了', '谢谢你'], trimmedCount: 2 });

check('trimSegmentsToByteBudget: mixed zh-en segments respect byte (not char) budget',
  // '讨论AFO项目'=15 bytes, '预算是多少'=15 bytes, 'final decision made'=20 bytes (ASCII)
  core.trimSegmentsToByteBudget(['讨论AFO项目', '预算是多少', 'final decision made'], 40),
  { kept: ['预算是多少', 'final decision made'], trimmedCount: 1 });

check('trimSegmentsToByteBudget: a single oversized segment is kept whole, never truncated mid-segment',
  core.trimSegmentsToByteBudget(['short', 'this one segment alone exceeds the tiny budget'], 5),
  { kept: ['this one segment alone exceeds the tiny budget'], trimmedCount: 1 });

check('trimSegmentsToByteBudget: budget of 0 with content still keeps the last segment (never empties transcript entirely)',
  core.trimSegmentsToByteBudget(['a', 'b', 'c'], 0),
  { kept: ['c'], trimmedCount: 2 });

// ── trimSnapshotToByteBudget (D1 auditor rejection: finalTranscript is an
// untrimmed duplicate of the segment text, so trimming segments alone never
// actually shrinks the snapshot enough — this exercises the whole-snapshot
// wiring, not just the pure per-segment trim) ───────────────────────────────
{
  const mkSeg = (i, x) => ({ t: `00:${String(i).padStart(2, '0')}`, x, e: 0, sp: '' });
  const zhText = '我们需要讨论一下这个项目的预算和进度安排，这个非常重要';
  const enText = 'We need to discuss the budget and timeline for this project in more detail';
  const mixedText = '关于AFO project的budget，谁来负责跟进这个issue和下一步计划';
  const segments = [];
  for (let i = 0; i < 60; i++) {
    const x = i % 3 === 0 ? zhText : i % 3 === 1 ? enText : mixedText;
    segments.push(mkSeg(i, x));
  }
  // finalTranscript, as meeting.html builds it (`finalTranscript += ' ' + text`),
  // duplicates every segment's text into one big parallel string.
  const finalTranscript = segments.map(s => s.x).join(' ');
  const snap = {
    v: 1, savedAt: Date.now(),
    segments,
    summaries: [{ l: 'Summary', h: '<p>Summary text</p>', e: 0 }],
    qas: [],
    actions: [],
    dismissedActions: [],
    trimmedSegmentCount: 0,
    meetingContext: '', finalTranscript, pendingText: '',
    counters: { segmentCount: 60, summaryCount: 1, qaCount: 0, totalWords: 500, actionCount: 0 },
    obsidian: { notePath: '', title: '', chunk: 1 }
  };

  const fullBytes = core.lengthInUtf8Bytes(JSON.stringify(snap));
  const BUDGET = Math.floor(fullBytes / 4); // force a genuinely oversized snapshot

  const { snapshot: trimmed, trimmedCount } = core.trimSnapshotToByteBudget(snap, BUDGET);
  const trimmedBytes = core.lengthInUtf8Bytes(JSON.stringify(trimmed));

  check('trimSnapshotToByteBudget: zh/en/mixed oversized snapshot — segments are actually trimmed',
    trimmedCount > 0, true);

  check('trimSnapshotToByteBudget: trimmed snapshot fits the byte budget (finalTranscript duplicate no longer defeats the trim)',
    trimmedBytes <= BUDGET, true);

  check('trimSnapshotToByteBudget: finalTranscript is rebuilt from ONLY the kept segments (no stale duplicate)',
    trimmed.finalTranscript, trimmed.segments.map(s => s.x).join(' '));

  check('trimSnapshotToByteBudget: summaries/Q&A/actions/meetingContext untouched by trimming',
    { summaries: trimmed.summaries, qas: trimmed.qas, actions: trimmed.actions, meetingContext: trimmed.meetingContext },
    { summaries: snap.summaries, qas: snap.qas, actions: snap.actions, meetingContext: snap.meetingContext });

  check('trimSnapshotToByteBudget: newest segment always kept even under a very tight budget',
    trimmed.segments.length > 0 && trimmed.segments[trimmed.segments.length - 1].x === segments[segments.length - 1].x,
    true);
}

// ── Autosave restore hardening (D2) ─────────────────────────────────────────
{
  const baseSnap = {
    v: 2, savedAt: Date.now(),
    segments: [], summaries: [], qas: [], actions: [],
    counters: { segmentCount: 0, summaryCount: 0, qaCount: 0, totalWords: 0, actionCount: 0 },
    obsidian: { notePath: null, title: null, chunk: 1 },
  };

  check('validateAutosaveSnapshot: valid v2 snapshot accepted', core.validateAutosaveSnapshot(baseSnap), true);
  check('validateAutosaveSnapshot: valid v1 snapshot accepted (migration path)',
    core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { v: 1 })), true);
  check('validateAutosaveSnapshot: unknown schema version rejected',
    core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { v: 3 })), false);
  check('validateAutosaveSnapshot: missing v rejected', core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { v: undefined })), false);
  check('validateAutosaveSnapshot: null snapshot rejected', core.validateAutosaveSnapshot(null), false);
  check('validateAutosaveSnapshot: non-object snapshot rejected', core.validateAutosaveSnapshot('not json'), false);
  check('validateAutosaveSnapshot: missing segments array rejected',
    core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { segments: undefined })), false);
  check('validateAutosaveSnapshot: missing counters rejected',
    core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { counters: undefined })), false);
  check('validateAutosaveSnapshot: missing obsidian rejected',
    core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { obsidian: undefined })), false);
  check('validateAutosaveSnapshot: actions field omitted entirely is still fine (defaults to [] at restore)',
    core.validateAutosaveSnapshot(Object.assign({}, baseSnap, { actions: undefined })), true);
}

check('sanitizeStoredHtml: plain en text passes through unchanged',
  core.sanitizeStoredHtml('<p>Ship the release by <mark>Friday</mark>.</p>'),
  '<p>Ship the release by <mark>Friday</mark>.</p>');

check('sanitizeStoredHtml: plain zh text passes through unchanged',
  core.sanitizeStoredHtml('<p>下周<mark>五</mark>前发布。</p>'),
  '<p>下周<mark>五</mark>前发布。</p>');

check('sanitizeStoredHtml: mixed zh-en text passes through unchanged',
  core.sanitizeStoredHtml('<p>关于<mark>AFO integration</mark>，谁负责？</p>'),
  '<p>关于<mark>AFO integration</mark>，谁负责？</p>');

check('sanitizeStoredHtml: strips <script>...</script> block',
  core.sanitizeStoredHtml('<p>hi</p><script>alert(1)</script>'),
  '<p>hi</p>');

check('sanitizeStoredHtml: strips self-closing <script src=...>',
  core.sanitizeStoredHtml('<p>hi</p><script src="evil.js"></script>'),
  '<p>hi</p>');

check('sanitizeStoredHtml: strips <style>...</style> block',
  core.sanitizeStoredHtml('<style>body{display:none}</style><p>hi</p>'),
  '<p>hi</p>');

check('sanitizeStoredHtml: strips <iframe>', core.sanitizeStoredHtml('<iframe src="x"></iframe><p>ok</p>'), '<p>ok</p>');
check('sanitizeStoredHtml: strips <object>', core.sanitizeStoredHtml('<object data="x"></object><p>ok</p>'), '<p>ok</p>');
check('sanitizeStoredHtml: strips <embed>', core.sanitizeStoredHtml('<embed src="x"><p>ok</p>'), '<p>ok</p>');

check('sanitizeStoredHtml: strips onerror= handler off an <img>',
  core.sanitizeStoredHtml('<img src="x" onerror="alert(1)">'),
  '<img src="x">');

check('sanitizeStoredHtml: strips onclick= handler (single-quoted)',
  core.sanitizeStoredHtml("<div onclick='alert(1)'>hi</div>"),
  '<div>hi</div>');

check('sanitizeStoredHtml: neutralizes javascript: href',
  core.sanitizeStoredHtml('<a href="javascript:alert(1)">click</a>'),
  '<a href="#">click</a>');

check('sanitizeStoredHtml: non-string input returns empty string', core.sanitizeStoredHtml(null), '');

// ── meeting.html wiring (no duplicated logic left inline) ─────────────────
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'meeting.html'), 'utf8');

check('meeting.html loads core.js', html.includes('<script src="core.js">'), true);
check('meeting.html has no inline QUESTION_PATTERN', html.includes('QUESTION_PATTERN ='), false);
check('meeting.html has no inline STOPWORDS', html.includes('STOPWORDS ='), false);
check('meeting.html has no raw word-splitting left', /split\(\/\\s\+\/\)/.test(html), false);
check('meeting.html Obsidian export uses localDateStr, not toISOString UTC date', html.includes('MeetingCore.localDateStr(new Date())'), true);
check('meeting.html autosave quota-recovery uses trimSnapshotToByteBudget (accounts for the finalTranscript duplicate, not just segments)', html.includes('MeetingCore.trimSnapshotToByteBudget'), true);
check('meeting.html restore validates the snapshot before touching the page', html.includes('MeetingCore.validateAutosaveSnapshot'), true);
check('meeting.html restore sanitizes stored summary/Q&A HTML before re-injection', html.includes('MeetingCore.sanitizeStoredHtml'), true);
check('meeting.html snapshotState writes schema v2', /v:\s*2,/.test(html), true);

// ── BytePlus ASR frame build/parse (F1) ────────────────────────────────────
// Byte-level protocol fixtures, gzip-free — parseAsrFrame only needs to hand
// back the raw payload bytes + metadata; gunzip is the caller's job.
function u32be(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}
function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// buildAsrFrame round-trips through the same header layout parseAsrFrame reads.
{
  const payload = new TextEncoder().encode('{"result":{"utterances":[]}}');
  const frame = core.buildAsrFrame(core.ASR_MSG_FULL_CLIENT_REQUEST, 0b0000, core.ASR_SER_JSON, core.ASR_COMP_GZIP, payload);
  check('buildAsrFrame: header byte 0 is version/header-size', frame[0], 0x11);
  check('buildAsrFrame: header byte 1 packs messageType<<4 | flags', frame[1], (core.ASR_MSG_FULL_CLIENT_REQUEST << 4) | 0b0000);
  check('buildAsrFrame: header byte 2 packs serialization<<4 | compression', frame[2], (core.ASR_SER_JSON << 4) | core.ASR_COMP_GZIP);
  check('buildAsrFrame: total length is 8 + payload length', frame.length, 8 + payload.length);
}

// Valid full-server-response frame (no sequence field, JSON, gzip flag set —
// parseAsrFrame does not itself gunzip, it just reports needsGunzip).
{
  const jsonBytes = new TextEncoder().encode('{"result":{"utterances":[{"text":"hi","definite":true}]}}');
  const header = new Uint8Array([0x11, (core.ASR_MSG_FULL_SERVER_RESPONSE << 4) | 0b0000, (core.ASR_SER_JSON << 4) | core.ASR_COMP_GZIP, 0x00]);
  const buf = concatBytes(header, u32be(jsonBytes.length), jsonBytes).buffer;
  const parsed = core.parseAsrFrame(buf);
  check('parseAsrFrame: valid response type', parsed.type, 'response');
  check('parseAsrFrame: valid response needsGunzip reflects compression flag', parsed.needsGunzip, true);
  check('parseAsrFrame: valid response isJson reflects serialization flag', parsed.isJson, true);
  check('parseAsrFrame: valid response payloadBytes match input exactly', Array.from(parsed.payloadBytes), Array.from(jsonBytes));
}

// Error-response frame: errorCode + msgSize + msg, no payload section.
{
  const msgBytes = new TextEncoder().encode('bad request');
  const header = new Uint8Array([0x11, (core.ASR_MSG_ERROR_RESPONSE << 4) | 0b0000, (core.ASR_SER_JSON << 4) | core.ASR_COMP_NONE, 0x00]);
  const buf = concatBytes(header, u32be(1234), u32be(msgBytes.length), msgBytes).buffer;
  const parsed = core.parseAsrFrame(buf);
  check('parseAsrFrame: error response type', parsed.type, 'error');
  check('parseAsrFrame: error response errorCode', parsed.errorCode, 1234);
  check('parseAsrFrame: error response msg', parsed.msg, 'bad request');
}

// Sequence-flag variant: flags bit 0b0001 set means a 4-byte sequence field
// sits between the header and the payload-size field — parseAsrFrame must
// skip over it without misreading the payload length.
{
  const jsonBytes = new TextEncoder().encode('{"result":{"utterances":[]}}');
  const header = new Uint8Array([0x11, (core.ASR_MSG_FULL_SERVER_RESPONSE << 4) | 0b0001, (core.ASR_SER_JSON << 4) | core.ASR_COMP_NONE, 0x00]);
  const sequence = u32be(42);
  const buf = concatBytes(header, sequence, u32be(jsonBytes.length), jsonBytes).buffer;
  const parsed = core.parseAsrFrame(buf);
  check('parseAsrFrame: sequence-flag variant still resolves to response', parsed.type, 'response');
  check('parseAsrFrame: sequence-flag variant skips the sequence field correctly', Array.from(parsed.payloadBytes), Array.from(jsonBytes));
}

// Unhandled message type (neither response nor error) is reported, not thrown.
{
  const header = new Uint8Array([0x11, (0b0101 << 4) | 0b0000, (core.ASR_SER_JSON << 4) | core.ASR_COMP_NONE, 0x00]);
  const buf = concatBytes(header, u32be(0)).buffer;
  const parsed = core.parseAsrFrame(buf);
  check('parseAsrFrame: unrecognized message type is ignored, not thrown', parsed.type, 'ignored');
}

// Truncated/malformed buffers must never throw out of parseAsrFrame — the
// live ASR socket handler relies on this to survive a single bad frame
// without killing the watchdog/transcription stream (C1).
{
  const parsed = core.parseAsrFrame(new Uint8Array([0x11]).buffer);
  check('parseAsrFrame: truncated buffer returns malformed marker, does not throw', parsed.type, 'malformed');
}
{
  // Claims a huge payload size that overruns the actual buffer.
  const header = new Uint8Array([0x11, (core.ASR_MSG_FULL_SERVER_RESPONSE << 4) | 0b0000, (core.ASR_SER_JSON << 4) | core.ASR_COMP_NONE, 0x00]);
  const buf = concatBytes(header, u32be(999999)).buffer;
  const parsed = core.parseAsrFrame(buf);
  check('parseAsrFrame: oversized payload-length claim returns malformed marker, does not throw', parsed.type, 'malformed');
}
{
  // Error-response frame truncated before the message bytes arrive.
  const header = new Uint8Array([0x11, (core.ASR_MSG_ERROR_RESPONSE << 4) | 0b0000, (core.ASR_SER_JSON << 4) | core.ASR_COMP_NONE, 0x00]);
  const buf = concatBytes(header, u32be(1), u32be(999999)).buffer;
  const parsed = core.parseAsrFrame(buf);
  check('parseAsrFrame: truncated error-response returns malformed marker, does not throw', parsed.type, 'malformed');
}

// meeting.html wires the pure protocol logic through core.js rather than
// duplicating it inline.
check('meeting.html buildFrame delegates to MeetingCore.buildAsrFrame', html.includes('MeetingCore.buildAsrFrame'), true);
check('meeting.html handleAsrFrame delegates to MeetingCore.parseAsrFrame', html.includes('MeetingCore.parseAsrFrame'), true);

// ── ASR connection state machine (S1) ───────────────────────────────────────
// Every legal transition in the lifecycle idle→starting→recording→
// {stopping,reconnecting}→... must be accepted, and every illegal one
// (including self-loops and skipping states) must be rejected without
// throwing and without mutating the state.
{
  const legal = [
    ['idle', 'starting'],
    ['starting', 'recording'],
    ['starting', 'idle'],       // startRecognition() threw before going live
    ['recording', 'stopping'],
    ['recording', 'reconnecting'],
    ['reconnecting', 'recording'],
    ['reconnecting', 'stopping'],
    ['stopping', 'idle'],
  ];
  for (const [from, to] of legal) {
    check(`ASR transition legal: ${from} -> ${to}`, core.isValidAsrTransition(from, to), true);
    const result = core.nextAsrState(from, to);
    check(`ASR nextAsrState accepts ${from} -> ${to}`, result, { ok: true, state: to });
  }

  const illegal = [
    ['idle', 'recording'],       // can't skip 'starting'
    ['idle', 'reconnecting'],
    ['idle', 'stopping'],
    ['idle', 'idle'],            // self-loop
    ['starting', 'starting'],
    ['starting', 'reconnecting'],
    ['starting', 'stopping'],
    ['recording', 'recording'],
    ['recording', 'idle'],       // must go through 'stopping'
    ['recording', 'starting'],
    ['reconnecting', 'reconnecting'],
    ['reconnecting', 'idle'],    // must go through 'stopping'
    ['reconnecting', 'starting'],
    ['stopping', 'stopping'],
    ['stopping', 'recording'],
    ['stopping', 'reconnecting'],
    ['stopping', 'starting'],
  ];
  for (const [from, to] of illegal) {
    check(`ASR transition illegal: ${from} -> ${to}`, core.isValidAsrTransition(from, to), false);
    const result = core.nextAsrState(from, to);
    check(`ASR nextAsrState rejects ${from} -> ${to} (state unchanged)`, result, { ok: false, state: from });
  }
}

// meeting.html consolidates the lifecycle into one explicit state object
// with a single transition function, rather than scattered booleans (S1).
check('meeting.html has a single ASR lifecycle state object', html.includes("const asrState = { value: 'idle' }"), true);
check('meeting.html transitions go through setAsrState, which validates via core.js', html.includes('MeetingCore.nextAsrState(asrState.value, next)'), true);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${knownBugs} known-bug fixtures (Z1/Z2/Z3), ${failed} failed`);
for (const f of failures) {
  console.error(`\nFAIL: ${f.name}\n  expected: ${JSON.stringify(f.expected)}\n  actual:   ${JSON.stringify(f.actual)}`);
}
process.exit(failed ? 1 : 0);
