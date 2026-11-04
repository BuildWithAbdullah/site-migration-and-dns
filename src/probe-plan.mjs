// Everything the collector decides, separated from everything it does.
//
// probe/collect.mjs is the only part of this repository that touches the
// network, and the reasoning behind that split was that collection cannot be
// tested because it depends on somebody else's nameserver. True of the lookups.
// Not true of the argument parsing or of how results are turned into the files
// the checks read, and those were sitting in the same untested file:
//
//   node probe/collect.mjs example.org --selectors=sel1
//
// The arguments were destructured positionally, so the flag became the output
// directory and the collector wrote zone.json into a new directory literally
// named --selectors=sel1. The usage line documented the space separated form,
// --selectors a,b, which the parser did not accept at all, so following the
// documentation silently collected no DKIM records, which is the only reason
// that flag exists. None of it could fail a test, because there was no test
// that could reach it.

const SELECTOR_FLAG = '--selectors';

export const PROBE_USAGE = `Usage: collect <domain> [output directory] [--selectors a,b]

Writes zone.json and observed.json into the output directory, which defaults to
the current one. Neither file says anything about whether the migration is safe.
Run migrate-check for that.

  --selectors a,b   DKIM selectors to look up, comma separated
  --help
`;

/**
 * Returns { ok: true, options: { domain, outDir, selectors, help } } or
 * { ok: false, message }. A flag is never mistaken for a positional argument,
 * and both the documented spelling and the equals spelling are accepted,
 * because a flag that only works one way is a flag that mostly does not work.
 */
export function parseProbeArgs(argv) {
  const options = { domain: null, outDir: '.', selectors: [], help: false };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === SELECTOR_FLAG || arg.startsWith(`${SELECTOR_FLAG}=`)) {
      const value = arg.startsWith(`${SELECTOR_FLAG}=`) ? arg.slice(SELECTOR_FLAG.length + 1) : argv[++i];
      if (value === undefined || value.startsWith('-')) {
        return { ok: false, message: `${SELECTOR_FLAG} needs a comma separated list of selectors` };
      }
      options.selectors = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith('-')) return { ok: false, message: `unknown option ${arg}` };
    positional.push(arg);
  }

  if (options.help) return { ok: true, options };
  if (positional.length === 0) return { ok: false, message: 'a domain is required' };
  if (positional.length > 2) return { ok: false, message: 'at most a domain and an output directory' };

  options.domain = positional[0];
  if (positional.length === 2) options.outDir = positional[1];
  return { ok: true, options };
}

/** The names to look up for a set of DKIM selectors. */
export function dkimNames(selectors) {
  return selectors.map((selector) => `${selector}._domainkey`);
}

/**
 * A lookup that returned nothing is not an error worth keeping; a lookup that
 * could not be made is, because the difference decides whether a missing record
 * means missing or means unknown.
 */
export function keepRealErrors(errors) {
  return errors.filter((message) => !/ENOTFOUND|ENODATA/.test(message));
}

/**
 * Build observed.json from what was collected. Separate from the collecting so
 * that what happens to a partial collection is a decision with a test on it
 * rather than a line in the middle of a network call.
 */
export function assembleObserved({ now, certificate, httpChain, httpsHead }) {
  const observed = {
    now,
    httpReachable: httpChain.ok,
    httpsReachable: httpsHead.ok,
    certificate: certificate.ok ? certificate.value : null,
    redirectChain: httpChain.ok ? httpChain.value.chain : [],
    headers: httpsHead.ok ? httpsHead.value.headers : {},
    collectionErrors: [certificate, httpChain, httpsHead].filter((r) => !r.ok).map((r) => r.error)
  };

  // A chain that hit the hop limit is a chain we gave up on, and the six hops
  // collected from it look exactly like a complete chain ending in plain http.
  // Dropping the flag meant the ssl checks were handed a truncated chain as
  // though it were the whole story, so a long redirect loop was reported as a
  // site that never reaches https.
  if (httpChain.ok && httpChain.value.truncated === true) {
    observed.redirectChainTruncated = true;
    observed.collectionErrors.push(
      `http redirect chain: gave up after ${httpChain.value.chain.length} hops without reaching a final response`
    );
  }

  return observed;
}
