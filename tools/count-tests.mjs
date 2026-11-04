#!/usr/bin/env node
// Count the tests in the suite, on every Node version this repository supports,
// by running it under the reporter next door and reading the one line it prints.
//
// The reporter is spawned rather than imported. Importing the reporter module
// into the process that then spawns node --test with that same module as
// --test-reporter has been observed to stop the run finishing altogether, with
// no output and no error, so the two never share a process.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTER = join(ROOT, 'tools', 'test-count-reporter.mjs');

/** The test files, taken from the test script so the two cannot disagree. */
export function testFilesFromPackage() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const script = pkg.scripts.test;
  const files = script.match(/test\/[A-Za-z0-9_.-]+\.mjs/g) ?? [];
  return Array.from(new Set(files));
}

/**
 * Returns { passed, failed, files }. Throws when the suite could not be counted
 * at all, which is different from the suite failing.
 */
export function countTests(files = testFilesFromPackage()) {
  if (files.length === 0) throw new Error('no test files to count');
  const result = spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024
  });
  const line = /^TESTCOUNT (\d+) (\d+)$/m.exec(result.stdout ?? '');
  if (!line) {
    throw new Error(
      `the counting reporter printed nothing usable. stderr tail: ${(result.stderr ?? '').slice(-300)}`
    );
  }
  const passed = Number(line[1]);
  const failed = Number(line[2]);
  // Zero is never a real answer here, and a zero reaching a README unnoticed is
  // exactly the failure this guard exists for.
  if (passed === 0 && failed === 0) throw new Error('the reporter counted no tests at all');
  return { passed, failed, files };
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const { passed, failed } = countTests();
  process.stdout.write(`${passed} tests passed, ${failed} failed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}
