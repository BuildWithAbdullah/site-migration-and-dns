#!/usr/bin/env node
// Wiring only. Every decision this command makes lives in src/cli.mjs, where a
// test can import it and call it with stubs. tools/entry-thin.mjs fails the
// build if any of it moves back in here.

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { runCli } from '../src/cli.mjs';
import { loadMigration, runChecks, exitCodeFor } from '../src/run.mjs';
import { FORMATS } from '../src/report.mjs';
import { SEVERITIES } from '../src/catalog.mjs';

// Both sides have to be resolved to a real path before they are compared. npm
// installs a bin as a symlink, and Node resolves a module path to its realpath,
// so comparing the two as written means they never match and the command does
// nothing at all for everybody who installed it the documented way. The URL is
// built with pathToFileURL rather than by prefixing file://, which is wrong on
// Windows, where an absolute path begins with a drive letter.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  process.exitCode = runCli(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    formats: FORMATS,
    severities: SEVERITIES,
    loadMigration,
    runChecks,
    exitCodeFor
  });
}
