import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkRedirects, followChain, __internals } from '../src/checks/redirects.mjs';

const profile = { domain: 'example.org' };
const ids = (f) => f.map((x) => x.id);

test('a URL is keyed on its path and query, so an absolute and a relative form match', () => {
  assert.equal(__internals.keyOf('https://example.org/a?b=1'), __internals.keyOf('/a?b=1'));
});

test('a chain is followed to its end and the hop count is the number of redirects', () => {
  const map = [
    { from: '/a', to: '/b' },
    { from: '/b', to: '/c' }
  ];
  const chain = followChain(map, '/a');
  assert.equal(chain.hops, 2);
  assert.equal(chain.destination, '/c');
  assert.equal(chain.loop, false);
});

test('a cycle is reported as a loop rather than followed to the limit', () => {
  const chain = followChain([{ from: '/a', to: '/b' }, { from: '/b', to: '/a' }], '/a');
  assert.equal(chain.loop, true);
});

test('a target written as a full URL ends the chain instead of inventing a loop', () => {
  const chain = followChain([{ from: '/contact', to: 'https://www.example.org/contact' }], '/contact');
  assert.equal(chain.loop, false, 'the map hands off to that host and stops');
  assert.equal(chain.destination, 'https://www.example.org/contact');
  assert.equal(chain.hops, 1);
});

test('an unmapped old URL is only a finding when it is not already on the new site', () => {
  const missing = checkRedirects({ oldInventory: ['/gone'], newInventory: ['/'], map: [] }, profile);
  assert.ok(ids(missing).includes('RED001'));

  const unchanged = checkRedirects({ oldInventory: ['/about'], newInventory: ['/about'], map: [] }, profile);
  assert.ok(!ids(unchanged).includes('RED001'), 'a URL that did not move needs no redirect');
});

test('a two hop chain is reported with where it ends up', () => {
  const found = checkRedirects(
    { oldInventory: [], newInventory: ['/c'], map: [{ from: '/a', to: '/b' }, { from: '/b', to: '/c' }] },
    profile
  ).find((f) => f.id === 'RED002' && f.where === '/a');
  assert.ok(found);
  assert.match(found.detail, /2 hops, ending at \/c/);
});

test('a loop is a blocker', () => {
  const found = checkRedirects(
    { oldInventory: [], newInventory: [], map: [{ from: '/a', to: '/b' }, { from: '/b', to: '/a' }] },
    profile
  ).find((f) => f.id === 'RED003');
  assert.equal(found.severity, 'blocker');
});

test('a target outside the new inventory is reported', () => {
  assert.ok(
    ids(
      checkRedirects({ oldInventory: [], newInventory: ['/exists'], map: [{ from: '/a', to: '/missing' }] }, profile)
    ).includes('RED004')
  );
});

test('with no new inventory supplied, target existence is not guessed at', () => {
  assert.ok(
    !ids(checkRedirects({ oldInventory: [], newInventory: [], map: [{ from: '/a', to: '/b' }] }, profile)).includes(
      'RED004'
    )
  );
});

test('a dropped query string is reported even when the rule is also in a loop', () => {
  const found = ids(
    checkRedirects(
      {
        oldInventory: [],
        newInventory: [],
        map: [
          { from: '/l?utm_source=x', to: '/l' },
          { from: '/l', to: '/l?utm_source=x' }
        ]
      },
      profile
    )
  );
  assert.ok(found.includes('RED005'), 'the simpler defect must not be hidden by the loop');
  assert.ok(found.includes('RED003'));
});

test('an http target is reported', () => {
  assert.ok(
    ids(
      checkRedirects({ oldInventory: [], newInventory: [], map: [{ from: '/a', to: 'http://example.org/a' }] }, profile)
    ).includes('RED007')
  );
});

test('trailing slashes are only a finding when the map uses both conventions', () => {
  const mixed = checkRedirects(
    { oldInventory: [], newInventory: [], map: [{ from: '/a', to: '/x/' }, { from: '/b', to: '/y' }] },
    profile
  );
  assert.ok(ids(mixed).includes('RED006'));

  const consistent = checkRedirects(
    { oldInventory: [], newInventory: [], map: [{ from: '/a', to: '/x' }, { from: '/b', to: '/y' }] },
    profile
  );
  assert.ok(!ids(consistent).includes('RED006'));
});

test('the site root is not treated as an inconsistent trailing slash', () => {
  const found = checkRedirects(
    { oldInventory: [], newInventory: [], map: [{ from: '/a', to: '/' }, { from: '/b', to: '/y' }] },
    profile
  );
  assert.ok(!ids(found).includes('RED006'), 'the root has to end in a slash');
});

test('a wildcard above a specific rule shadows it', () => {
  assert.equal(__internals.patternShadows('/blog/2020/*', '/blog/2020/post-one'), true);
  assert.equal(__internals.patternShadows('/blog/2020/post-one', '/blog/2020/*'), false);

  const found = checkRedirects(
    {
      oldInventory: [],
      newInventory: [],
      map: [{ from: '/blog/2020/*', to: '/blog/' }, { from: '/blog/2020/post-one', to: '/blog/post-one' }]
    },
    profile
  ).find((f) => f.id === 'RED008');
  assert.ok(found);
  assert.equal(found.where, '/blog/2020/post-one');
});

test('a specific rule above a wildcard is not shadowed', () => {
  assert.ok(
    !ids(
      checkRedirects(
        {
          oldInventory: [],
          newInventory: [],
          map: [{ from: '/blog/2020/post-one', to: '/blog/post-one' }, { from: '/blog/2020/*', to: '/blog/' }]
        },
        profile
      )
    ).includes('RED008')
  );
});
