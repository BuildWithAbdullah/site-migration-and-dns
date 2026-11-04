import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { exampleNames, materialise, declaredFindings, BASELINE_DIR, EXAMPLES_DIR } from '../tools/example.mjs';
import { PAIRS, pairNames, pairFor, expectedIds } from '../tools/pairs.mjs';
import { loadMigration, runChecks } from '../src/run.mjs';

const NOW = '2026-10-01T00:00:00Z';
const run = (name, variant) => runChecks(loadMigration(materialise(name, variant)), { now: NOW });

function severityMapOf(result) {
  const out = {};
  for (const finding of result.findings) out[finding.id] = finding.severity;
  return out;
}

// Each pair is checked three ways against the same claim: what the checks
// actually produce, what tools/pairs.mjs declares as id to severity, and what
// the example's own README tells a reader in prose. The prose is what somebody
// browsing the repository believes, so it is held to the same standard as the
// machine readable copy. Any one of the three drifting fails here.

test('the examples directory and the pair manifest are the same set', () => {
  assert.deepEqual(exampleNames(), pairNames().slice().sort());
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

for (const pair of PAIRS) {
  const { name } = pair;

  test(`${name}: the failing side raises exactly the manifest, severities included`, () => {
    assert.deepEqual(severityMapOf(run(name, 'fail')), pair.findings);
  });

  test(`${name}: the README prose names exactly the same findings as the manifest`, () => {
    assert.deepEqual(
      declaredFindings(name),
      expectedIds(name, 'fail'),
      'the prose a reader sees and the set the suite checks have to be the same set'
    );
  });

  test(`${name}: the corrected side raises nothing at all`, () => {
    assert.deepEqual(
      run(name, 'pass').findings.map((f) => `${f.id} at ${f.where}`),
      [],
      'a corrected example that still trips a check is not a correction'
    );
  });

  test(`${name}: has a README explaining why the failing case happens`, () => {
    assert.ok(existsSync(join(EXAMPLES_DIR, name, 'README.md')));
  });
}

test('no corrected example trips a check belonging to another example', () => {
  // Each pass variant is run against the whole suite of checks, not only the
  // one its own example is about. Without this, a corrected page can quietly
  // carry somebody else's defect.
  for (const name of pairNames()) {
    const result = run(name, 'pass');
    assert.equal(result.findings.length, 0, `${name}/pass tripped ${Object.keys(severityMapOf(result)).join(', ')}`);
  }
});

test('every pair demonstrates at least one finding, and no pair is a duplicate of another', () => {
  const sets = new Map();
  for (const name of pairNames()) {
    const ids = expectedIds(name, 'fail');
    assert.ok(ids.length > 0, `${name} demonstrates nothing`);
    const key = ids.join(',');
    assert.ok(!sets.has(key), `${name} demonstrates exactly what ${sets.get(key)} already does`);
    sets.set(key, name);
  }
});

test('no pair names a finding that is not in its own manifest entry', () => {
  for (const name of pairNames()) {
    const declared = Object.keys(pairFor(name).findings);
    for (const id of declaredFindings(name)) {
      assert.ok(declared.includes(id), `${name}/README.md claims ${id}, which the manifest does not`);
    }
  }
});
