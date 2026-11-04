#!/usr/bin/env node
// The repository verifier. Its job is to stop this repository from saying things
// about itself that are no longer true.
//
// Two rules shape how it is written, and both were learned the hard way.
//
// The first is that an assertion made once per file is a count of how many files
// the repository has. The dash check and the purity check used to run per file,
// so adding one unrelated document moved the total by two and adding one check
// module moved it by nine. The number printed in the README was therefore partly
// a measure of the repository's size. Every check here that walks a corpus makes
// a fixed number of assertions over the whole corpus and names the offenders in
// the message instead, and CI proves the total does not move when a file is
// added.
//
// The second is that the total must not depend on anything else either: not on
// whether the assertions pass, not on which Node version is running, and not on
// whether a regular expression found what it was looking for. So there are no
// conditional assertions below. A count the README does not state fails rather
// than being skipped, and a number that could not be read is compared as NaN,
// which also fails. Every path through this file makes exactly the same number
// of assertions.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

import { allFindings, AREAS, SEVERITIES } from '../src/catalog.mjs';
import { declaredFindings } from './example.mjs';
import { PAIRS, pairNames, reachedByPairs } from './pairs.mjs';
import { FIXTURES } from './fixtures.mjs';
import { LIMITS, headingsInDocument } from './limits.mjs';
import { trackedFiles } from './tracked.mjs';
import { countTests, testFilesFromPackage } from './count-tests.mjs';
import { inspectAll } from './entry-thin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const README_LINES = README.split('\n');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

const NODE_FLOOR = '20.0.0';
const TEXT_EXTENSIONS = ['.mjs', '.md', '.json', '.yml', '.html', '.css', '.txt', '.sql', '.xml'];

let assertions = 0;
const failures = [];

function check(label, condition, detail = '') {
  assertions += 1;
  if (!condition) failures.push(detail ? `${label}: ${detail}` : label);
}

/**
 * A number the README states, matched as a whole line and compared.
 *
 * Always two assertions, whatever happens. Matching whole lines rather than
 * searching the document means a count that has wrapped onto two lines fails,
 * and requiring exactly one matching line means a count stated twice fails too,
 * which is the case a search for the first match cannot see.
 */
function statedNumber(label, pattern, actual) {
  const lines = README_LINES.filter((line) => pattern.test(line));
  check(
    `the README states the ${label} on exactly one line`,
    lines.length === 1,
    `${lines.length} lines match, and a count that has wrapped or been duplicated is not a self check`
  );
  const stated = lines.length === 1 ? Number(pattern.exec(lines[0])[1]) : Number.NaN;
  check(
    `the README's ${label} matches the repository`,
    stated === actual,
    `README says ${Number.isNaN(stated) ? 'nothing usable' : stated}, the repository has ${actual}`
  );
}

/** One assertion over a whole corpus, with the offenders named in the message. */
function noneOf(label, items, predicate, describe) {
  const offenders = items.filter(predicate).map(describe);
  check(label, offenders.length === 0, offenders.slice(0, 12).join('; ') + (offenders.length > 12 ? ' ...' : ''));
}

// --------------------------------------------------------------- the corpus

