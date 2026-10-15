/**
 * ▶ Test route: the exact route and steps a visitor would get, computed with the same
 * @innermap/core functions the phone app uses. Memoised per document + test settings.
 */
import type { Route, Site, Step } from '@innermap/core';
import { buildDirections, findRoute, loadSite } from '@innermap/core';
import type { MapFile } from '@innermap/schema';
import type { RouteTest } from '../model/store';

export interface TestResult {
  readonly route: Route | null;
  readonly steps: readonly Step[];
  readonly error: string | null;
}

const ERRORS = {
  'unknown-start': 'The start dot no longer exists.',
  'unknown-destination': 'That destination no longer exists.',
  'no-route': 'No way to get there from the start (with these settings).',
} as const;

let cache: { doc: MapFile; test: RouteTest; result: TestResult } | null = null;
let siteCache: { doc: MapFile; site: Site } | null = null;

export function testRoute(doc: MapFile, test: RouteTest): TestResult {
  if (cache && cache.doc === doc && cache.test === test) return cache.result;
  const result = compute(doc, test);
  cache = { doc, test, result };
  return result;
}

function compute(doc: MapFile, test: RouteTest): TestResult {
  if (!test.from || !test.to) return { route: null, steps: [], error: null };
  if (siteCache?.doc !== doc) siteCache = { doc, site: loadSite(doc) };
  const { site } = siteCache;
  const found = findRoute(site, {
    from: test.from,
    to: test.to,
    profile: { stepFree: test.stepFree },
  });
  if (!found.ok) return { route: null, steps: [], error: ERRORS[found.error.code] };
  // A start on a QR sticker uses its facing, like a visitor who just scanned it.
  const qr = doc.qr.find((q) => q.node === test.from);
  const steps = buildDirections(site, found.value, qr ? { startFacing: qr.facing } : {});
  return { route: found.value, steps, error: null };
}
