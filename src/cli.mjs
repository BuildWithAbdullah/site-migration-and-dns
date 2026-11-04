// Every decision migrate-check makes, in a module a test can import.
//
// This used to live in bin/migrate-check.mjs: argument parsing, three kinds of
// validation, the choice between a usage error and a finding, and the exit code
// for each. All of it was in a file whose only coverage was node --check, which
// proves a file parses and nothing else. The behaviour was reachable by starting
// a process, which is how it was tested, but a process boundary is an expensive
// and coarse way to ask what a function returns for a given argument list, and
// the branches nobody thought to start a process for were simply never run.
//
// So the file below takes its streams, its loader, its runner, its formats and
// its severity list as arguments and returns a number. It opens no file, starts
// no process and reads no environment. bin/migrate-check.mjs supplies the real
// ones and does nothing else, and tools/entry-thin.mjs fails the build if a
// decision moves back into it.

export const USAGE = `Usage: migrate-check <directory> [options]

  --format <text|json|markdown>   default text
  --fail-on <blocker|high|medium|low>
                                  lowest severity that exits 1, default high
  --now <iso timestamp>           evaluate time based checks at this moment
  --help

The directory holds profile.json plus whatever artefacts are available:
zone.json, observed.json, redirects.json, robots.txt, sitemap.xml, pages/,
assets/ and db/. A check with no input is skipped and reported as skipped.
`;

export const EXIT = {
  clean: 0,
  findings: 1,
  usage: 2
};

/**
 * Turn an argument list into options, or into an error. Returns
 * { ok: true, options } or { ok: false, message }. It never throws, because a
 * malformed command line is the normal case rather than an exceptional one.
 */
export function parseArgs(argv) {
  const options = { dir: null, format: 'text', failOn: 'high', now: undefined, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--format' || arg === '--fail-on' || arg === '--now') {
      const value = argv[i + 1];
      // An option written last with nothing after it used to swallow undefined
      // and fail later as though the value itself were wrong.
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, message: `${arg} needs a value` };
      }
      i += 1;
      if (arg === '--format') options.format = value;
      else if (arg === '--fail-on') options.failOn = value;
      else options.now = value;
      continue;
    }
    if (arg.startsWith('-')) return { ok: false, message: `unknown option ${arg}` };
    if (options.dir !== null) return { ok: false, message: 'only one directory can be checked at a time' };
    options.dir = arg;
  }

  return { ok: true, options };
}

/**
 * The whole command, as a function of its arguments and its dependencies.
 * Returns the exit code. Writes through the streams it is given and nowhere
 * else.
 */
export function runCli(argv, deps) {
  const { stdout, stderr, formats, severities, loadMigration, runChecks, exitCodeFor } = deps;

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`${parsed.message}\n\n${USAGE}`);
    return EXIT.usage;
  }

  const { options } = parsed;
  if (options.help) {
    stdout.write(USAGE);
    return EXIT.clean;
  }
  if (options.dir === null) {
    stdout.write(USAGE);
    return EXIT.usage;
  }
  if (!Object.prototype.hasOwnProperty.call(formats, options.format)) {
    stderr.write(`unknown format ${options.format}. One of ${Object.keys(formats).join(', ')}.\n`);
    return EXIT.usage;
  }
  if (!severities.includes(options.failOn)) {
    stderr.write(`unknown severity ${options.failOn}. One of ${severities.join(', ')}.\n`);
    return EXIT.usage;
  }

  let result;
  try {
    result = runChecks(loadMigration(options.dir), { now: options.now });
  } catch (error) {
    // A directory that is not a migration directory is a usage problem, not a
    // finding. Reporting it as a finding would make an unreadable input look
    // like a failed migration.
    stderr.write(`${error.message}\n`);
    return EXIT.usage;
  }

  stdout.write(`${formats[options.format](result)}\n`);
  return exitCodeFor(result, options.failOn);
}
