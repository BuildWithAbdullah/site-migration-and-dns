#!/usr/bin/env node
// Collect real answers into the files the checks read. This is the only part of
// the repository that touches the network, and it is deliberately the only part
// that CI does not run: its output depends on the internet, so a test that
// asserted anything about it would be asserting the state of somebody else's
// nameserver.
//
// The split is the point. Everything that decides whether a migration is safe
// is a pure function over the files this script writes, so the judgement is
// tested and the collection is not.

import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:tls';
import { request } from 'node:https';
import { request as httpRequest } from 'node:http';

const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });

async function attempt(label, fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: `${label}: ${error.code ?? error.message}` };
  }
}

async function ttlFor(name, type) {
  // resolve4 and resolve6 return TTLs; the generic resolver does not, which is
  // why address records are fetched separately from everything else.
  const fn = type === 'A' ? 'resolve4' : 'resolve6';
  const records = await resolver[fn](name, { ttl: true });
  return records.map((r) => ({ value: r.address, ttl: r.ttl }));
}

async function collectZone(domain, selectors) {
  const zone = { apex: {}, www: {}, _dmarc: {} };
  const errors = [];

  const push = (target, key, result) => {
    if (result.ok) target[key] = result.value;
    else errors.push(result.error);
  };

  push(zone.apex, 'A', await attempt(`${domain} A`, () => ttlFor(domain, 'A')));
  push(zone.apex, 'AAAA', await attempt(`${domain} AAAA`, () => ttlFor(domain, 'AAAA')));
  push(
    zone.apex,
    'CNAME',
    await attempt(`${domain} CNAME`, async () => (await resolver.resolveCname(domain)).map((v) => ({ value: v })))
  );
  push(
    zone.apex,
    'NS',
    await attempt(`${domain} NS`, async () => (await resolver.resolveNs(domain)).map((v) => ({ value: v })))
  );
  push(
    zone.apex,
    'MX',
    await attempt(`${domain} MX`, async () =>
      (await resolver.resolveMx(domain)).map((r) => ({ value: r.exchange, priority: r.priority }))
    )
  );
  push(
    zone.apex,
    'TXT',
    await attempt(`${domain} TXT`, async () => (await resolver.resolveTxt(domain)).map((chunks) => chunks.join('')))
  );
  push(
    zone.apex,
    'CAA',
    await attempt(`${domain} CAA`, async () =>
      (await resolver.resolveCaa(domain)).map((r) => {
        const [tag] = Object.keys(r).filter((k) => k !== 'critical');
        return { flags: r.critical ?? 0, tag, value: r[tag] };
      })
    )
  );
  push(
    zone.apex,
    'SOA',
    await attempt(`${domain} SOA`, async () => {
      const soa = await resolver.resolveSoa(domain);
      return { serial: soa.serial, minimum: soa.minttl };
    })
  );

  push(zone.www, 'A', await attempt(`www.${domain} A`, () => ttlFor(`www.${domain}`, 'A')));
  push(
    zone.www,
    'CNAME',
    await attempt(`www.${domain} CNAME`, async () =>
      (await resolver.resolveCname(`www.${domain}`)).map((v) => ({ value: v }))
    )
  );

  push(
    zone._dmarc,
    'TXT',
    await attempt(`_dmarc.${domain} TXT`, async () =>
      (await resolver.resolveTxt(`_dmarc.${domain}`)).map((chunks) => chunks.join(''))
    )
  );

  for (const selector of selectors) {
    const name = `${selector}._domainkey`;
    zone[name] = {};
    push(
      zone[name],
      'TXT',
      await attempt(`${name}.${domain} TXT`, async () =>
        (await resolver.resolveTxt(`${name}.${domain}`)).map((chunks) => chunks.join(''))
      )
    );
  }

  // A record type that does not exist is not an error worth keeping. A record
  // type that could not be queried at all is, because the difference decides
  // whether a missing record means missing or means unknown.
  return { zone, lookupErrors: errors.filter((e) => !/ENOTFOUND|ENODATA/.test(e)) };
}

function certificateOf(host) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate(false);
      socket.end();
      if (!cert || Object.keys(cert).length === 0) return reject(new Error('no certificate presented'));
      const alt = String(cert.subjectaltname ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^DNS:/, ''))
        .filter(Boolean);
      resolve({
        issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
        subjectAltNames: alt.length > 0 ? alt : [cert.subject?.CN].filter(Boolean),
        notBefore: new Date(cert.valid_from).toISOString(),
        notAfter: new Date(cert.valid_to).toISOString()
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timed out'));
    });
    socket.on('error', reject);
  });
}

function head(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const fn = target.protocol === 'http:' ? httpRequest : request;
    const req = fn(
      { method: 'HEAD', host: target.hostname, path: target.pathname + target.search, protocol: target.protocol, timeout: 8000 },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, headers: res.headers });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function followRedirects(startUrl, limit = 6) {
  const chain = [];
  let current = startUrl;
  for (let i = 0; i < limit; i += 1) {
    const res = await head(current);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      const next = new URL(res.headers.location, current).toString();
      chain.push({ from: current, to: next, status: res.status });
      current = next;
      continue;
    }
    return { chain, final: current, status: res.status, headers: res.headers };
  }
  return { chain, final: current, status: null, headers: {}, truncated: true };
}

async function main() {
  const [domain, outDir = '.'] = process.argv.slice(2);
  if (!domain) {
    process.stderr.write('Usage: node probe/collect.mjs <domain> [output directory] [--selectors a,b]\n');
    return 2;
  }
  const selectorArg = process.argv.find((a) => a.startsWith('--selectors='));
  const selectors = selectorArg ? selectorArg.split('=')[1].split(',').filter(Boolean) : [];

  mkdirSync(outDir, { recursive: true });

  const { zone, lookupErrors } = await collectZone(domain, selectors);
  writeFileSync(join(outDir, 'zone.json'), `${JSON.stringify(zone, null, 2)}\n`);

  const canonical = `https://www.${domain}/`;
  const cert = await attempt('certificate', () => certificateOf(`www.${domain}`));
  const httpChain = await attempt('http redirect chain', () => followRedirects(`http://${domain}/`));
  const httpsHead = await attempt('https head', () => head(canonical));

  const observed = {
    now: new Date().toISOString(),
    httpReachable: httpChain.ok,
    httpsReachable: httpsHead.ok,
    certificate: cert.ok ? cert.value : null,
    redirectChain: httpChain.ok ? httpChain.value.chain : [],
    headers: httpsHead.ok ? httpsHead.value.headers : {},
    collectionErrors: [cert, httpChain, httpsHead].filter((r) => !r.ok).map((r) => r.error)
  };
  writeFileSync(join(outDir, 'observed.json'), `${JSON.stringify(observed, null, 2)}\n`);

  process.stdout.write(`Wrote zone.json and observed.json for ${domain} into ${outDir}\n`);
  if (lookupErrors.length > 0) {
    process.stdout.write(`Lookups that failed rather than returned nothing:\n  ${lookupErrors.join('\n  ')}\n`);
  }
  if (observed.collectionErrors.length > 0) {
    process.stdout.write(`Could not collect:\n  ${observed.collectionErrors.join('\n  ')}\n`);
  }
  process.stdout.write('Neither file says anything about whether the migration is safe. Run migrate-check for that.\n');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
