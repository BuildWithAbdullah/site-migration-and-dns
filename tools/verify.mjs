#!/usr/bin/env node
// The repository verifier. Its job is to stop this repository from drifting into
// saying things about itself that are no longer true: counts in the README, a
// test file that quietly never runs, or a claim that nothing touches the network
// made in a file sitting next to one that does.
//
// It runs with no network access and no configuration, and it exits non zero on
// the first thing it cannot prove.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { allFindings, AREAS } from '../src/catalog.mjs';
import { exampleNames, declaredFindings } from './example.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

let assertions = 0;
const failures = [];

function check(label, condition, detail = '') {
  assertions += 1;
  if (!condition) failures.push(detail ? `${label}: ${detail}` : label);
}

function walk(dir, depth = 8) {
  if (depth < 0 || !existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.git')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, depth - 1));
    else if (stat.isFile()) out.push(full);
  }
  return out.sort();
}

// --------------------------------------------------------- counts in the README

const findings = allFindings();
const readmeFindingCount = /\*\*(\d+) catalogued findings\*\*/.exec(README);
check('the README states a finding count', readmeFindingCount !== null);
if (readmeFindingCount) {
  check(
    'the finding count in the README matches the catalogue',
    Number(readmeFindingCount[1]) === findings.length,
    `README says ${readmeFindingCount[1]}, catalogue has ${findings.length}`
  );
}

const readmeAreaCount = /\*\*(\d+) areas\*\*/.exec(README);
check('the README states an area count', readmeAreaCount !== null);
if (readmeAreaCount) {
  check(
    'the area count in the README matches the catalogue',
    Number(readmeAreaCount[1]) === AREAS.length,
    `README says ${readmeAreaCount[1]}, catalogue has ${AREAS.length}`
  );
}

const names = exampleNames();
const readmePairCount = /\*\*(\d+) failing and corrected example pairs\*\*/.exec(README);
check('the README states a pair count', readmePairCount !== null);
if (readmePairCount) {
  check(
    'the pair count in the README matches the examples directory',
    Number(readmePairCount[1]) === names.length,
    `README says ${readmePairCount[1]}, there are ${names.length}`
  );
}

// --------------------------------------------------------- the test suite

const testFiles = readdirSync(join(ROOT, 'test'))
  .filter((f) => extname(f) === '.mjs')
  .sort();
check('there are test files', testFiles.length > 0);

const testScript = PACKAGE.scripts.test;
check(
  'the test script does not use a glob',
  !testScript.includes('*'),
  'node --test did not accept glob patterns before Node 21, so a glob means the suite silently does not run on Node 18 or 20'
);
for (const file of testFiles) {
  check(
    `test/${file} is named in the test script`,
    testScript.includes(`test/${file}`),
    'a test file that is never run is worse than no test'
  );
}

