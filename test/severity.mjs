import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allFindings, SEVERITIES, describe } from '../src/catalog.mjs';
import { FIXTURES, observedOf } from '../tools/fixtures.mjs';
import { PAIRS } from '../tools/pairs.mjs';

// The severity table, asserted in both directions.
//
// Every finding in this repository carries the severity its catalogue entry
// declares, which makes one direction easy: nothing raised may carry a severity
// the catalogue did not give it. The direction that does the work is the other
// one. A severity written in the catalogue and never produced by anything is a
// claim with nothing behind it, and it is also what the exit code of every
// example is derived from, so an entry whose severity has never been observed
// is an entry that could be wrong without any test noticing.

function observedSeverities() {
  const seen = new Map();
  const record = (id, severity, source) => {
    const existing = seen.get(id);
    if (existing && existing.severity !== severity) {
      throw new Error(
        `${id} was produced at ${existing.severity} by ${existing.source} and at ${severity} by ${source}`
      );
    }
    seen.set(id, { severity, source });
  };
  for (const fixture of FIXTURES) {
    const got = observedOf(fixture);
    for (const [id, severity] of Object.entries(got)) record(id, severity, `fixture ${fixture.reason}`);
  }
  for (const pair of PAIRS) {
    for (const [id, severity] of Object.entries(pair.findings)) record(id, severity, `pair ${pair.name}`);
  }
  return seen;
}

test('every severity a finding is produced at is the severity its catalogue entry declares', () => {
  for (const [id, { severity, source }] of observedSeverities()) {
    assert.equal(severity, describe(id).severity, `${id} was produced at ${severity} by ${source}`);
  }
});

test('every severity the catalogue declares has actually been produced by something', () => {
  const observed = observedSeverities();
  const unproven = allFindings()
    .filter((f) => !observed.has(f.id))
    .map((f) => `${f.id} (declared ${f.severity})`);
  assert.deepEqual(
    unproven,
    [],
    'these entries declare a severity that no fixture and no pair has ever produced, so the exit codes derived from them are unchecked'
  );
});

test('every severity in the order is used by at least one finding, so the order has no dead rungs', () => {
  const used = new Set(allFindings().map((f) => f.severity));
  assert.deepEqual(SEVERITIES.filter((s) => !used.has(s)), []);
});

test('every catalogue entry declares a severity that is in the order', () => {
  for (const finding of allFindings()) {
    assert.ok(SEVERITIES.includes(finding.severity), `${finding.id} declares ${finding.severity}`);
  }
});

test('the pair manifest and the catalogue agree about severity', () => {
  for (const pair of PAIRS) {
    for (const [id, severity] of Object.entries(pair.findings)) {
      assert.equal(
        severity,
        describe(id).severity,
        `the manifest for ${pair.name} says ${id} is ${severity}, the catalogue says ${describe(id).severity}`
      );
    }
  }
});
