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

// ── meeting.html wiring (no duplicated logic left inline) ─────────────────
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'meeting.html'), 'utf8');

check('meeting.html loads core.js', html.includes('<script src="core.js">'), true);
check('meeting.html has no inline QUESTION_PATTERN', html.includes('QUESTION_PATTERN ='), false);
check('meeting.html has no inline STOPWORDS', html.includes('STOPWORDS ='), false);
check('meeting.html has no raw word-splitting left', /split\(\/\\s\+\/\)/.test(html), false);

// ── Report ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${knownBugs} known-bug fixtures (Z1/Z2/Z3), ${failed} failed`);
for (const f of failures) {
  console.error(`\nFAIL: ${f.name}\n  expected: ${JSON.stringify(f.expected)}\n  actual:   ${JSON.stringify(f.actual)}`);
}
process.exit(failed ? 1 : 0);