// Run the suite and compare the tally with the number the README prints.
let ranTests = null;
try {
  const output = execFileSync(process.execPath, ['--test', ...testFiles.map((f) => join('test', f))], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const pass = /^# pass (\d+)$/m.exec(output);
  const fail = /^# fail (\d+)$/m.exec(output);
  ranTests = pass ? Number(pass[1]) : null;
  check('every test passes', fail !== null && Number(fail[1]) === 0, `${fail ? fail[1] : 'unknown'} failing`);
} catch (error) {
  check('the test suite runs', false, (error.stdout ?? error.message).slice(-400));
}

const readmeTestCount = /\*\*(\d+) tests\*\*/.exec(README);
check('the README states a test count', readmeTestCount !== null);
if (readmeTestCount && ranTests !== null) {
  check(
    'the test count in the README matches the suite',
    Number(readmeTestCount[1]) === ranTests,
    `README says ${readmeTestCount[1]}, the suite ran ${ranTests}`
  );
}
const verifyingCount = /npm test\s+# (\d+) tests/.exec(README);
if (verifyingCount && ranTests !== null) {
  check(
    'the count in the Verifying section matches the suite',
    Number(verifyingCount[1]) === ranTests,
    `Verifying says ${verifyingCount[1]}, the suite ran ${ranTests}`
  );
}

// --------------------------------------------------------- the network claim

// The README says the judgement is a pure function and only probe/ touches the
// network. This is where that claim is kept honest rather than asserted.
const NETWORK_PATTERNS = [
  [/from\s+'node:(dns|https?|net|tls|dgram)'/, 'imports a network module'],
  [/require\(['"]node:(dns|https?|net|tls|dgram)['"]\)/, 'requires a network module'],
  [/\bfetch\s*\(/, 'calls fetch'],
  [/\bXMLHttpRequest\b/, 'references XMLHttpRequest'],
  [/child_process/, 'spawns a process']
];
const WRITE_PATTERNS = [
  [/\bwriteFileSync\b|\bwriteFile\b/, 'writes a file'],
  [/\bappendFileSync\b|\bappendFile\b/, 'appends to a file'],
  [/\brmSync\b|\bunlinkSync\b|\brmdirSync\b/, 'deletes a file'],
  [/\bmkdirSync\b/, 'creates a directory']
];

for (const dir of ['src', 'bin']) {
  for (const file of walk(join(ROOT, dir))) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).split('\\').join('/');
    for (const [pattern, what] of [...NETWORK_PATTERNS, ...WRITE_PATTERNS]) {
      check(`${rel} does not touch the network or the filesystem for writing`, !pattern.test(source), what);
    }
  }
}

// And the other half: the collector has to be where the network access lives, or
// the separation above is only true because nothing collects anything.
const probe = readFileSync(join(ROOT, 'probe', 'collect.mjs'), 'utf8');
check(
  'probe/collect.mjs is the part that does reach the network',
  /from 'node:dns'/.test(probe) && /from 'node:tls'/.test(probe),
  'the separation is meaningless if nothing collects'
);

// --------------------------------------------------------- the examples

for (const name of names) {
  for (const part of ['README.md', 'fail', 'pass']) {
    check(`examples/${name} has ${part}`, existsSync(join(ROOT, 'examples', name, part)));
  }
  const declared = declaredFindings(name);
  check(`examples/${name} names the findings it demonstrates`, declared.length > 0);
  for (const id of declared) {
    check(
      `examples/${name} names a finding that exists`,
      findings.some((f) => f.id === id),
      `${id} is not in the catalogue`
    );
  }
}
check('the baseline exists', existsSync(join(ROOT, 'examples', 'baseline', 'profile.json')));

// Every example must be listed in the README table, or the table is a partial
// index that reads like a complete one.
for (const name of names) {
  check(`the README lists examples/${name}`, README.includes(`\`${name}\``));
}

// --------------------------------------------------------- house style

const DASHES = [
  ['\u2014', 'em dash'],
  ['\u2013', 'en dash']
];
const textFiles = walk(ROOT).filter((f) => ['.mjs', '.md', '.json', '.yml', '.html', '.css', '.txt', '.sql', '.xml'].includes(extname(f)));
for (const file of textFiles) {
  const source = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).split('\\').join('/');
  for (const [char, label] of DASHES) {
    check(`${rel} has no ${label}`, !source.includes(char));
  }
}

// --------------------------------------------------------- required sections

for (const heading of ['## Verifying', '## Examples', '## What this does not do', '## Licence']) {
  check(`the README has a ${heading} section`, README.includes(heading));
}
check('the licence is MIT', readFileSync(join(ROOT, 'LICENSE'), 'utf8').includes('MIT License'));
check('package.json declares the MIT licence', PACKAGE.license === 'MIT');
check('the package supports Node 18', PACKAGE.engines.node.includes('18'));
check('the package has no dependencies', PACKAGE.dependencies === undefined);
check('docs/limits.md exists and says something', readFileSync(join(ROOT, 'docs', 'limits.md'), 'utf8').length > 2000);

// --------------------------------------------------------- report

if (failures.length > 0) {
  process.stderr.write(`${failures.length} of ${assertions} assertions failed:\n`);
  for (const failure of failures) process.stderr.write(`  ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Repository verifier: ${assertions} assertions, all passing.\n`);
  process.stdout.write(
    `  ${findings.length} findings across ${AREAS.length} areas, ${names.length} example pairs, ${ranTests} tests.\n`
  );
}
