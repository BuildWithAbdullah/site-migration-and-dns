// Mixed content and leftover absolute URLs, by scanning markup and stylesheets
// as text. A browser based scan finds what the page loaded; this finds what the
// source says, including the rules and attributes the page did not happen to
// use on the URL that was tested.

import { raise } from '../catalog.mjs';

const URL_ATTRIBUTES = ['src', 'href', 'action', 'poster', 'data-src', 'data-bg'];

// A loopback origin is treated as potentially trustworthy by browsers, so it is
// never blocked or upgraded as mixed content. Reporting it as a subresource over
// http attaches the wrong next action: the fix is to delete the reference, not
// to obtain a certificate for localhost. It is still a defect, because the
// reference resolves to the visitor's own machine, so it gets a reason of its
// own rather than being folded into the mixed content findings.
const LOOPBACK = /^(?:https?:)?\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

export function isLoopback(value) {
  return LOOPBACK.test(String(value ?? '').trim());
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function eachAttribute(text, callback) {
  // Deliberately a scanner rather than a parser. The input is often a template
  // fragment or a database row, neither of which is a whole document.
  const pattern = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    callback({
      name: match[1].toLowerCase(),
      value: match[3] ?? match[4] ?? '',
      index: match.index
    });
  }
}

export function scanText(text, { path, oldDomain = null, kind = 'html' }) {
  const findings = [];
  const seen = new Set();
  const once = (id, index, detail) => {
    const key = `${id}:${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(raise(id, { where: path, line: lineOf(text, index), detail }));
  };

  if (kind === 'html') {
    eachAttribute(text, ({ name, value, index }) => {
      const isUrlAttribute = URL_ATTRIBUTES.includes(name);

      if (isUrlAttribute && isLoopback(value)) {
        once('MIX008', index, `${name}="${value}" resolves to the visitor's own machine`);
        return;
      }
      if (name === 'action' && value.startsWith('http://')) {
        once('MIX007', index, `form action ${value}`);
        return;
      }
      if (name === 'srcset' || name === 'data-srcset' || name === 'imagesrcset') {
        const httpCandidates = value
          .split(',')
          .map((c) => c.trim().split(/\s+/)[0])
          .filter((c) => c.startsWith('http://'));
        const loopback = httpCandidates.filter((c) => isLoopback(c));
        const remote = httpCandidates.filter((c) => !isLoopback(c));
        if (loopback.length > 0) {
          once('MIX008', index, `srcset candidate ${loopback[0]} resolves to the visitor's own machine`);
        }
        if (remote.length > 0) {
          once('MIX005', index, `${remote.length} candidate(s) over http: ${remote[0]}`);
        }
        if (oldDomain && value.includes(oldDomain)) once('MIX003', index, `srcset references ${oldDomain}`);
        return;
      }
      if (name === 'style') {
        if (/url\(\s*['"]?http:\/\//i.test(value)) once('MIX006', index, `inline style loads ${value.slice(0, 60)}`);
        if (oldDomain && value.includes(oldDomain)) once('MIX003', index, `inline style references ${oldDomain}`);
        return;
      }
      if (!isUrlAttribute) return;

      if (value.startsWith('http://')) {
        // An anchor to an http page is a link, not mixed content. Only
        // subresources are blocked or downgraded by the browser.
        const isLink = name === 'href' && /<a\b[^>]*$/i.test(text.slice(Math.max(0, index - 400), index));
        once(isLink ? 'MIX003' : 'MIX001', index, `${name}="${value}"`);
      } else if (value.startsWith('//')) {
        once('MIX002', index, `${name}="${value}"`);
      }
      if (oldDomain && value.includes(oldDomain)) {
        once('MIX003', index, `${name} references ${oldDomain}`);
      }
    });

    // Inline style and script blocks are markup to the scanner above, so their
    // contents are scanned separately as CSS.
    const blocks = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let block;
    while ((block = blocks.exec(text)) !== null) {
      const offset = block.index + block[0].indexOf(block[1]);
      const urls = /url\(\s*['"]?(http:\/\/[^'")\s]+)/gi;
      let u;
      while ((u = urls.exec(block[1])) !== null) {
        if (isLoopback(u[1])) once('MIX008', offset + u.index, `url(${u[1]}) resolves to the visitor's own machine`);
        else once('MIX004', offset + u.index, `url(${u[1]})`);
      }
    }
  }

  if (kind === 'css') {
    const urls = /url\(\s*['"]?(http:\/\/[^'")\s]+)/gi;
    let match;
    while ((match = urls.exec(text)) !== null) {
      if (isLoopback(match[1])) once('MIX008', match.index, `url(${match[1]}) resolves to the visitor's own machine`);
      else once('MIX004', match.index, `url(${match[1]})`);
    }
    const relative = /url\(\s*['"]?(\/\/[^'")\s]+)/gi;
    while ((match = relative.exec(text)) !== null) {
      if (isLoopback(match[1])) once('MIX008', match.index, `url(${match[1]}) resolves to the visitor's own machine`);
      else once('MIX002', match.index, `url(${match[1]})`);
    }
    if (oldDomain) {
      const old = new RegExp(oldDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      while ((match = old.exec(text)) !== null) {
        once('MIX003', match.index, `stylesheet references ${oldDomain}`);
        break;
      }
    }
  }

  return findings;
}

export function checkMixed(files, profile) {
  const findings = [];
  for (const file of files) {
    const kind = file.kind ?? (/\.css$/i.test(file.path) ? 'css' : 'html');
    findings.push(
      ...scanText(String(file.text ?? ''), { path: file.path, oldDomain: profile.oldDomain ?? null, kind })
    );
  }
  return findings;
}
