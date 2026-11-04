import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findingIds, allFindings, AREAS } from '../src/catalog.mjs';
import { FIXTURES, observedOf } from '../tools/fixtures.mjs';
import { reachedByPairs } from '../tools/pairs.mjs';

// The catalogue is the claim this repository makes about what it can find. These
// tests are what turn each entry from a paragraph into a check with a driven
// input behind it, and they do it by comparing complete sets rather than by
// asking whether the finding appeared somewhere in the output.

test('every fixture produces exactly the findings it declares, and no others', () => {
  for (const fixture of FIXTURES) {
    assert.deepEqual(
      observedOf(fixture),
      fixture.expect,
      `${fixture.reason} (${fixture.why}) did not produce its declared set`
    );
  }
});

test('every fixture produces the reason it was written for', () => {
  for (const fixture of FIXTURES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(fixture.expect, fixture.reason),
      `the fixture for ${fixture.reason} does not declare ${fixture.reason} among its findings`
    );
  }
});

test('there is exactly one fixture per catalogued reason', () => {
  const reasons = FIXTURES.map((f) => f.reason).sort();
  assert.deepEqual(reasons, findingIds().sort(), 'the fixtures and the catalogue are not the same set');
  assert.equal(new Set(reasons).size, reasons.length, 'two fixtures claim the same reason');
});

test('the example pairs reach fewer findings than the fixtures, which is why both exist', () => {
  const byPairs = reachedByPairs();
  const all = findingIds();
  for (const id of byPairs) {
    assert.ok(all.includes(id), `the pair manifest names ${id}, which is not in the catalogue`);
  }
  assert.ok(
    byPairs.length < all.length,
    'if the pairs reached everything the fixtures would be redundant, and this test should be deleted'
  );
  // Stated as a fact rather than a floor, so the day the pairs do reach
  // everything the number has to be changed deliberately.
  assert.equal(byPairs.length, 48);
  assert.equal(all.length, 78);
});

test('every finding a fixture or a pair reaches is catalogued, and every area is used', () => {
  const reached = new Set([...reachedByPairs(), ...FIXTURES.flatMap((f) => Object.keys(f.expect))]);
  const all = new Set(findingIds());
  assert.deepEqual(
    Array.from(reached).filter((id) => !all.has(id)),
    [],
    'something raises a finding that is not in the catalogue'
  );
  assert.deepEqual(
    Array.from(all).filter((id) => !reached.has(id)),
    [],
    'these findings are catalogued but nothing drives them'
  );

  const used = new Set(allFindings().map((f) => f.area));
  assert.deepEqual(AREAS.filter((a) => !used.has(a)), [], 'an area is declared with no findings in it');
});

test('every fixture explains itself, so a failure says what the input was meant to be', () => {
  for (const fixture of FIXTURES) {
    assert.equal(typeof fixture.why, 'string');
    assert.ok(fixture.why.length > 20, `the fixture for ${fixture.reason} does not say what it is`);
  }
});
