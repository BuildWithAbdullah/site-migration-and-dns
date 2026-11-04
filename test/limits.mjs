import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, headingsInDocument } from '../tools/limits.mjs';

// Both directions, for every declared limit.
//
// The blind side proves the limit is real: the finding the limit says is out of
// reach must be absent for an input that would need it. The covered side proves
// the limit is narrow: the nearest input the tool does judge must still produce
// the finding. Only the pair means anything. A blind side on its own is
// satisfied by a check that has been deleted.

const idsOf = (findings) => findings.map((f) => f.id);

test('docs/limits.md and the asserted limits are the same set', () => {
  assert.deepEqual(
    headingsInDocument().sort(),
    LIMITS.map((l) => l.heading).sort(),
    'a limit stated in the document with nothing asserting it, or the other way round'
  );
});

for (const limit of LIMITS) {
  test(`limit: ${limit.heading}, the blind side really is blind`, () => {
    const result = limit.blind();
    const ids = idsOf(result.findings);
    if (limit.absent === 'any finding at all') {
      assert.deepEqual(ids, [], 'this input must produce nothing at all');
      assert.ok(result.note.length > 0, 'and it has to say which checks did not run');
    } else {
      assert.ok(
        !ids.includes(limit.absent),
        `${limit.absent} was reported for an input the limit says cannot be judged: got ${ids.join(', ')}`
      );
    }
  });

  test(`limit: ${limit.heading}, the covered side is still covered`, () => {
    const covered = limit.covered();
    if (limit.present === undefined) {
      assert.deepEqual(covered, [], limit.expectCovered);
      return;
    }
    assert.ok(
      idsOf(covered).includes(limit.present),
      `${limit.present} should be reported for the nearest input this tool does judge, got ${idsOf(covered).join(', ')}`
    );
  });

  if (limit.alsoAssert) {
    test(`limit: ${limit.heading}, and ${limit.alsoAssert().what}`, () => {
      const extra = limit.alsoAssert();
      const ids = idsOf(extra.findings);
      if (extra.present) assert.ok(ids.includes(extra.present), `expected ${extra.present}, got ${ids.join(', ')}`);
      if (extra.absent) assert.ok(!ids.includes(extra.absent), `${extra.absent} should not be reported`);
    });
  }
}

test('every limit states which finding it is about, so the assertion cannot be vacuous', () => {
  for (const limit of LIMITS) {
    assert.equal(typeof limit.heading, 'string');
    assert.ok(limit.heading.length > 10);
    assert.ok(typeof limit.absent === 'string' && limit.absent.length > 0);
  }
});

test('there are enough limits that the document is a real account rather than a gesture', () => {
  assert.ok(LIMITS.length >= 10);
  assert.equal(LIMITS.length, headingsInDocument().length);
});
