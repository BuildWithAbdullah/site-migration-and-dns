import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scanText, checkMixed } from '../src/checks/mixed.mjs';

const html = (body) => scanText(body, { path: 'pages/x.html', oldDomain: 'old-site.example', kind: 'html' });
const css = (body) => scanText(body, { path: 'assets/x.css', oldDomain: 'old-site.example', kind: 'css' });
const ids = (f) => f.map((x) => x.id).sort();

test('a script over http is mixed content', () => {
  assert.deepEqual(ids(html('<script src="http://cdn.example/a.js"></script>')), ['MIX001']);
});

test('a link to an http page is a link, not a blocked subresource', () => {
  assert.deepEqual(ids(html('<a href="http://other.example/page">go</a>')), ['MIX003']);
});

test('a stylesheet href over http is a subresource', () => {
  assert.deepEqual(ids(html('<link rel="stylesheet" href="http://cdn.example/a.css">')), ['MIX001']);
});

test('a protocol relative URL is low severity, because on https it works', () => {
  const found = html('<script src="//cdn.example/a.js"></script>');
  assert.deepEqual(ids(found), ['MIX002']);
  assert.equal(found[0].severity, 'low');
});

test('an old domain reference is reported even when the scheme is https', () => {
  assert.deepEqual(ids(html('<img src="https://old-site.example/a.jpg" alt="a">')), ['MIX003']);
});

test('a stylesheet url over http is found', () => {
  assert.deepEqual(ids(css('body { background: url("http://cdn.example/a.png"); }')), ['MIX004']);
});

test('a protocol relative url inside a stylesheet is found', () => {
  assert.deepEqual(ids(css('body { background: url(//cdn.example/a.png); }')), ['MIX002']);
});

test('an old domain in a stylesheet is reported once rather than per rule', () => {
  const found = css('.a{background:url("https://old-site.example/1.png")}.b{background:url("https://old-site.example/2.png")}');
  assert.deepEqual(ids(found), ['MIX003']);
});

test('a style block inside markup is scanned as stylesheet content', () => {
  assert.deepEqual(ids(html('<style>.a { background: url(http://cdn.example/a.png); }</style>')), ['MIX004']);
});

test('only the http candidates in a srcset are reported, and the count is given', () => {
  const found = html(
    '<img srcset="https://cdn.example/a.jpg 1x, http://cdn.example/a2.jpg 2x, http://cdn.example/a3.jpg 3x" alt="a">'
  );
  assert.deepEqual(ids(found), ['MIX005']);
  assert.match(found[0].detail, /2 candidate/);
});

test('a fully https srcset is not a finding', () => {
  assert.deepEqual(ids(html('<img srcset="https://cdn.example/a.jpg 1x, https://cdn.example/b.jpg 2x" alt="a">')), []);
});

test('an inline style loading over http is medium, and points at the database', () => {
  const found = html('<div style="background-image: url(\'http://cdn.example/a.png\')"></div>');
  assert.deepEqual(ids(found), ['MIX006']);
  assert.match(found[0].nextAction, /database/);
});

test('a form action over http is the blocker, because the request is already sent', () => {
  const found = html('<form action="http://example.org/search"></form>');
  assert.deepEqual(ids(found), ['MIX007']);
  assert.equal(found[0].severity, 'blocker');
  assert.match(found[0].doesNotProve, /nothing prevents it/);
});

test('an https form action is fine', () => {
  assert.deepEqual(ids(html('<form action="https://example.org/search"></form>')), []);
});

test('findings carry the line they were found on', () => {
  const found = html('<p>one</p>\n<p>two</p>\n<script src="http://cdn.example/a.js"></script>');
  assert.equal(found[0].line, 3);
});

test('root relative and https references raise nothing', () => {
  const clean = `<!doctype html><html><head>
    <link rel="canonical" href="https://www.example.org/">
    <link rel="stylesheet" href="/assets/theme.css">
    </head><body><img src="/a.jpg" alt="a"><form action="/search"></form></body></html>`;
  assert.deepEqual(ids(html(clean)), []);
});

test('checkMixed chooses the scanner from the file extension', () => {
  const found = checkMixed(
    [
      { path: 'assets/theme.css', text: 'body{background:url(http://cdn.example/a.png)}' },
      { path: 'pages/home.html', text: '<script src="http://cdn.example/a.js"></script>' }
    ],
    { oldDomain: 'old-site.example' }
  );
  assert.deepEqual(ids(found), ['MIX001', 'MIX004']);
});

test('with no old domain in the profile, no old domain findings are invented', () => {
  const found = scanText('<img src="https://anything.example/a.jpg" alt="a">', { path: 'p.html', kind: 'html' });
  assert.deepEqual(ids(found), []);
});
