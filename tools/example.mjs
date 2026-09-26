// Examples are stored as overlays: the baseline holds a complete migration
// directory with nothing wrong in it, and each example contributes only the
// files that differ. A pair is therefore readable as a diff rather than as two
// large directories that have to be compared by eye.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples');
export const BASELINE_DIR = join(EXAMPLES_DIR, 'baseline');

export function exampleNames() {
  return readdirSync(EXAMPLES_DIR)
    .filter((name) => /^\d\d-/.test(name))
    .sort();
}

/**
 * Build a complete migration directory for one variant of one example, by
 * copying the baseline and applying the overlay on top of it. Returns the path.
 */
export function materialise(name, variant, into = null) {
  const overlay = join(EXAMPLES_DIR, name, variant);
  if (!existsSync(overlay)) {
    throw new Error(`example ${name} has no ${variant} directory`);
  }
  const dest = into ?? mkdtempSync(join(tmpdir(), `migrate-check-${name}-${variant}-`));
  cpSync(BASELINE_DIR, dest, { recursive: true });
  cpSync(overlay, dest, { recursive: true });
  return dest;
}

/** The finding ids an example README says it raises, read out of the README itself. */
export function declaredFindings(name) {
  const readme = join(EXAMPLES_DIR, name, 'README.md');
  if (!existsSync(readme)) return [];
  const text = readFileSync(readme, 'utf8');
  return uniqueIds(text);
}

export function uniqueIds(text) {
  const ids = new Set();
  const single = /`([A-Z]{3,5}\d{3})`/g;
  let m;
  while ((m = single.exec(text)) !== null) ids.add(m[1]);
  // "`RED001` through `RED008`" expands to the whole run.
  const range = /`([A-Z]{3,5})(\d{3})`\s+through\s+`\1(\d{3})`/g;
  while ((m = range.exec(text)) !== null) {
    for (let n = Number(m[2]); n <= Number(m[3]); n += 1) {
      ids.add(`${m[1]}${String(n).padStart(3, '0')}`);
    }
  }
  return Array.from(ids).sort();
}
