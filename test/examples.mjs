import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { exampleNames, materialise, declaredFindings, BASELINE_DIR, EXAMPLES_DIR } from '../tools/example.mjs';
import { loadMigration, runChecks } from '../src/run.mjs';

const NOW = '2026-10-01T00:00:00Z';
const run = (name, variant) => runChecks(loadMigration(materialise(name, variant)), { now: NOW });
const idsOf = (result) => Array.from(new Set(result.findings.map((f) => f.id))).sort();

test('there are examples to check', () => {
  assert.ok(exampleNames().length >= 10, 'the pairs are the evidence, so there has to be a set of them');
});

test('the baseline has nothing wrong with it, so every finding comes from an overlay', () => {
  const result = runChecks(loadMigration(BASELINE_DIR), { now: NOW });
  assert.deepEqual(
    result.findings.map((f) => `${f.id} ${f.where}`),
    [],
    'a baseline with a defect in it would make every example unreadable'
  );
  assert.deepEqual(result.skipped, [], 'the baseline has to exercise every check');
});

for (const name of exampleNames()) {
  test(`${name}: the failing variant raises exactly what its README claims`, () => {
    const got = idsOf(run(name, 'fail'));
    const want = declaredFindings(name);
    assert.ok(want.length > 0, 'the README has to name the findings');
    assert.deepEqual(got, want);
  });

  test(`${name}: the corrected variant raises nothing at all`, () => {
    const result = run(name, 'pass');
    assert.deepEqual(
      result.findings.map((f) => `${f.id} at ${f.where}`),
      [],
      'a corrected example that still trips a check is not a correction'
    );
  });

  test(`${name}: has a README explaining why the failing case happens`, () => {
    const readme = join(EXAMPLES_DIR, name, 'README.md');
    assert.ok(existsSync(readme));
  });
}

test('no corrected example trips a check belonging to another example', () => {
  // Each pass variant is run against the whole suite of checks, not only the
  // one its own example is about. Without this, a corrected page can quietly
  // carry somebody else's defect.
  for (const name of exampleNames()) {
    const result = run(name, 'pass');
    assert.equal(result.findings.length, 0, `${name}/pass tripped ${idsOf(result).join(', ')}`);
  }
});

test('every example demonstrates at least one finding that the pair fixes', () => {
  for (const name of exampleNames()) {
    assert.ok(run(name, 'fail').findings.length > 0, `${name}/fail demonstrates nothing`);
  }
});
