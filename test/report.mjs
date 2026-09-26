import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderText, renderJson, renderMarkdown, FORMATS } from '../src/report.mjs';
import { loadMigration, runChecks } from '../src/run.mjs';
import { materialise, BASELINE_DIR } from '../tools/example.mjs';

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NOW = '2026-10-01T00:00:00Z';
const broken = runChecks(loadMigration(materialise('09-staging-config-in-production', 'fail')), { now: NOW });
const clean = runChecks(loadMigration(BASELINE_DIR), { now: NOW });

test('there are three formats and every one of them renders', () => {
  assert.deepEqual(Object.keys(FORMATS).sort(), ['json', 'markdown', 'text']);
  for (const render of Object.values(FORMATS)) assert.ok(render(broken).length > 200);
});

test('every format carries the next action and the limit for every finding', () => {
  for (const [name, render] of Object.entries(FORMATS)) {
    const output = render(broken);
    for (const finding of broken.findings) {
      assert.ok(output.includes(finding.nextAction), `${name} dropped the action for ${finding.id}`);
      assert.ok(output.includes(finding.doesNotProve), `${name} dropped the limit for ${finding.id}`);
    }
  }
});

test('the text report says which checks ran and which did not', () => {
  const output = renderText(broken);
  assert.match(output, /Checks run:/);
  const partial = runChecks(
    { profile: { domain: 'example.org' }, zone: null, observed: null, redirects: null, robots: null, sitemap: null, pages: [], assets: [], dbFiles: [] },
    {}
  );
  assert.match(renderText(partial), /Checks skipped, so nothing is known about them/);
});

test('a clean run says the checks that ran found nothing, not that the site is fine', () => {
  const output = renderText(clean);
  assert.match(output, /No findings from the checks that ran/);
});

test('the json report is parsable and keeps the structure the findings have', () => {
  const parsed = JSON.parse(renderJson(broken));
  assert.equal(parsed.domain, 'example.org');
  assert.equal(parsed.summary.total, broken.findings.length);
  assert.equal(parsed.findings.length, broken.findings.length);
  assert.ok(parsed.findings.every((f) => f.id && f.nextAction && f.doesNotProve));
  assert.ok(Array.isArray(parsed.checksRun));
});

test('the markdown report has a table row per finding and a section per finding', () => {
  const output = renderMarkdown(broken);
  const rows = output.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Severity') && !l.startsWith('|---'));
  assert.equal(rows.length, broken.findings.length);
  for (const finding of broken.findings) assert.ok(output.includes(`### ${finding.id} `));
});

test('the markdown report names the checks that did not run', () => {
  assert.match(renderMarkdown(broken), /## Checks that did not run/);
});

test('a line number is shown next to the file when there is one', () => {
  const withLine = broken.findings.find((f) => f.line !== null);
  assert.ok(withLine, 'the fixture should produce at least one located finding');
  assert.ok(renderText(broken).includes(`${withLine.where}:${withLine.line}`));
});

test('no report contains an em dash or an en dash', () => {
  for (const [name, render] of Object.entries(FORMATS)) {
    const output = render(broken);
    assert.ok(!output.includes(EM_DASH), `${name} contains an em dash`);
    assert.ok(!output.includes(EN_DASH), `${name} contains an en dash`);
  }
});