// Tracked files, not whatever is on disk. A directory walk counts build
// leftovers, so running npm install in a clone used to move the total.
const tracked = trackedFiles(ROOT);
const textFiles = tracked.filter((f) => TEXT_EXTENSIONS.includes(extname(f)));
const shippedModules = tracked.filter((f) => /^(bin|src|probe)\//.test(f) && f.endsWith('.mjs'));

check('the corpus is read from git rather than from the working copy', tracked.length > 50, `${tracked.length} files`);
check('there are shipped modules to check', shippedModules.length > 5, `${shippedModules.length} modules`);

// --------------------------------------------------------------- house style

const sourceOf = new Map(textFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

// The needles are built from code points. Writing them as characters put both
// of them in this file, so the check failed on the only file in the repository
// whose job is to look for them, which is the kind of failure that gets a check
// deleted rather than fixed.
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

noneOf(
  'no tracked text file contains an em dash',
  textFiles,
  (f) => sourceOf.get(f).includes(EM_DASH),
  (f) => f
);
noneOf(
  'no tracked text file contains an en dash',
  textFiles,
  (f) => sourceOf.get(f).includes(EN_DASH),
  (f) => f
);
check(
  'the dash check is looking for the right two characters',
  EM_DASH.codePointAt(0) === 0x2014 && EN_DASH.codePointAt(0) === 0x2013
);

// --------------------------------------------------------------- the network claim

// The README says the judgement is a pure function and only probe/ touches the
// network. This is where that claim is kept honest rather than asserted.
const NETWORK = [
  /from\s+'node:(dns|https?|net|tls|dgram)'/,
  /require\(['"]node:(dns|https?|net|tls|dgram)['"]\)/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /child_process/
];
const WRITES = [/\bwriteFileSync\b|\bwriteFile\b/, /\bappendFileSync\b|\bappendFile\b/, /\brmSync\b|\bunlinkSync\b/, /\bmkdirSync\b/];
const judgementModules = shippedModules.filter((f) => !f.startsWith('probe/'));

noneOf(
  'nothing outside probe/ reaches the network',
  judgementModules,
  (f) => NETWORK.some((p) => p.test(readFileSync(join(ROOT, f), 'utf8'))),
  (f) => f
);
noneOf(
  'nothing outside probe/ writes to the filesystem',
  judgementModules,
  (f) => WRITES.some((p) => p.test(readFileSync(join(ROOT, f), 'utf8'))),
  (f) => f
);

// And the other half: the collector has to be where the network access lives, or
// the separation above is only true because nothing collects anything.
const probe = readFileSync(join(ROOT, 'probe', 'collect.mjs'), 'utf8');
check(
  'probe/collect.mjs is the part that does reach the network',
  /from 'node:dns'/.test(probe) && /from 'node:tls'/.test(probe),
  'the separation is meaningless if nothing collects'
);
check(
  'the collector takes its decisions from src/probe-plan.mjs',
  probe.includes('../src/probe-plan.mjs'),
  'the parsing and assembly have to live where a test can drive them'
);

// --------------------------------------------------------------- shipped imports

// Nothing a package ships may import from a directory it does not ship. It works
// in the repository and fails in every installed copy, which is the quietest
// kind of broken.
const shipped = new Set(PACKAGE.files);
const badImports = [];
for (const file of shippedModules) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  for (const match of source.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
    const parts = `${dirname(file)}/${match[1]}`.split('/');
    const stack = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') stack.pop();
      else stack.push(part);
    }
    if (!shipped.has(stack[0])) badImports.push(`${file} imports ${match[1]}`);
  }
}
check(
  'nothing the package ships imports from a directory it does not ship',
  badImports.length === 0,
  badImports.join('; ')
);
check('tools/ and test/ are deliberately not shipped', !shipped.has('tools') && !shipped.has('test'));

// --------------------------------------------------------------- the entry points

const entries = inspectAll(ROOT);
noneOf(
  'every entry point is wiring rather than logic',
  entries,
  (e) => e.problems.length > 0,
  (e) => `${e.path}: ${e.problems.join(', ')}`
);

// --------------------------------------------------------------- the test suite

const scriptFiles = testFilesFromPackage();
const onDisk = readdirSync(join(ROOT, 'test'))
  .filter((f) => extname(f) === '.mjs')
  .map((f) => `test/${f}`)
  .sort();

check(
  'the test script does not use a glob',
  !PACKAGE.scripts.test.includes('*'),
  'node --test did not accept glob patterns before Node 21, so a glob means the suite silently does not run on Node 20'
);
noneOf(
  'every test file on disk is named in the test script',
  onDisk,
  (f) => !scriptFiles.includes(f),
  (f) => `${f} is never run`
);
noneOf(
  'every test file the script names exists',
  scriptFiles,
  (f) => !existsSync(join(ROOT, f)),
  (f) => `${f} does not exist`
);

let testCount = Number.NaN;
let testFailures = Number.NaN;
let countError = '';
try {
  const counted = countTests(scriptFiles);
  testCount = counted.passed;
  testFailures = counted.failed;
} catch (error) {
  countError = error.message;
}
check('the test suite can be counted on this Node version', Number.isFinite(testCount), countError);
check('no test fails', testFailures === 0, `${testFailures} failing`);

// --------------------------------------------------------------- the catalogue

const findings = allFindings();
noneOf(
  'every catalogue entry says what to do and what it does not prove',
  findings,
  (f) => !f.nextAction || !f.doesNotProve || !SEVERITIES.includes(f.severity),
  (f) => f.id
);
check(
  'there is one fixture per catalogued reason',
  FIXTURES.length === findings.length,
  `${FIXTURES.length} fixtures, ${findings.length} findings`
);
noneOf(
  'every fixture names a reason that is in the catalogue',
  FIXTURES,
  (f) => !findings.some((entry) => entry.id === f.reason),
  (f) => f.reason
);

// --------------------------------------------------------------- the examples

const names = pairNames().slice().sort();
noneOf(
  'every example has a README, a failing side and a corrected side',
  names,
  (name) => !['README.md', 'fail', 'pass'].every((part) => existsSync(join(ROOT, 'examples', name, part))),
  (name) => name
);
noneOf(
  'every finding an example README names is in the catalogue',
  names.flatMap((name) => declaredFindings(name).map((id) => ({ name, id }))),
  ({ id }) => !findings.some((f) => f.id === id),
  ({ name, id }) => `${name} names ${id}`
);
noneOf(
  'every example names at least one finding',
  names,
  (name) => declaredFindings(name).length === 0,
  (name) => name
);
noneOf(
  'the README lists every example',
  names,
  (name) => !README.includes(`\`${name}\``),
  (name) => name
);
check('the baseline exists', existsSync(join(ROOT, 'examples', 'baseline', 'profile.json')));
check(
  'the pair manifest and the examples directory are the same set',
  JSON.stringify(names) === JSON.stringify(readdirSync(join(ROOT, 'examples')).filter((n) => /^\d\d-/.test(n)).sort()),
  'tools/pairs.mjs and examples/ disagree'
);

// --------------------------------------------------------------- the limits

check(
  'docs/limits.md and the asserted limits are the same set',
  JSON.stringify(headingsInDocument().slice().sort()) === JSON.stringify(LIMITS.map((l) => l.heading).sort()),
  'a limit is stated in the document with nothing asserting it, or the other way round'
);
noneOf(
  'every asserted limit names the finding it is about',
  LIMITS,
  (l) => typeof l.absent !== 'string' || l.absent.length === 0,
  (l) => l.heading
);

// --------------------------------------------------------------- the Node floor

// An engines floor has to be an exact version, and it has to be asserted rather
// than merely written. A bare major plus a CI job named with that major is not a
// tested promise, because actions/setup-node resolves a bare major to the newest
// release of that line, so the oldest runtime the package claims to support is
// the one runtime nothing ever runs.
check(
  'the engines floor is an exact version',
  PACKAGE.engines.node === `>=${NODE_FLOOR}`,
  `engines.node is ${PACKAGE.engines.node}, it has to be >=${NODE_FLOOR}`
);
check(
  'CI runs the exact floor version, not the newest release of that line',
  WORKFLOW.includes(`'${NODE_FLOOR}'`),
  `${NODE_FLOOR} does not appear in the workflow`
);
const nodeVersions = Array.from(WORKFLOW.matchAll(/node(?:-version)?:\s*\[?([^\]\n]+)\]?/g))
  .flatMap((m) => m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')))
  .filter((v) => v !== '' && !v.startsWith('$'));
check('the workflow names some Node versions', nodeVersions.length > 0, 'none found');
noneOf(
  'no CI job names a bare major version',
  nodeVersions,
  (v) => !/^\d+\.\d+\.\d+$/.test(v),
  (v) => `node-version ${v} is not an exact triple`
);

// --------------------------------------------------------------- CI itself

// npm run writes a banner to stdout, so a step that redirects an npm run
// captures the banner along with the output and compares the wrong thing.
noneOf(
  'no CI step redirects the output of an npm run',
  WORKFLOW.split('\n'),
  (line) => /npm run\b/.test(line) && /[>|]/.test(line.replace(/\|$/, '')),
  (line) => line.trim().slice(0, 60)
);
for (const script of ['test', 'verify', 'check:exit-codes', 'check:entries', 'count:tests', 'check:baseline']) {
  check(`package.json declares the ${script} script`, typeof PACKAGE.scripts[script] === 'string');
}
// Comment lines are dropped first. Scanning the whole file picked the words
// "npm run writes a banner" out of a comment and reported a script named
// writes, which is a verifier finding a defect in itself.
const workflowCommands = WORKFLOW.split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .flatMap((line) => Array.from(line.matchAll(/npm run ([a-z][a-z:-]*)/g)).map((m) => m[1]));
check('CI runs some npm scripts', workflowCommands.length > 3, `${workflowCommands.length} found`);
noneOf(
  'every script CI runs is declared in package.json',
  workflowCommands,
  (name) => PACKAGE.scripts[name] === undefined,
  (name) => `npm run ${name} is not a script`
);

// --------------------------------------------------------------- required sections

for (const heading of ['## Verifying', '## Examples', '## What this does not do', '## Licence']) {
  check(`the README has a ${heading} section`, README.includes(heading));
}
check('the licence is MIT', readFileSync(join(ROOT, 'LICENSE'), 'utf8').includes('MIT License'));
check('package.json declares the MIT licence', PACKAGE.license === 'MIT');
check('the package has no dependencies', PACKAGE.dependencies === undefined);
check(
  'docs/limits.md is a real account rather than a gesture',
  readFileSync(join(ROOT, 'docs', 'limits.md'), 'utf8').length > 2000
);

// --------------------------------------------------------------- counts in the README

statedNumber('finding count', /\*\*(\d+) catalogued findings\*\*/, findings.length);
statedNumber('area count', /\*\*(\d+) areas\*\*/, AREAS.length);
statedNumber('pair count', /\*\*(\d+) failing and corrected example pairs\*\*/, PAIRS.length);
statedNumber('fixture count', /\*\*(\d+) single reason fixtures\*\*/, FIXTURES.length);
statedNumber('count of findings the pairs reach', /pairs reach (\d+) of them/, reachedByPairs().length);
statedNumber('declared limit count', /\*\*(\d+) declared limits\*\*/, LIMITS.length);
statedNumber('test count', /\*\*(\d+) tests\*\*/, testCount);
statedNumber('test count in the Verifying section', /npm test\s+# (\d+) tests/, testCount);

// The assertion total, last, because it includes the two assertions this line
// makes. It must not depend on whether anything above passed, which is why
// nothing above is conditional.
statedNumber('repository assertion count', /\*\*(\d+) repository assertions\*\*/, assertions + 2);

// --------------------------------------------------------------- report

if (failures.length > 0) {
  process.stderr.write(`${failures.length} of ${assertions} assertions failed:\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Repository verifier: ${assertions} assertions, all passing.\n`);
  process.stdout.write(
    `  ${findings.length} findings across ${AREAS.length} areas, ${FIXTURES.length} fixtures, ` +
      `${PAIRS.length} example pairs, ${LIMITS.length} declared limits, ${testCount} tests.\n`
  );
}
