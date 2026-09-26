import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allFindings, findingIds, describe, raise, countByArea, SEVERITIES, AREAS } from '../src/catalog.mjs';

// Built from code points rather than written out, so that this file, which
// forbids those two characters, does not itself contain them.
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

test('every finding id is unique', () => {
  const ids = findingIds();
  assert.equal(new Set(ids).size, ids.length);
});

test('every finding carries an action and a limit, not just a complaint', () => {
  for (const f of allFindings()) {
    assert.ok(f.title.length > 10, `${f.id} has no usable title`);
    assert.ok(SEVERITIES.includes(f.severity), `${f.id} has severity ${f.severity}`);
    assert.ok(AREAS.includes(f.area), `${f.id} has area ${f.area}`);
    assert.ok(f.nextAction.length > 40, `${f.id} nextAction is too short to act on`);
    assert.ok(f.doesNotProve.length > 20, `${f.id} does not say what it fails to prove`);
  }
});

test('no finding text contains an em dash or an en dash', () => {
  for (const f of allFindings()) {
    const text = `${f.title} ${f.nextAction} ${f.doesNotProve}`;
    assert.ok(!text.includes(EM_DASH), `${f.id} contains an em dash`);
    assert.ok(!text.includes(EN_DASH), `${f.id} contains an en dash`);
  }
});

test('raise copies the catalogue entry and attaches evidence', () => {
  const finding = raise('DNS001', { where: 'example.org', detail: 'apex CNAME', line: 12 });
  assert.equal(finding.id, 'DNS001');
  assert.equal(finding.severity, describe('DNS001').severity);
  assert.equal(finding.where, 'example.org');
  assert.equal(finding.line, 12);
  assert.equal(finding.nextAction, describe('DNS001').nextAction);
});

test('raising an id that is not catalogued fails loudly', () => {
  assert.throws(() => raise('NOPE001', { where: 'x' }), /Unknown finding id/);
});

test('every area has at least one finding', () => {
  const counts = countByArea();
  for (const area of AREAS) assert.ok(counts[area] > 0, `${area} has no findings`);
});
