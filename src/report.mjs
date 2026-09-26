// Three renderings of one result. Every finding prints its evidence, the next
// action and what it does not prove, in all three, because a report that drops
// the caveat when it is inconvenient to format is how a caveat stops existing.

import { SEVERITIES } from './catalog.mjs';

const LABEL = { blocker: 'BLOCKER', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };

function location(finding) {
  return finding.line ? `${finding.where}:${finding.line}` : finding.where;
}

export function renderText(result) {
  const lines = [];
  const { profile, findings, ran, skipped, summary } = result;

  lines.push(`Migration check: ${profile.domain}`);
  if (profile.oldDomain) lines.push(`Moving from: ${profile.oldDomain}`);
  lines.push(`Phase: ${profile.phase === 'post' ? 'post cutover' : 'pre cutover'}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No findings from the checks that ran.');
  } else {
    for (const severity of SEVERITIES) {
      const group = findings.filter((f) => f.severity === severity);
      if (group.length === 0) continue;
      lines.push(`${LABEL[severity]} (${group.length})`);
      for (const f of group) {
        lines.push(`  ${f.id}  ${f.title}`);
        lines.push(`    at        ${location(f)}`);
        if (f.detail) lines.push(`    evidence  ${f.detail}`);
        lines.push(`    do        ${f.nextAction}`);
        lines.push(`    does not prove  ${f.doesNotProve}`);
        lines.push('');
      }
    }
  }

  lines.push(
    `Checks run: ${ran.length > 0 ? ran.join(', ') : 'none'}`
  );
  if (skipped.length > 0) {
    lines.push('Checks skipped, so nothing is known about them:');
    for (const s of skipped) lines.push(`  ${s.area}: ${s.reason}`);
  }
  lines.push(
    `Findings: ${summary.total} (` +
      SEVERITIES.map((s) => `${s} ${summary.bySeverity[s]}`).join(', ') +
      ')'
  );
  return lines.join('\n');
}

export function renderJson(result) {
  return JSON.stringify(
    {
      domain: result.profile.domain,
      oldDomain: result.profile.oldDomain ?? null,
      phase: result.profile.phase ?? 'pre',
      checksRun: result.ran,
      checksSkipped: result.skipped,
      summary: result.summary,
      findings: result.findings
    },
    null,
    2
  );
}

export function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Migration check: ${result.profile.domain}`);
  lines.push('');
  lines.push(`Phase: ${result.profile.phase === 'post' ? 'post cutover' : 'pre cutover'}.`);
  lines.push('');
  lines.push('| Severity | Id | Finding | Where |');
  lines.push('|---|---|---|---|');
  for (const f of result.findings) {
    lines.push(`| ${LABEL[f.severity]} | ${f.id} | ${f.title} | \`${location(f)}\` |`);
  }
  if (result.findings.length === 0) {
    lines.push('| | | No findings from the checks that ran | |');
  }
  lines.push('');
  for (const f of result.findings) {
    lines.push(`### ${f.id} ${f.title}`);
    lines.push('');
    lines.push(`At \`${location(f)}\`.${f.detail ? ` ${f.detail}.` : ''}`);
    lines.push('');
    lines.push(`**Next action.** ${f.nextAction}`);
    lines.push('');
    lines.push(`**What this does not prove.** ${f.doesNotProve}`);
    lines.push('');
  }
  lines.push('## Checks that did not run');
  lines.push('');
  if (result.skipped.length === 0) {
    lines.push('None. Every check had input.');
  } else {
    for (const s of result.skipped) lines.push(`- \`${s.area}\`: ${s.reason}`);
  }
  return lines.join('\n');
}

export const FORMATS = { text: renderText, json: renderJson, markdown: renderMarkdown };
