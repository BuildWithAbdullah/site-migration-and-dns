// A node:test reporter that prints one line: how many individual tests passed
// and failed. Nothing else.
//
// It exists because the obvious ways to count are both version dependent. The
// text reporter prints `# tests 213` on Node 20 and 22 and `info tests 213` on
// Node 24, so a regular expression over its output finds nothing on one of the
// versions this repository supports and the counting assertion silently stops
// counting. The programmatic run() API is no better: on some lines it forwards
// one test:pass event per whole file rather than per test, and details.type is
// undefined where other lines report 'test', so filtering on it counts zero.
//
// Inside a reporter every per test event is present on every version, and the
// one field that is reliable is whether an event describes a suite. So: count
// everything that is not a suite.
//
// Beware that a test file which throws while loading arrives here as a single
// failing test, so a count from a red run is not a count of the suite. The
// caller refuses to use one.

export default async function* countingReporter(source) {
  let passed = 0;
  let failed = 0;
  for await (const event of source) {
    if (event.data?.details?.type === 'suite') continue;
    if (event.type === 'test:pass') passed += 1;
    else if (event.type === 'test:fail') failed += 1;
  }
  yield `TESTCOUNT ${passed} ${failed}\n`;
}
