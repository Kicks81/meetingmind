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
  'who owns the afo integration');

// E6 advisory: full-width vs half-width terminal punctuation must fold together
// or the same zh question is re-suggested on every cycle.
check('zh: full-width and half-width question marks dedupe together',
  core.questionKey('谁负责 SCS 的数据映射？'),
  core.questionKey('谁负责 SCS 的数据映射?'));

check('zh: trailing full-width period does not create a new key',
  core.questionKey('这个什么时候上线。'),
  core.questionKey('这个什么时候上线'));

check('en: trailing punctuation stripped from key',
  core.questionKey('Who owns this?'),
  'who owns this');

check('mixed zh-en question key normalises',
  core.questionKey('  Maggie 负责 UAT 吗？？  '),
  'maggie 负责 uat 吗');

check('questionKey tolerates empty/undefined input',
  core.questionKey(undefined),
  '');

check('distinct questions still produce distinct keys',
  core.questionKey('谁负责映射') === core.questionKey('谁负责测试'),
  false);

// ── parseSuggestedQuestion (E6 role-tagged suggestions) ────────────────────
const RK = ['engineer', 'pm', 'finance', 'design'];

check('en: parses role tag and question',
  core.parseSuggestedQuestion('- [pm] Who owns the SCS mapping?', RK),
  { role: 'pm', question: 'Who owns the SCS mapping?' });

check('zh: parses role tag with Chinese question',
  core.parseSuggestedQuestion('- [finance] 这个的成本谁批准？', RK),
  { role: 'finance', question: '这个的成本谁批准？' });

check('role tag is case-insensitive',
  core.parseSuggestedQuestion('- [PM] Who owns this?', RK).role,
  'pm');

check('unknown role tag is not treated as a tag',
  core.parseSuggestedQuestion('- [marketing] Who owns this?', RK),
  { role: null, question: '[marketing] Who owns this?' });

check('zh: bracketed real content is not eaten as a role tag',
  core.parseSuggestedQuestion('- [UAT] 什么时候上线？', RK),
  { role: null, question: '[UAT] 什么时候上线？' });

check('untagged line still yields the question',
  core.parseSuggestedQuestion('- Who owns this?', RK),
  { role: null, question: 'Who owns this?' });

check('parseSuggestedQuestion tolerates empty input',
  core.parseSuggestedQuestion(undefined, RK),
  { role: null, question: '' });

check('bullet variants are stripped',
  core.parseSuggestedQuestion('• [engineer] What is the data shape?', RK).question,
  'What is the data shape?');

// zh-locale models substitute CJK list markers for the requested "- ".
for (const marker of ['・', '·', '．', '、', '　']) {
  check(`zh: CJK list marker "${marker}" is stripped`,
    core.parseSuggestedQuestion(`${marker}[finance] 这个的成本谁批准？`, RK),
    { role: 'finance', question: '这个的成本谁批准？' });
}

check('zh: no marker at all still parses',
  core.parseSuggestedQuestion('[pm] 谁负责这个？', RK),
  { role: 'pm', question: '谁负责这个？' });

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

// ── Dead-export tripwire — every core.js export must be referenced in meeting.html ──
// extractQuestions is a deliberate exception: the automatic spoken-question-detection
// feature it powered was removed (see D35) because it produced too many irrelevant
// detections in practice, but the underlying pure function is kept exported and
// eval-tested for potential future reuse. Do not allow-list anything else here without
// a similarly explicit, verified justification — the point of this check is to catch
// the NEXT phantom export, not paper over this one. (An earlier attempt at automatically
// detecting "used internally within core.js" via substring matching was reverted: every
// function's own declaration trivially contains the substring `name(`, so that approach
// would have silently defeated this check for every function export, forever.)
const deadExportAllowList = [
  'extractQuestions', // removed feature (auto-Q&A), kept for potential future reuse — see D35
  // Used internally by nextAsrState() (called from meeting.html) but not referenced by name
  // directly in meeting.html — exported alongside nextAsrState so the eval suite can test
  // transition validation directly and completely (D23). Verified by direct code inspection,
  // not by an automated internal-usage heuristic.
  'isValidAsrTransition', 'ASR_STATES', 'ASR_TRANSITIONS',
  // Genuinely superseded, NOT used internally or externally: searchVault() calls
  // latinTerms()/cjkBigrams() directly instead of tokenizeQuery(); trimSnapshotToByteBudget()
  // reimplements trimSegmentsToByteBudget()'s logic inline instead of calling it. Kept only
  // because their existing eval fixtures can't be deleted (D7's never-delete-a-fixture rule).
  'tokenizeQuery', 'trimSegmentsToByteBudget',
];
// Most call sites use the `MeetingCore.name` form, but one destructures a batch
// of names off MeetingCore up front (`const { a, b, ... } = MeetingCore;`) and
// calls them bare afterward — that destructuring is itself a reference.
const destructuredMatch = html.match(/const\s*\{([^}]+)\}\s*=\s*MeetingCore;/);
const destructuredNames = destructuredMatch
  ? destructuredMatch[1].split(',').map(s => s.trim()).filter(Boolean)
  : [];
