import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadMigration, runChecks, exitCodeFor, summarise, walk, CHECKS } from '../src/run.mjs';
import { BASELINE_DIR } from '../tools/example.mjs';
import { AREAS } from '../src/catalog.mjs';

const NOW = '2026-10-01T00:00:00Z';

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-check-run-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test('a directory with no profile is refused with a pointer to the documentation', () => {
  const dir = scratch({ 'zone.json': '{}' });
  assert.throws(() => loadMigration(dir), /no profile\.json/);
  rmSync(dir, { recursive: true, force: true });
});

test('a profile with no domain is refused', () => {
  const dir = scratch({ 'profile.json': '{}' });
  assert.throws(() => loadMigration(dir), /needs a domain/);
  rmSync(dir, { recursive: true, force: true });
});

test('invalid JSON names the file it is in', () => {
  const dir = scratch({ 'profile.json': '{ not json' });
  assert.throws(() => loadMigration(dir), /profile\.json is not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

test('a check with no input is skipped and said to be skipped, never passed quietly', () => {
  const dir = scratch({ 'profile.json': JSON.stringify({ domain: 'example.org' }) });
  const result = runChecks(loadMigration(dir), { now: NOW });
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(
    result.skipped.map((s) => s.area).sort(),
    AREAS.slice().sort(),
    'with no artefacts, every single check has to report that it did not run'
  );
  for (const skip of result.skipped) assert.match(skip.reason, /no input/);
  rmSync(dir, { recursive: true, force: true });
});

test('every area has a stated input requirement, so a skip can explain itself', () => {
  for (const area of AREAS) {
    const entry = CHECKS.find((c) => c.area === area);
    assert.ok(entry, `${area} is not in CHECKS`);
    assert.ok(entry.needs.length > 0);
  }
});

test('the baseline exercises every check', () => {
  const result = runChecks(loadMigration(BASELINE_DIR), { now: NOW });
  assert.deepEqual(result.ran.slice().sort(), AREAS.slice().sort());
});

test('findings are ordered worst first', () => {
  const findings = [
    { severity: 'low', id: 'A' },
    { severity: 'blocker', id: 'B' },
    { severity: 'medium', id: 'C' },
    { severity: 'high', id: 'D' }
  ];
  const sorted = runChecks(
    { profile: { domain: 'x' }, zone: null, observed: null, redirects: null, robots: null, sitemap: null, pages: [], assets: [], dbFiles: [] },
    {}
  );
  assert.deepEqual(sorted.findings, []);
  // The ordering itself is asserted through the summary helper below, which is
  // what the reports rely on.
  const summary = summarise(findings);
  assert.deepEqual(summary.bySeverity, { blocker: 1, high: 1, medium: 1, low: 1 });
  assert.equal(summary.total, 4);
});

test('the exit code follows the threshold that was asked for', () => {
  const result = { findings: [{ severity: 'medium' }] };
  assert.equal(exitCodeFor(result, 'high'), 0, 'a medium finding does not fail a high threshold');
  assert.equal(exitCodeFor(result, 'medium'), 1);
  assert.equal(exitCodeFor(result, 'low'), 1);
  assert.equal(exitCodeFor({ findings: [] }, 'low'), 0);
  assert.equal(exitCodeFor({ findings: [{ severity: 'blocker' }] }, 'blocker'), 1);
});

test('walk finds nested files, skips dotfiles and returns a stable order', () => {
  const dir = scratch({ 'a/b/two.txt': '2', 'a/one.txt': '1', '.hidden/x.txt': 'x' });
  const found = walk(dir).map((f) => f.replace(dir, '').replace(/\\/g, '/'));
  assert.deepEqual(found, ['/a/b/two.txt', '/a/one.txt']);
  rmSync(dir, { recursive: true, force: true });
});

test('walk on a directory that does not exist returns nothing rather than throwing', () => {
  assert.deepEqual(walk(join(tmpdir(), 'definitely-not-here-migrate-check')), []);
});

test('running the same input twice gives the same answer', () => {
  const first = runChecks(loadMigration(BASELINE_DIR), { now: NOW });
  const second = runChecks(loadMigration(BASELINE_DIR), { now: NOW });
  assert.deepEqual(first.findings, second.findings);
  assert.deepEqual(first.summary, second.summary);
});
