import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import { materialise, BASELINE_DIR } from '../tools/example.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'migrate-check.mjs');
const NOW = '2026-10-01T00:00:00Z';

function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('a clean directory exits 0', () => {
  const result = cli([BASELINE_DIR, '--now', NOW]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No findings/);
});

test('a directory with a blocker exits 1', () => {
  const result = cli([materialise('01-apex-cname', 'fail'), '--now', NOW]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /DNS001/);
});

test('the threshold changes the exit code without changing the report', () => {
  const dir = materialise('02-ttl-staging', 'fail');
  const high = cli([dir, '--now', NOW, '--fail-on', 'high']);
  const blockerOnly = cli([dir, '--now', NOW, '--fail-on', 'blocker']);
  assert.equal(high.code, 1);
  assert.equal(blockerOnly.code, 0, 'the worst TTL finding is high, not a blocker');
  assert.equal(high.stdout, blockerOnly.stdout);
});

test('json output is valid json on stdout', () => {
  const result = cli([materialise('07-redirect-map-coverage', 'fail'), '--now', NOW, '--format', 'json']);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.findings.length > 0);
});

test('markdown output is produced', () => {
  const result = cli([materialise('08-mixed-content', 'fail'), '--now', NOW, '--format', 'markdown']);
  assert.match(result.stdout, /^# Migration check/m);
});

test('help exits 0 and no directory exits 2', () => {
  assert.equal(cli(['--help']).code, 0);
  assert.equal(cli([]).code, 2);
});

test('an unknown option, format or severity exits 2 with a message', () => {
  assert.equal(cli(['--nope']).code, 2);
  const badFormat = cli([BASELINE_DIR, '--format', 'yaml']);
  assert.equal(badFormat.code, 2);
  assert.match(badFormat.stderr, /unknown format/);
  const badSeverity = cli([BASELINE_DIR, '--fail-on', 'annoying']);
  assert.equal(badSeverity.code, 2);
  assert.match(badSeverity.stderr, /unknown severity/);
});

test('a directory that is not a migration directory exits 2 rather than 1', () => {
  const result = cli([dirname(CLI)]);
  assert.equal(result.code, 2, 'a usage problem is not a finding');
  assert.match(result.stderr, /no profile\.json/);
});

test('two directories at once is refused', () => {
  const result = cli([BASELINE_DIR, BASELINE_DIR]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /one directory/);
});
