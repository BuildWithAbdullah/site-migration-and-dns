// Which files git actually tracks, decided from .gitignore rather than from
// whatever happens to be lying in the working copy.
//
// This matters because the repository verifier counts things, and a count taken
// over a directory walk is partly a count of build leftovers. Running
// npm install in a clone put a package-lock.json on disk that git does not track
// and moved the verifier's assertion total, which means the number printed in
// the README depended on whether anybody had installed anything. The number has
// to be a fact about the repository, not about the machine.
//
// The implementation is deliberately a small subset of gitignore, and CI checks
// it against git itself, which is the only way to know a reimplementation of
// these rules is right. The part implementations usually get wrong is negation:
// a later rule overrides an earlier one, and a negation cannot re-include a file
// whose parent directory was excluded. Both are covered.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ALWAYS_SKIP = new Set(['.git', 'node_modules']);

function escapeSegment(segment) {
  let out = '';
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return out;
}

/** One .gitignore line, as a matcher. */
export function parseRule(line) {
  let pattern = line;
  const negated = pattern.startsWith('!');
  if (negated) pattern = pattern.slice(1);
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);

  // A pattern containing a slash anywhere but the end is anchored to the
  // .gitignore's own directory. One without is matched against every segment.
  const anchored = pattern.includes('/');
  const source = pattern
    .split('/')
    .map((segment) => (segment === '**' ? '§§' : escapeSegment(segment)))
    .join('/')
    .replace(/§§\//g, '(?:[^/]+/)*')
    .replace(/\/§§/g, '(?:/[^/]+)*')
    .replace(/§§/g, '.*');

  const regex = anchored ? new RegExp(`^${source}$`) : new RegExp(`(^|/)${source}$`);
  return { raw: line, negated, directoryOnly, anchored, regex };
}

export function parseIgnoreFile(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map(parseRule);
}

/**
 * Whether one repository relative path is ignored. Rules are applied in order
 * and the last one that matches decides, which is what makes a negation able to
 * rescue a file an earlier rule excluded.
 */
export function isIgnored(path, rules, { isDirectory = false } = {}) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directoryOnly && !isDirectory && !rule.regex.test(dirPartsOf(path).join('/'))) {
      // A pattern written with a trailing slash matches directories, and
      // therefore everything inside them.
      const hit = dirPartsOf(path).some((_, i) => rule.regex.test(dirPartsOf(path).slice(0, i + 1).join('/')));
      if (!hit) continue;
    } else if (!rule.regex.test(path)) {
      continue;
    }
    ignored = !rule.negated;
  }
  return ignored;
}

function dirPartsOf(path) {
  const parts = path.split('/');
  parts.pop();
  return parts;
}

/**
 * Every tracked file under root, as repository relative paths with forward
 * slashes. A directory excluded by a rule is not walked, which is also what
 * makes a negation inside it unable to rescue anything, exactly as git behaves.
 */
export function trackedFiles(root) {
  const ignoreFile = join(root, '.gitignore');
  const rules = existsSync(ignoreFile) ? parseIgnoreFile(readFileSync(ignoreFile, 'utf8')) : [];
  const out = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      if (ALWAYS_SKIP.has(entry)) continue;
      const full = join(dir, entry);
      const rel = relative(root, full).split(sep).join('/');
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (isIgnored(rel, rules, { isDirectory: true })) continue;
        walk(full);
      } else if (stat.isFile() && !isIgnored(rel, rules)) {
        out.push(rel);
      }
    }
  };

  walk(root);
  return out.sort();
}
