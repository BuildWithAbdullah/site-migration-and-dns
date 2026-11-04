import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, runCli, EXIT, USAGE } from '../src/cli.mjs';

// The command's decisions, driven directly rather than through a process.
//
// Starting a process to ask what a function returns for a given argument list
// is slow and, more to the point, coarse: it can only reach the combinations
// somebody thought to spawn. These call runCli with stub streams and stub
// dependencies, so a branch is one line of test rather than one process.

function streams() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    stdout: { write: (text) => { out.stdout += text; } },
    stderr: { write: (text) => { out.stderr += text; } }
  };
}

const SEVERITIES = ['blocker', 'high', 'medium', 'low'];

function deps(overrides = {}) {
  const { stdout, stderr, out } = streams();
  const calls = { loaded: [], ran: [] };
  return {
    out,
    calls,
    deps: {
      stdout,
      stderr,
      severities: SEVERITIES,
      formats: {
        text: (result) => `text:${result.findings.length}`,
        json: (result) => JSON.stringify(result)
      },
      loadMigration: (dir) => {
        calls.loaded.push(dir);
        return { profile: { domain: 'example.org' } };
      },
      runChecks: (input, options) => {
        calls.ran.push(options);
        return { findings: [], skipped: [], profile: input.profile };
      },
      exitCodeFor: () => EXIT.clean,
      ...overrides
    }
  };
}

test('parseArgs reads a directory and the defaults', () => {
  const parsed = parseArgs(['./site']);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.options, { dir: './site', format: 'text', failOn: 'high', now: undefined, help: false });
});

test('parseArgs reads every option', () => {
  const parsed = parseArgs(['./site', '--format', 'json', '--fail-on', 'low', '--now', '2026-01-01T00:00:00Z']);
  assert.ok(parsed.ok);
  assert.equal(parsed.options.format, 'json');
  assert.equal(parsed.options.failOn, 'low');
  assert.equal(parsed.options.now, '2026-01-01T00:00:00Z');
});

test('parseArgs accepts the options in any order, before or after the directory', () => {
  const before = parseArgs(['--format', 'json', './site']);
  const after = parseArgs(['./site', '--format', 'json']);
  assert.ok(before.ok && after.ok);
  assert.deepEqual(before.options, after.options);
});

test('parseArgs refuses an option with nothing after it rather than swallowing undefined', () => {
  for (const flag of ['--format', '--fail-on', '--now']) {
    const parsed = parseArgs(['./site', flag]);
    assert.equal(parsed.ok, false, `${flag} with no value should be refused`);
    assert.match(parsed.message, /needs a value/);
  }
});

test('parseArgs refuses an option whose value is itself an option', () => {
  const parsed = parseArgs(['./site', '--format', '--fail-on', 'low']);
  assert.equal(parsed.ok, false);
});

test('parseArgs refuses an unknown option and a second directory', () => {
  assert.equal(parseArgs(['--nope']).ok, false);
  assert.match(parseArgs(['--nope']).message, /unknown option/);
  assert.equal(parseArgs(['./a', './b']).ok, false);
  assert.match(parseArgs(['./a', './b']).message, /one directory/);
});

test('parseArgs reads help in either spelling, wherever it appears', () => {
  for (const argv of [['--help'], ['-h'], ['./site', '--help']]) {
    assert.equal(parseArgs(argv).options.help, true);
  }
});

test('help prints the usage on stdout and exits 0', () => {
  const { out, deps: d } = deps();
  assert.equal(runCli(['--help'], d), EXIT.clean);
  assert.equal(out.stdout, USAGE);
  assert.equal(out.stderr, '');
});

test('no directory prints the usage and exits 2, because it is a usage error', () => {
  const { out, deps: d } = deps();
  assert.equal(runCli([], d), EXIT.usage);
  assert.equal(out.stdout, USAGE);
});

test('an unparsable command line goes to stderr with the usage after it', () => {
  const { out, deps: d } = deps();
  assert.equal(runCli(['--nope'], d), EXIT.usage);
  assert.match(out.stderr, /unknown option --nope/);
  assert.match(out.stderr, /Usage: migrate-check/);
  assert.equal(out.stdout, '');
});

test('an unknown format is refused before anything is loaded', () => {
  const { out, calls, deps: d } = deps();
  assert.equal(runCli(['./site', '--format', 'yaml'], d), EXIT.usage);
  assert.match(out.stderr, /unknown format yaml/);
  assert.match(out.stderr, /text, json/, 'the message has to say what is available');
  assert.deepEqual(calls.loaded, [], 'nothing should be read from disk for a usage error');
});

test('an unknown severity is refused before anything is loaded', () => {
  const { out, calls, deps: d } = deps();
  assert.equal(runCli(['./site', '--fail-on', 'annoying'], d), EXIT.usage);
  assert.match(out.stderr, /unknown severity annoying/);
  assert.match(out.stderr, /blocker, high, medium, low/);
  assert.deepEqual(calls.loaded, []);
});

test('a directory that cannot be loaded is a usage error, not a finding', () => {
  const { out, deps: d } = deps({
    loadMigration: () => {
      throw new Error('no profile.json in ./site');
    }
  });
  assert.equal(runCli(['./site'], d), EXIT.usage);
  assert.match(out.stderr, /no profile\.json/);
  assert.equal(out.stdout, '', 'a report of nothing would read as a clean site');
});

test('a readable directory is loaded once, with the chosen moment, and the report is printed', () => {
  const { out, calls, deps: d } = deps();
  assert.equal(runCli(['./site', '--now', '2026-05-05T00:00:00Z'], d), EXIT.clean);
  assert.deepEqual(calls.loaded, ['./site']);
  assert.deepEqual(calls.ran, [{ now: '2026-05-05T00:00:00Z' }]);
  assert.equal(out.stdout, 'text:0\n');
});

test('the chosen format is the one used', () => {
  const { out, deps: d } = deps();
  runCli(['./site', '--format', 'json'], d);
  assert.doesNotThrow(() => JSON.parse(out.stdout));
});

test('the exit code is whatever exitCodeFor says, with the threshold passed through', () => {
  const seen = [];
  const { deps: d } = deps({
    exitCodeFor: (result, threshold) => {
      seen.push(threshold);
      return EXIT.findings;
    }
  });
  assert.equal(runCli(['./site', '--fail-on', 'low'], d), EXIT.findings);
  assert.deepEqual(seen, ['low']);
});

test('runCli writes nowhere except the streams it is given', () => {
  const { out, deps: d } = deps();
  runCli(['./site'], d);
  assert.ok(out.stdout.length > 0);
  assert.equal(out.stderr, '');
});
