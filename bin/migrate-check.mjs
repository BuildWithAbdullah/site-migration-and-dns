#!/usr/bin/env node
// migrate-check: read a migration directory, run the checks that have input,
// print the findings, exit non zero when something at or above the threshold
// was found.

import { loadMigration, runChecks, exitCodeFor } from '../src/run.mjs';
import { FORMATS } from '../src/report.mjs';
import { SEVERITIES } from '../src/catalog.mjs';

const USAGE = `Usage: migrate-check <directory> [options]

  --format <text|json|markdown>   default text
  --fail-on <blocker|high|medium|low>
                                  lowest severity that exits 1, default high
  --now <iso timestamp>           evaluate time based checks at this moment
  --help

The directory holds profile.json plus whatever artefacts are available:
zone.json, observed.json, redirects.json, robots.txt, sitemap.xml, pages/,
assets/ and db/. A check with no input is skipped and reported as skipped.
`;

function parseArgs(argv) {
  const options = { dir: null, format: 'text', failOn: 'high', now: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg === '--format') options.format = argv[++i];
    else if (arg === '--fail-on') options.failOn = argv[++i];
    else if (arg === '--now') options.now = argv[++i];
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else if (options.dir === null) options.dir = arg;
    else throw new Error('only one directory can be checked at a time');
  }
  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }

  if (options.help || options.dir === null) {
    process.stdout.write(USAGE);
    return options.help ? 0 : 2;
  }
  if (!Object.prototype.hasOwnProperty.call(FORMATS, options.format)) {
    process.stderr.write(`unknown format ${options.format}. One of ${Object.keys(FORMATS).join(', ')}.\n`);
    return 2;
  }
  if (!SEVERITIES.includes(options.failOn)) {
    process.stderr.write(`unknown severity ${options.failOn}. One of ${SEVERITIES.join(', ')}.\n`);
    return 2;
  }

  let result;
  try {
    result = runChecks(loadMigration(options.dir), { now: options.now });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  process.stdout.write(`${FORMATS[options.format](result)}\n`);
  return exitCodeFor(result, options.failOn);
}

process.exitCode = main(process.argv.slice(2));
