#!/usr/bin/env node
// Run the real binary, the actual file a user executes, over every side of every
// example pair, and check the exit code against one derived from the pair
// manifest and the severity order.
//
// Two separate things make this worth a tool of its own.
//
// The first is that the file npm installs as the command was, until this was
// written, covered by node --check and by nothing else. node --check proves a
// file parses. A sibling repository shipped a binary that printed nothing and
// exited 0 for every user who installed it the documented way, for the whole
// life of the package, while its whole test suite passed, because the only
// defect was in the line deciding whether the file had been invoked directly.
// Nothing short of running the installed command can catch that, so this runs
// it, and the suite also runs it through a symlink, which is how npm installs a
// bin and the exact condition that broke the sibling.
//
// The second is that the expected exit code is computed rather than recorded.
// A tool carrying a list of expected codes agrees with itself: change the
// severity of a finding and the list is wrong and nothing says so. Here the
// code comes from the manifest, so changing a severity changes the expectation
// in the same move.

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

import { SEVERITIES } from '../src/catalog.mjs';
import { pairNames, expectedExitCode } from './pairs.mjs';
import { materialise } from './example.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BINARY = join(ROOT, 'bin', 'migrate-check.mjs');
const NOW = '2026-10-01T00:00:00Z';

/** Run the binary itself. The path given is what is executed, so a symlink is honoured. */
export function runBinary(binary, args) {
  const result = spawnSync(process.execPath, [binary, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Every case this tool checks: both sides of every pair, at every threshold.
 * Every threshold is included rather than only the default, because the whole
 * point of the derivation is that it tracks the severity order, and a single
 * threshold would exercise one row of it.
 */
export function cases() {
  const out = [];
  for (const name of pairNames()) {
    for (const side of ['fail', 'pass']) {
      for (const threshold of SEVERITIES) {
        out.push({ name, side, threshold, expected: expectedExitCode(name, side, threshold) });
      }
    }
  }
  return out;
}

export function checkCase({ name, side, threshold, expected }, binary = BINARY) {
  const dir = materialise(name, side);
  const run = runBinary(binary, [dir, '--now', NOW, '--fail-on', threshold]);
  const problems = [];
  if (run.code !== expected) {
    problems.push(`exited ${run.code}, the manifest says ${expected} at threshold ${threshold}`);
  }
  // A command that exits correctly and prints nothing is the failure mode this
  // tool exists for, so the output is checked as well as the status.
  if (run.stdout.trim() === '') problems.push('printed nothing on stdout');
  return { name, side, threshold, expected, got: run.code, problems };
}

export function checkAll(binary = BINARY) {
  return cases().map((c) => checkCase(c, binary));
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
  const results = checkAll();
  const failed = results.filter((r) => r.problems.length > 0);
  for (const r of failed) {
    process.stderr.write(`${r.name}/${r.side} at ${r.threshold}: ${r.problems.join('; ')}\n`);
  }
  if (failed.length > 0) {
    process.stderr.write(`${failed.length} of ${results.length} binary runs were wrong\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Exit codes: ${results.length} runs of the real binary, every status derived from the pair manifest.\n`
    );
  }
}
