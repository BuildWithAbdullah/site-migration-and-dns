import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { trackedFiles, parseRule, isIgnored, parseIgnoreFile } from '../tools/tracked.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.email=t@example.org', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// There is exactly one way to know a reimplementation of gitignore is right,
// and it is to ask git. So the matcher is checked against git on a repository
// built for the purpose, with the rules implementations get wrong.
test('the matcher agrees with git on a tree built to break it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tracked-'));
  try {
    const write = (path, text = 'x\n') => {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };

    write(
      '.gitignore',
      [
        '*.log',
        '!keep.log',
        'build/',
        '!build/keep-me.txt',
        'secrets/*',
        '!secrets/public.json',
        'tmp*',
        '!tmp-keep/',
        ''
      ].join('\n')
    );

    write('README.md');
    write('app.log');
    write('keep.log');
    write('deep/nested/other.log');
    write('deep/nested/keep.log');
    // A negation cannot re-include a file whose parent directory was excluded.
    // git never looks inside build/, so build/keep-me.txt stays out despite the
    // rule that names it. This is the case implementations usually get wrong.
    write('build/output.js');
    write('build/keep-me.txt');
    // Here the directory itself is not excluded, only its contents, so the
    // negation does work.
    write('secrets/private.json');
    write('secrets/public.json');
    write('tmp-scratch/a.txt');
    write('tmp-keep/b.txt');

    git(dir, ['init', '-q']);
    git(dir, ['add', '-A']);
    const fromGit = git(dir, ['ls-files']).trim().split('\n').filter(Boolean).sort();
    const fromMatcher = trackedFiles(dir);

    assert.deepEqual(fromMatcher, fromGit);
    // And the tree has to actually exercise the rules, or the agreement above
    // is an agreement about nothing.
    assert.ok(fromGit.includes('keep.log'), 'a negated rule should rescue a file');
    assert.ok(fromGit.includes('secrets/public.json'), 'a negation inside a contents-only exclusion should work');
    assert.ok(!fromGit.includes('build/keep-me.txt'), 'a negation inside an excluded directory should not');
    assert.ok(!fromGit.includes('app.log'));
    assert.ok(!fromGit.includes('tmp-scratch/a.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the matcher agrees with git on this repository', () => {
  if (!existsSync(join(ROOT, '.git'))) return;
  const fromGit = git(ROOT, ['ls-files']).trim().split('\n').filter(Boolean).sort();
  const fromMatcher = trackedFiles(ROOT);
  const gitKnowsAbout = fromGit.filter((f) => !fromMatcher.includes(f));
  assert.deepEqual(gitKnowsAbout, [], 'the matcher excludes files git tracks, so a count over it would be short');
});

test('a rule with no slash matches at any depth, one with a slash is anchored', () => {
  const loose = parseRule('*.log');
  const anchored = parseRule('deep/*.log');
  assert.ok(isIgnored('a.log', [loose]));
  assert.ok(isIgnored('deep/nested/a.log', [loose]));
  assert.ok(isIgnored('deep/a.log', [anchored]));
  assert.ok(!isIgnored('other/a.log', [anchored]));
});

test('the last matching rule decides', () => {
  const rules = parseIgnoreFile('*.log\n!keep.log\n');
  assert.ok(isIgnored('a.log', rules));
  assert.ok(!isIgnored('keep.log', rules));
  const reversed = parseIgnoreFile('!keep.log\n*.log\n');
  assert.ok(isIgnored('keep.log', reversed), 'reversing the order has to reverse the answer');
});

test('comments and blank lines are not rules', () => {
  const rules = parseIgnoreFile('# a comment\n\n   \n*.log\n');
  assert.equal(rules.length, 1);
});

test('the lockfile position is consistent rather than convenient', () => {
  // A repository with no dependencies has no lockfile to track, and this one
  // has none, which is why its counts cannot drift between a lockfile on disk
  // and a lockfile in the tree. The rule is only safe while that holds: the day
  // a dependency arrives, the lockfile has to be tracked and compared against
  // package.json rather than ignored to keep the counting quiet.
  const ignore = parseIgnoreFile(
    existsSync(join(ROOT, '.gitignore')) ? execFileSync('cat', [join(ROOT, '.gitignore')], { encoding: 'utf8' }) : ''
  );
  assert.ok(!isIgnored('package-lock.json', ignore), 'a tracked lockfile must never be added to .gitignore');
});
