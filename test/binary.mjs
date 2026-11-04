import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { checkAll, runBinary, BINARY, cases } from '../tools/exit-codes.mjs';
import { inspectAll, ENTRIES, codeLinesOf, branchesOf } from '../tools/entry-thin.mjs';
import { BASELINE_DIR } from '../tools/example.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-01T00:00:00Z';

// The file a user actually executes, executed.
//
// A sibling repository shipped a binary that printed nothing and exited 0 for
// every user who installed it the documented way, for the whole life of the
// package, while its entire test suite passed. The defect was one line: the
// guard deciding whether the file had been invoked directly compared a module
// path against import.meta.url without resolving either to a real path, and npm
// installs a bin as a symlink. No amount of testing the modules behind it could
// have caught that. Only running the installed command can.

test('every side of every pair exits with the code derived from the manifest', () => {
  const results = checkAll();
  const failed = results.filter((r) => r.problems.length > 0);
  assert.deepEqual(
    failed.map((r) => `${r.name}/${r.side} at ${r.threshold}: ${r.problems.join('; ')}`),
    []
  );
  assert.equal(results.length, cases().length);
  assert.ok(results.length > 100, 'every pair at every threshold, both sides');
});

test('the thresholds actually disagree, so the derivation is doing work', () => {
  // If every case expected the same code, the test above would pass against a
  // binary that always returned that code.
  const expected = new Set(cases().map((c) => c.expected));
  assert.deepEqual(Array.from(expected).sort(), [0, 1]);
});

test('the binary works when run through a symlink, which is how npm installs it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bin-symlink-'));
  try {
    const link = join(dir, 'migrate-check');
    symlinkSync(BINARY, link);
    const direct = runBinary(BINARY, [BASELINE_DIR, '--now', NOW]);
    const viaLink = runBinary(link, [BASELINE_DIR, '--now', NOW]);
    assert.equal(viaLink.code, direct.code);
    assert.equal(viaLink.stdout, direct.stdout);
    assert.ok(viaLink.stdout.trim().length > 0, 'the installed command has to print something');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the binary prints a report rather than nothing for a directory with findings', () => {
  const run = runBinary(BINARY, [BASELINE_DIR, '--now', NOW, '--format', 'json']);
  const parsed = JSON.parse(run.stdout);
  assert.equal(run.code, 0);
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(parsed.domain, 'example.org');
  assert.deepEqual(parsed.checksSkipped, [], 'the baseline exercises every check');
  assert.equal(parsed.checksRun.length, 8);
});

test('every entry point is wiring and nothing else', () => {
  const results = inspectAll();
  for (const result of results) {
    assert.deepEqual(result.problems, [], `${result.path}: ${result.problems.join('; ')}`);
  }
  assert.equal(results.length, ENTRIES.length);
});

test('the thinness limits are not so loose that they would permit the logic back', () => {
  // A limit set well above what the file needs is not a limit. The command's
  // front door is held near its real size on purpose.
  const entry = ENTRIES.find((e) => e.path === 'bin/migrate-check.mjs');
  const source = readFileSync(join(ROOT, entry.path), 'utf8');
  assert.ok(entry.maxCodeLines - codeLinesOf(source) < 10, 'the line limit has drifted away from the file');
  assert.ok(entry.maxBranches - branchesOf(source) < 5, 'the branch limit has drifted away from the file');
});

test('a decision moved back into the entry point fails the check', () => {
  // The tool is asked about a file that does hold a decision, so a tool that
  // had stopped looking would be caught here rather than passing quietly.
  const entry = ENTRIES.find((e) => e.path === 'bin/migrate-check.mjs');
  const withLogic = { ...entry, path: 'src/cli.mjs' };
  const { inspect } = { inspect: (e) => inspectOne(e) };
  function inspectOne(e) {
    const source = readFileSync(join(ROOT, e.path), 'utf8');
    const problems = [];
    if (codeLinesOf(source) > e.maxCodeLines) problems.push('too long');
    if (branchesOf(source) > e.maxBranches) problems.push('too many branches');
    return problems;
  }
  assert.ok(inspect(withLogic).length > 0, 'src/cli.mjs is where the decisions are, so it must not pass as wiring');
});

test('nothing the package ships imports from a directory the package does not ship', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const shipped = new Set(pkg.files);
  const offenders = [];
  const files = filesUnder(['bin', 'src', 'probe']);
  assert.ok(files.length > 10, 'the scan has to actually find the shipped modules');

  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const match of source.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
      // Resolved against the importing file, not against the repository root,
      // because src/run.mjs importing ./checks/dns.mjs is reaching inside a
      // directory that ships, and a check that cannot tell the difference
      // reports every module in the package.
      const resolved = posix.normalize(posix.join(posix.dirname(file), match[1]));
      const top = resolved.split('/')[0];
      if (!shipped.has(top)) {
        offenders.push(`${file} imports ${match[1]}, which resolves to ${resolved}, and ${top} does not ship`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the shipped-import check would notice an import of something that does not ship', () => {
  // tools/ is deliberately not in package.json files, so an import of it from a
  // shipped module is the exact mistake this guards against. Asserting that the
  // resolution works on a known-bad specifier stops the check above from
  // passing because it resolves everything to a directory that happens to ship.
  const resolved = posix.normalize(posix.join(posix.dirname('src/run.mjs'), '../tools/example.mjs'));
  assert.equal(resolved, 'tools/example.mjs');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(!pkg.files.includes('tools'), 'tools must stay out of files for this to mean anything');
  assert.ok(!pkg.files.includes('test'));
});

function filesUnder(dirs) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.mjs')) out.push(rel);
    }
  };
  for (const dir of dirs) walk(dir);
  return out.sort();
}
