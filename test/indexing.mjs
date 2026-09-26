import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRobots, checkIndexing } from '../src/checks/indexing.mjs';

const profile = {
  domain: 'example.org',
  oldDomain: 'old-site.example',
  stagingHosts: ['staging.example.org']
};
const ids = (f) => f.map((x) => x.id).sort();

test('robots.txt groups rules under the user agents they belong to', () => {
  const parsed = parseRobots(`User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /a\n\nUser-agent: *\nDisallow: /b\n`);
  assert.equal(parsed.groups.length, 2);
  assert.deepEqual(parsed.groups[0].agents, ['Googlebot', 'Bingbot']);
  assert.deepEqual(parsed.groups[1].agents, ['*']);
  assert.equal(parsed.groups[1].rules[0].path, '/b');
});

test('comments and blank lines are ignored, and sitemaps are collected', () => {
  const parsed = parseRobots(`# a comment\nUser-agent: *\nDisallow: /wp-admin/ # trailing\n\nSitemap: https://example.org/sitemap.xml\n`);
  assert.equal(parsed.groups[0].rules[0].path, '/wp-admin/');
  assert.deepEqual(parsed.sitemaps, ['https://example.org/sitemap.xml']);
});

test('a line with no separator is recorded as an error rather than dropped', () => {
  assert.match(parseRobots('User-agent: *\nDisallowEverything\n').errors[0].detail, /no field separator/);
});

test('a blanket disallow is a blocker, and reports the line', () => {
  const found = checkIndexing({ robots: 'User-agent: *\nDisallow: /\n' }, profile).find((f) => f.id === 'IDX001');
  assert.equal(found.severity, 'blocker');
  assert.equal(found.line, 2);
});

test('a blanket disallow with an allow carved out of it is not a blanket disallow', () => {
  const robots = 'User-agent: *\nDisallow: /\nAllow: /public/\n';
  assert.ok(!ids(checkIndexing({ robots }, profile)).includes('IDX001'));
});

test('a normal robots.txt with a sitemap raises nothing', () => {
  const robots = 'User-agent: *\nDisallow: /wp-admin/\n\nSitemap: https://example.org/sitemap.xml\n';
  assert.deepEqual(ids(checkIndexing({ robots }, profile)), []);
});

test('a missing sitemap line is low severity', () => {
  const found = checkIndexing({ robots: 'User-agent: *\nDisallow: /wp-admin/\n' }, profile).find(
    (f) => f.id === 'IDX009'
  );
  assert.equal(found.severity, 'low');
});

test('a sitemap line still on the old domain is reported', () => {
  const robots = 'User-agent: *\nDisallow: /wp-admin/\nSitemap: https://old-site.example/sitemap.xml\n';
  assert.ok(ids(checkIndexing({ robots }, profile)).includes('IDX002'));
});

const page = (head) => ({ pages: [{ url: '/', html: `<!doctype html><html><head>${head}</head><body></body></html>` }] });

test('a noindex meta tag is a blocker', () => {
  const found = checkIndexing(page('<meta name="robots" content="noindex, nofollow">'), profile).find(
    (f) => f.id === 'IDX003'
  );
  assert.equal(found.severity, 'blocker');
});

test('an index meta tag is not mistaken for a noindex one', () => {
  assert.ok(!ids(checkIndexing(page('<meta name="robots" content="index, follow">'), profile)).includes('IDX003'));
});

test('a noindex response header is found even though the markup is clean', () => {
  const input = { pages: [{ url: '/', html: '<html><head></head></html>', headers: { 'X-Robots-Tag': 'noindex' } }] };
  const found = checkIndexing(input, profile).find((f) => f.id === 'IDX004');
  assert.ok(found);
  assert.match(found.doesNotProve, /markup can be perfect/);
});

test('a canonical on the staging host is told apart from one on the old domain', () => {
  assert.ok(
    ids(checkIndexing(page('<link rel="canonical" href="https://staging.example.org/">'), profile)).includes('IDX006')
  );
  assert.ok(
    ids(checkIndexing(page('<link rel="canonical" href="https://old-site.example/">'), profile)).includes('IDX005')
  );
  assert.deepEqual(ids(checkIndexing(page('<link rel="canonical" href="https://example.org/">'), profile)), []);
});

test('an hreflang alternate on the old domain is reported once per page', () => {
  const head =
    '<link rel="alternate" hreflang="fr" href="https://old-site.example/fr/">' +
    '<link rel="alternate" hreflang="de" href="https://old-site.example/de/">';
  const found = checkIndexing(page(head), profile).filter((f) => f.id === 'IDX010');
  assert.equal(found.length, 1);
});

test('a sitemap listing the old domain is reported once', () => {
  const sitemap = `<urlset><url><loc>https://old-site.example/a</loc></url><url><loc>https://old-site.example/b</loc></url></urlset>`;
  const found = checkIndexing({ sitemap }, profile).filter((f) => f.id === 'IDX007');
  assert.equal(found.length, 1);
});

test('a sitemap entry that is a redirect source is reported, matching path against the map', () => {
  const sitemap = '<urlset><url><loc>https://example.org/old-about</loc></url></urlset>';
  const found = checkIndexing({ sitemap, map: [{ from: '/old-about', to: '/about' }] }, profile).find(
    (f) => f.id === 'IDX008'
  );
  assert.ok(found, 'the sitemap gives an absolute URL and the map gives a path');
});

test('a sitemap of destinations raises nothing', () => {
  const sitemap = '<urlset><url><loc>https://example.org/about</loc></url></urlset>';
  assert.deepEqual(ids(checkIndexing({ sitemap, map: [{ from: '/old-about', to: '/about' }] }, profile)), []);
});
