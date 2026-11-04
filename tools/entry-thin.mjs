#!/usr/bin/env node
// Keep the decisions out of the files no test can import.
//
// Moving the command's logic into src/cli.mjs and the collector's logic into
// src/probe-plan.mjs is worth nothing on its own, because the next change that
// adds "just one flag" will add it where the flags are read. So this fails the
// build when that happens: the entry points are allowed to be wiring and
// nothing else, measured three ways, and the measurement is a build step rather
// than a convention in a comment.
//
// The needles are assembled from fragments at run time so that none of the
// patterns this tool searches for exists as a literal in the file doing the
// searching. A purity check that trips on its own source is a purity check
// somebody will delete.

import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BRANCH_TOKENS = [
  /\bif\s*\(/g,
  /\belse\b/g,
  /\bfor\s*\(/g,
  /\bwhile\s*\(/g,
  /\bswitch\s*\(/g,
  /\bcatch\s*[({]/g,
  /\?[^.]/g,
  /&&/g,
  /\|\|/g
];

// Each needle is assembled from fragments at run time, so no pattern this tool
// searches for exists as a literal in the file doing the searching.
//
// The vocabulary is per entry rather than shared, and that is a correction
// rather than a convenience. A single shared list flagged the collector three
// times on its first run and two of the three were the list's fault: the loop
// counting redirect hops matched a needle written for walking an argument list,
// and splitting a certificate's subject alternative names on a comma matched one
// written for parsing an option value. The same token means different things in
// a network adapter and in a command's front door, so each entry declares the
// vocabulary that would be evidence against it.
const NEEDLES = {
  usageText: { needle: ['Us', 'age:'], what: 'holds usage text, so it decides what the user is told' },
  collectUsage: { needle: ['Us', 'age: collect'], what: 'holds the collector usage text' },
  stderr: { needle: ['stderr.wr', 'ite'], what: 'writes an error message, so it decides what an error looks like' },
  optionValidation: { needle: ['hasOwn', 'Property'], what: 'validates an option value' },
  argumentLoop: { needle: ['for (let i', ' ='], what: 'walks the argument list' },
  listOption: { needle: ['.spl', "it(',')"], what: 'parses a list out of an option value' },
  lookupErrors: { needle: ['ENOTFO', 'UND'], what: 'decides which lookup errors matter' },
  positionalArgv: {
    needle: ['const [domain, out', 'Dir'],
    what: 'destructures the argument list positionally, which is what made a flag become the output directory'
  },
  selectorFlag: { needle: ['--selec', 'tors='], what: 'parses the selector flag spelling' }
};

export const ENTRIES = [
  {
    path: 'bin/migrate-check.mjs',
    maxCodeLines: 30,
    maxBranches: 6,
    mustImport: ['../src/cli.mjs'],
    forbid: ['usageText', 'stderr', 'optionValidation', 'argumentLoop', 'listOption'],
    note: 'the file npm installs as the migrate-check command'
  },
  {
    path: 'probe/collect.mjs',
    // The collector is a network adapter, so it is allowed to be long, to
    // branch, and to write to a stream: every lookup has a failure path and
    // there is nowhere else for the output to go. What it is not allowed to do
    // is decide anything, which is what the needles above and the required
    // import cover.
    maxCodeLines: 220,
    maxBranches: 60,
    mustImport: ['../src/probe-plan.mjs'],
    forbid: ['collectUsage', 'lookupErrors', 'positionalArgv', 'selectorFlag'],
    note: 'the only file that reaches the network'
  }
];

export function codeLinesOf(source) {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//')).length;
}

export function branchesOf(source) {
  let total = 0;
  for (const token of BRANCH_TOKENS) total += (source.match(token) ?? []).length;
  return total;
}

export function inspect(entry, root = ROOT) {
  const source = readFileSync(join(root, entry.path), 'utf8');
  const problems = [];

  const lines = codeLinesOf(source);
  if (lines > entry.maxCodeLines) {
    problems.push(`${lines} lines of code, the limit is ${entry.maxCodeLines}`);
  }
  const branches = branchesOf(source);
  if (branches > entry.maxBranches) {
    problems.push(`${branches} branches, the limit is ${entry.maxBranches}`);
  }
  for (const specifier of entry.mustImport) {
    if (!source.includes(specifier)) {
      problems.push(`does not import ${specifier}, so its decisions are not in a module a test can drive`);
    }
  }
  for (const key of entry.forbid) {
    const rule = NEEDLES[key];
    if (!rule) throw new Error(`${entry.path} forbids ${key}, which is not a needle in NEEDLES`);
    if (source.includes(rule.needle.join(''))) problems.push(rule.what);
  }

  // The guard deciding whether the file was invoked directly has to resolve both
  // sides to a real path, or the installed command does nothing at all.
  if (source.includes('import.meta.url') && !source.includes('realpathSync')) {
    problems.push('compares a module path against import.meta.url without resolving it to a real path first');
  }

  return { path: entry.path, lines, branches, problems };
}

export function inspectAll(root = ROOT) {
  return ENTRIES.map((entry) => inspect(entry, root));
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
  const results = inspectAll();
  const failed = results.filter((r) => r.problems.length > 0);
  for (const r of failed) for (const problem of r.problems) process.stderr.write(`${r.path}: ${problem}\n`);
  if (failed.length > 0) {
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Entry points: ${results
        .map((r) => `${r.path} ${r.lines} lines ${r.branches} branches`)
        .join(', ')}.\n`
    );
  }
}