const unreferencedExports = Object.keys(core).filter(name =>
  !deadExportAllowList.includes(name) &&
  !html.includes(`MeetingCore.${name}`) &&
  !destructuredNames.includes(name)
);
check('every core.js export is referenced in meeting.html (except allow-listed exceptions)',
  unreferencedExports, []);

// ── Doc/code drift tripwire — SUGGEST_EVERY_N_SUMMARIES must match D29's documented value ──
// D29 (DEVELOPMENT.md) says proactive role-question suggestions run "every 3rd rolling
// summary." Hardcoding 3 here (rather than regex-scraping D29's prose) is deliberately
// simpler and more robust — if D29's wording changes, update this expected value to match.
const suggestEveryNMatch = html.match(/const SUGGEST_EVERY_N_SUMMARIES = (\d+);/);
check('SUGGEST_EVERY_N_SUMMARIES matches D29\'s documented "every 3rd" value',
  suggestEveryNMatch ? parseInt(suggestEveryNMatch[1], 10) : null, 3);

// ── Summary column split + one-click export (V1/V2/V3) ─────────────────────
// These are grep guards on decisions that look like tidy-up targets but are
// load-bearing. Each one broke, or would have broken, something real.

// V1 — the consolidated view has its own pane instead of floating over the updates.
check('meeting.html has a separate consolidated panel', html.includes('id="consolidatedPanel"'), true);
check('meeting.html renders the consolidated block into consolidatedPanel', html.includes("getElementById('consolidatedPanel')"), true);
// It used to be position:sticky inside #summaryPanel — that IS the overlap bug.
check('meeting.html no longer positions the consolidated block sticky', /\.summary-block\.consolidated\s*\{[^}]*position:\s*sticky/.test(html), false);
// Clear and restore must both reset the new pane. Before the split, resetting
// #summaryPanel.innerHTML wiped the consolidated block for free; it no longer
// does, so a stale consolidated summary would sit beside a NEW meeting.
check('meeting.html has a single consolidated-pane reset helper', html.includes('function resetConsolidatedPanel('), true);
check('meeting.html clearAll resets the consolidated pane', /function clearAll\([\s\S]{0,2000}?resetConsolidatedPanel\(\)/.test(html), true);
check('meeting.html autosave restore resets the consolidated pane', /snap\.summaries[\s\S]{0,1200}?resetConsolidatedPanel\(\)/.test(html), true);
// Belt-and-braces: scoping to #summaryPanel already excludes the block now, but
// :not(.consolidated) is what stops the consolidation feeding on its own output
// and drifting (D30). All three uses must survive.
check('meeting.html keeps all three :not(.consolidated) guards (D30)',
  (html.match(/:not\(\.consolidated\)/g) || []).filter(Boolean).length >= 3, true);

// V3 — the export must carry markdown, not textContent.
// .summary-text holds formatSummaryHtml output: textContent strips "- " and
// **bold**, and adds NO newlines across block elements, so a whole summary
// arrived in the vault as one run-on line (unreadable in Chinese especially).
check('meeting.html reads summary text back as markdown', html.includes('function summaryMarkdown('), true);
check('meeting.html export no longer reads .summary-text textContent directly', html.includes(".summary-text').textContent"), false);
check('meeting.html export uses summaryMarkdown', /summaryBlocks\s*=\s*summaryEls\.map\([\s\S]{0,200}?summaryMarkdown\(/.test(html), true);
check('meeting.html consolidation source uses summaryMarkdown', /consolidatedSource[\s\S]{0,400}?\.map\(summaryMarkdown\)/.test(html), true);
check('meeting.html stashes the raw markdown on generated summaries', (html.match(/__md = /g) || []).length >= 3, true);
check('meeting.html drops the stashed markdown when a block is hand-edited', /contenteditable[\s\S]{0,400}?__md = null/.test(html), true);
check('meeting.html snapshots the summary markdown as an additive field', /m:\s*textEl\.__md/.test(html), true);

// V2 — one-click export.
// The multi-click export was never a bug in the export loop: exportViaVaultHandle
// already writes the entire backlog in one write. It is only reachable with a
// connected vault folder, and nothing guided the user there.
check('meeting.html offers the vault connect on a fresh gesture', html.includes('id="vaultHintBanner"'), true);
check('meeting.html shows the vault hint from the Start click, not the export path', /function toggleRecording\([\s\S]{0,900}?maybeShowVaultHint\(\)/.test(html), true);
// showDirectoryPicker() needs transient user activation; the stop-path export
// runs after `await generateFinalSynthesis()`, when it is long gone (D28's rule).
// So the picker must NOT be invoked from the export path.
check('meeting.html never opens the folder picker from the export path', /function sendAllObsidianChunks\([\s\S]{0,900}?connectVaultFolder\(/.test(html), false);
// Vault writes are serialised: checkObsidianAutoSplit() is fired un-awaited from
// the ASR frame loop, and two overlapping calls both saw notePath === null, both
// wrote with append:false (second truncating the first) and forked the note.
check('meeting.html serialises vault writes', html.includes('function queueVaultWrite('), true);
check('meeting.html routes vault export through the write queue', /function exportViaVaultHandle\(\)\s*\{\s*return queueVaultWrite\(runExportViaVaultHandle\)/.test(html), true);
check('meeting.html write queue survives a rejected write', /vaultWriteQueue = run\.catch\(/.test(html), true);

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

// ── Config export/import envelope (E3) ──────────────────────────────────────
check('configHasSecrets: true when apiKey present',
  core.configHasSecrets({ apiKey: 'sk-or-abc', relayUrl: 'ws://localhost:8765' }, ['apiKey', 'bytePlusKey']),
  true);

check('configHasSecrets: true when bytePlusKey present',
  core.configHasSecrets({ bytePlusKey: 'bp-xyz' }, ['apiKey', 'bytePlusKey']),
  true);

check('configHasSecrets: false when only non-secret fields set',
  core.configHasSecrets({ relayUrl: 'ws://localhost:8765', obsidianVault: 'Vault' }, ['apiKey', 'bytePlusKey']),
  false);

check('configHasSecrets: whitespace-only key value counts as absent',
  core.configHasSecrets({ apiKey: '   ' }, ['apiKey', 'bytePlusKey']),
  false);

check('configHasSecrets: empty config is false',
  core.configHasSecrets({}, ['apiKey', 'bytePlusKey']),
  false);

check('buildConfigEnvelope: shape',
  core.buildConfigEnvelope('c2FsdA==', 'aXY=', 'ZGF0YQ=='),
  { enc: 'v1', salt: 'c2FsdA==', iv: 'aXY=', data: 'ZGF0YQ==' });

check('isEncryptedConfigEnvelope: true for a v1 envelope',
  core.isEncryptedConfigEnvelope({ enc: 'v1', salt: 'a', iv: 'b', data: 'c' }),
  true);

check('isEncryptedConfigEnvelope: false for a plain config object',
  core.isEncryptedConfigEnvelope({ apiKey: 'sk-or-abc', relayUrl: 'ws://localhost:8765' }),
  false);

check('isEncryptedConfigEnvelope: false for null/non-object',
  core.isEncryptedConfigEnvelope(null),
  false);

check('parseConfigEnvelope: extracts salt/iv/data from a valid envelope',
  core.parseConfigEnvelope({ enc: 'v1', salt: 'S', iv: 'I', data: 'D' }),
  { salt: 'S', iv: 'I', data: 'D' });

check('parseConfigEnvelope: null for a plain config (not an envelope)',
  core.parseConfigEnvelope({ apiKey: 'sk-or-abc' }),
  null);

check('parseConfigEnvelope: null when a required field is missing',
  core.parseConfigEnvelope({ enc: 'v1', salt: 'S', iv: 'I' }),
  null);

check('parseConfigEnvelope: null when a required field is empty string',
  core.parseConfigEnvelope({ enc: 'v1', salt: '', iv: 'I', data: 'D' }),
  null);

check('meeting.html: Save Config offers passphrase encryption when keys are present',
  html.includes('encryptConfig'),
  true);

check('meeting.html: Load Config handles the encrypted envelope via core.js',
  html.includes('MeetingCore.isEncryptedConfigEnvelope'),
  true);

check('meeting.html: a plaintext-export warning is present',
  /plain ?text/i.test(html),
  true);

check('meeting.html: a localStorage note is present near the key inputs',
  html.includes('localStorage') && /this browser/i.test(html),
  true);

// ── Diagnostics panel formatter (E4) ─────────────────────────────────────────
{
  const dump = core.formatDiagnosticsDump({
    timestamp: '2026-07-10T00:00:00.000Z',
    asrState: 'recording',
    socketReadyState: 1,
    bufferedAmount: 0,
    secondsSinceLastFrame: 2,
    reconnectCount: 0,
    captureMode: 'worklet',
    micTrackState: 'live',
    systemTrackState: 'live',
    extraTracksLive: 1,
    extraTracksDead: 0,
    audioCtxState: 'running',
    summaryCalls: 5,
    summaryFailures: 0,
    questionCalls: 2,
    questionFailures: 1,
    actionCalls: 3,
    actionFailures: 0,
    summaryQueueState: 'idle',
    lastAutosaveResult: 'ok',
    snapshotBytes: 12345,
    snapshotBudget: 4194304,
    exportLedgerChunks: 2,
  });
  check('formatDiagnosticsDump: includes ASR state', /state: recording/.test(dump), true);
  check('formatDiagnosticsDump: includes socket readyState', /socket readyState: 1/.test(dump), true);
  check('formatDiagnosticsDump: includes reconnect count', /reconnect count: 0/.test(dump), true);
  check('formatDiagnosticsDump: includes capture mode', /capture mode: worklet/.test(dump), true);
  check('formatDiagnosticsDump: includes LLM call\\/failure counts', /summary calls\/failures: 5\/0/.test(dump), true);
  check('formatDiagnosticsDump: includes autosave result', /last autosave: ok/.test(dump), true);
  check('formatDiagnosticsDump: includes export ledger chunk count', /export ledger chunks: 2/.test(dump), true);
  check('formatDiagnosticsDump: never leaks an "apiKey" field even if present on input',
    core.formatDiagnosticsDump({ apiKey: 'sk-or-should-not-appear' }).includes('sk-or-should-not-appear'),
    false);
}

check('formatDiagnosticsDump: missing fields render as n/a, not throw/undefined',
  /state: n\/a/.test(core.formatDiagnosticsDump({})),
  true);

// ── parseSseChunks (D34) ───────────────────────────────────────────────────
{
  // CJK multi-byte char split across two decode() calls.
  const encoder = new TextEncoder();
  const fullLine = 'data: {"choices":[{"delta":{"content":"中文"}}]}\n';
  const fullBytes = encoder.encode(fullLine);
  const prefix = 'data: {"choices":[{"delta":{"content":"';
  const splitAt = encoder.encode(prefix).length + 1; // splits inside 中's 3-byte UTF-8 sequence
  const chunk1 = fullBytes.slice(0, splitAt);
  const chunk2 = fullBytes.slice(splitAt);
  const decoder = new TextDecoder();
  const text1 = decoder.decode(chunk1, { stream: true });
  const text2 = decoder.decode(chunk2, { stream: true });

  const afterChunk1 = core.parseSseChunks('', text1);
  check('parseSseChunks: CJK split across decode boundary — no premature line after chunk 1',
    afterChunk1.completeLines, []);

  const afterChunk2 = core.parseSseChunks(afterChunk1.residual, text2);
  check('parseSseChunks: CJK split across decode boundary — line reconstructs uncorrupted after chunk 2',
    afterChunk2.completeLines,
    ['data: {"choices":[{"delta":{"content":"中文"}}]}']);
  check('parseSseChunks: CJK split across decode boundary — residual drained',
    afterChunk2.residual, '');
}

{
  // SSE line split across two reads with no trailing newline in the first read.
  const r1 = core.parseSseChunks('', 'data: {"choices":[{"delta":{"content":"hel');
  check('parseSseChunks: incomplete line held as residual, not processed early',
    { completeLines: r1.completeLines, residual: r1.residual },
    { completeLines: [], residual: 'data: {"choices":[{"delta":{"content":"hel' });

  const r2 = core.parseSseChunks(r1.residual, 'lo"}}]}\n');
  check('parseSseChunks: held residual + next chunk reconstructs the full line',
    { completeLines: r2.completeLines, residual: r2.residual },
    { completeLines: ['data: {"choices":[{"delta":{"content":"hello"}}]}'], residual: '' });
}

check('parseSseChunks: normal single-read case unaffected (regression)',
  core.parseSseChunks('', 'data: {"a":1}\ndata: {"b":2}\n'),
  { completeLines: ['data: {"a":1}', 'data: {"b":2}'], residual: '' });

// ── shouldConfirmClear ───────────────────────────────────────────────────
check('shouldConfirmClear: both counts zero returns null (nothing to lose)',
  core.shouldConfirmClear(0, 0), null);

check('shouldConfirmClear: message includes both counts',
  core.shouldConfirmClear(3, 2),
  'This meeting has 3 segment(s) and 2 summary block(s) not yet saved to your vault. Clear anyway?');

check('shouldConfirmClear: segments only',
  core.shouldConfirmClear(5, 0),
  'This meeting has 5 segment(s) and 0 summary block(s) not yet saved to your vault. Clear anyway?');

check('shouldConfirmClear: summaries only',
  core.shouldConfirmClear(0, 4),
  'This meeting has 0 segment(s) and 4 summary block(s) not yet saved to your vault. Clear anyway?');

// ── determineExportStatus ─────────────────────────────────────────────────
check('determineExportStatus: content written → exported',
  core.determineExportStatus({ wroteContent: true, blocked: false }),
  { status: 'exported' });

check('determineExportStatus: nothing pending → nothing-pending',
  core.determineExportStatus({ wroteContent: false, blocked: false }),
  { status: 'nothing-pending' });

check('determineExportStatus: blocked with reason is preserved',
  core.determineExportStatus({ wroteContent: false, blocked: true, blockedReason: 'Permission denied' }),
  { status: 'blocked', reason: 'Permission denied' });

check('determineExportStatus: blocked without reason falls back to default message',
  core.determineExportStatus({ wroteContent: false, blocked: true }),
  { status: 'blocked', reason: 'Export was blocked or declined' });

check('determineExportStatus: wroteContent takes precedence over nothingPending (defensive)',
  core.determineExportStatus({ wroteContent: true, blocked: false }),
  { status: 'exported' });

// ── outputLanguageInstruction ───────────────────────────────────────────────
check('outputLanguageInstruction: en selection forces English',
  core.outputLanguageInstruction('en'),
  'Reply in English, even if the meeting itself is in another language or code-switches. ');

check('outputLanguageInstruction: zh selection forces Chinese',
  core.outputLanguageInstruction('zh'),
  'Reply in Chinese (中文), even if the meeting itself is in another language or code-switches. ');

check('outputLanguageInstruction: unknown selection defaults to English',
  core.outputLanguageInstruction('bogus'),
  'Reply in English, even if the meeting itself is in another language or code-switches. ');

// ── pickFullMeetingSource (D37) ─────────────────────────────────────────────
check('pickFullMeetingSource: prefers consolidated when present',
  core.pickFullMeetingSource('hello', 'fallback'),
  'hello');

check('pickFullMeetingSource: falls back to transcript when consolidated is empty',
  core.pickFullMeetingSource('', 'fallback'),
  'fallback');

check('pickFullMeetingSource: whitespace-only consolidated counts as empty',
  core.pickFullMeetingSource('   ', 'fallback'),
  'fallback');

check('pickFullMeetingSource: null consolidated falls back to transcript',
  core.pickFullMeetingSource(null, 'fallback'),
  'fallback');

check('pickFullMeetingSource: undefined consolidated falls back to transcript',
  core.pickFullMeetingSource(undefined, 'fallback'),
  'fallback');

check('pickFullMeetingSource: consolidated present, transcript empty — consolidated wins',
  core.pickFullMeetingSource('hello', ''),
  'hello');

check('pickFullMeetingSource: both empty — empty string',
  core.pickFullMeetingSource('', ''),
  '');

check('pickFullMeetingSource: both whitespace-only — empty string',
  core.pickFullMeetingSource('  ', '  '),
  '');

// ── rebuildContextFromSegments (A6) ─────────────────────────────────────────

// en: matches live-ingestion join (space separator)
check(
  'rebuildContextFromSegments — en',
  core.rebuildContextFromSegments([
    'We shipped the release.',
    'Who owns the AFO integration?',
  ]),
  'We shipped the release. Who owns the AFO integration?'
);

// zh: same join format; no extra CJK whitespace introduced beyond the
// space separator that live ingestion already uses
check(
  'rebuildContextFromSegments — zh',
  core.rebuildContextFromSegments([
    '预算已经批了。',
    '下一步谁来跟进？',
  ]),
  '预算已经批了。 下一步谁来跟进？'
);

// mixed: consistency with the same join rule regardless of script
check(
  'rebuildContextFromSegments — mixed',
  core.rebuildContextFromSegments([
    '关于AFO integration，现在谁负责跟进？',
    'I will follow up by Friday.',
  ]),
  '关于AFO integration，现在谁负责跟进？ I will follow up by Friday.'
);

// ── markdownToRtf (G5, no-Obsidian .doc export) ─────────────────────────────
// RTF is 7-bit ASCII, so every character above it (all of CJK, for a start)
// MUST round-trip through a \uN escape without corruption — that is the real
// hard-constraint risk here, not just "did it not throw". This decoder
// reverses the exact encoding markdownToRtf uses (structural markers first,
// since content braces are always backslash-escaped and can't collide with
// them; \uN decode; then literal backslash/brace un-escaping) and asserts the
// result matches the original markdown byte-for-byte. It deliberately does
// not handle a literal `{`/`}` inside bold text (a real, if rare, gap in this
// *test* decoder only, not in production RTF readers) — so fixtures avoid
// literal braces inside bold/bullet content and cover that escaping via a
// separate structural check below instead.
function decodeRtfBody(rtf) {
  const start = rtf.indexOf('\\fs22\n') + '\\fs22\n'.length;
  const end = rtf.lastIndexOf('\n}');
  let body = rtf.slice(start, end);
  body = body.replace(/\{\\b\\fs28 (.*?)\}/g, '## $1');
  body = body.replace(/\{\\b\\fs36 (.*?)\}/g, '# $1');
  body = body.replace(/\\bullet\\tab /g, '- ');
  body = body.replace(/\{\\b (.*?)\}/g, '**$1**');
  body = body.replace(/\\u(-?\d+)\?/g, (_, n) => String.fromCharCode(((parseInt(n, 10) % 65536) + 65536) % 65536));
  body = body.replace(/\\\\/g, '\\').replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  body = body.replace(/\\par\n?/g, '\n');
  return body.replace(/\n$/, '');
}

function checkRtfRoundTrip(name, markdown) {
  const rtf = core.markdownToRtf(markdown);
  const hasNonAscii = [...rtf].some(ch => ch.codePointAt(0) > 0x7f);
  check(name + ' — no raw non-ASCII bytes in output', hasNonAscii, false);
  const expectedPlain = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  check(name + ' — round-trips to the original markdown', decodeRtfBody(rtf), expectedPlain);
}

checkRtfRoundTrip('markdownToRtf — en',
  '# Team Sync\n**Decisions**\n- Budget approved\n- Ship by Friday');

checkRtfRoundTrip('markdownToRtf — zh',
  '# 团队同步\n**决定**\n- 预算已批准\n- 周五发布');

checkRtfRoundTrip('markdownToRtf — mixed',
  '# AFO Sync 会议\n**Decisions**\n- Budget approved 预算已批准\n- 谁负责 follow up by Friday？');

checkRtfRoundTrip('markdownToRtf — strips YAML frontmatter',
  '---\ntitle: Team Sync\ndate: 2026-09-06\ntags: [meeting, meetingmind]\n---\n\n# Team Sync\n2026-09-06 10:00\n\n- Budget approved');

// Real buildObsidianChunkMarkdown shape: "## Segment N — time" per chunk
checkRtfRoundTrip('markdownToRtf — ## segment heading (real export shape)',
  '# Team Sync\n2026-09-06 10:00\n\n## Segment 1 — 10:00:00\n**10:00:00** — Budget approved 预算已批准');

check('markdownToRtf — escapes a literal backslash',
  /\\\\/.test(core.markdownToRtf('Path: C:\\Users\\example')), true);
check('markdownToRtf — escapes a literal open brace',
  /\\\{/.test(core.markdownToRtf('Formula: {x}')), true);
check('markdownToRtf — escapes a literal close brace',
  /\\\}/.test(core.markdownToRtf('Formula: {x}')), true);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${knownBugs} known-bug fixtures (Z1/Z2/Z3), ${failed} failed`);
for (const f of failures) {
  console.error(`\nFAIL: ${f.name}\n  expected: ${JSON.stringify(f.expected)}\n  actual:   ${JSON.stringify(f.actual)}`);
}
process.exit(failed ? 1 : 0);
