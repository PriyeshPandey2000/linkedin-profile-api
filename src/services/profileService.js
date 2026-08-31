const path = require('path');
const { fetchProfile } = require(path.join(__dirname, '..', '..', 'lib', 'fetch-profile'));
const { AppError } = require('../errors');
const config = require('../config');

// Maps the plain Error + .code values lib/fetch-profile.js throws (kept
// dependency-free from the Express layer on purpose, see that file's
// comments) onto proper HTTP semantics.
const ERROR_CODE_MAP = {
  SESSION_EXPIRED: (msg) => AppError.serviceUnavailable(
    `${msg} Re-run the session bootstrap (see README setup) to refresh it.`,
    'SESSION_EXPIRED'
  ),
  PROFILE_NOT_FOUND: (msg) => AppError.notFound(msg, 'PROFILE_NOT_FOUND'),
};

// Only one LinkedIn session (this service's own account) backs every
// request -- concurrent or repeat calls for the same profile add load and
// ban-risk that buys nothing (the data hasn't changed in the meantime).
// Two cheap, in-memory (instance-scoped, not shared/distributed --
// best-effort on serverless, but that's exactly where a burst of
// near-simultaneous requests hits one warm instance) protections:
// - TTL cache: a profile fetched successfully is served from memory for
//   config.profileCacheTtlMs before the next request re-scrapes it.
// - In-flight coalescing: concurrent requests for the same URL share one
//   underlying fetchProfile() call instead of firing one each.
const cache = new Map(); // url -> { data, scrapedAt, expiresAt }
const inFlight = new Map(); // url -> Promise<{ data, scrapedAt }>

function getCached(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return null;
  }
  return entry;
}

// Hitting the timeout aborts the underlying fetch() calls for real
// (AbortController -> AbortSignal threaded through every request in
// lib/fetch-profile.js) rather than just giving up on waiting for them --
// a timed-out scrape no longer keeps burning the shared LinkedIn session
// in the background after the client's gotten its 504.
function scrapeWithTimeout(url) {
  const controller = new AbortController();
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(AppError.timeout(`Profile scrape exceeded ${config.requestTimeoutMs}ms.`));
    }, config.requestTimeoutMs);
  });

  const scrapePromise = fetchProfile(url, { signal: controller.signal });
  // The timeout branch is what the caller sees on a timeout (it settles
  // first) -- this just prevents scrapePromise's own later AbortError
  // rejection from surfacing as an unhandled rejection once nothing else
  // is awaiting it.
  scrapePromise.catch(() => {});

  return Promise.race([scrapePromise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

// Returns { data, scrapedAt, cached } -- scrapedAt is always the time the
// underlying LinkedIn scrape actually happened, not "now": a cache hit
// must report the ORIGINAL scrape time (it can be served up to
// config.profileCacheTtlMs stale), not a fresh timestamp that would make
// stale data look freshly scraped.
async function getProfile(url) {
  const cached = getCached(url);
  if (cached) return { data: cached.data, scrapedAt: cached.scrapedAt, cached: true };

  let promise = inFlight.get(url);
  if (!promise) {
    promise = scrapeWithTimeout(url)
      .then((data) => {
        const scrapedAt = new Date().toISOString();
        cache.set(url, { data, scrapedAt, expiresAt: Date.now() + config.profileCacheTtlMs });
        return { data, scrapedAt };
      })
      .finally(() => inFlight.delete(url));
    inFlight.set(url, promise);
  }

  try {
    const result = await promise;
    return { ...result, cached: false };
  } catch (err) {
    if (err instanceof AppError) throw err;
    const mapper = ERROR_CODE_MAP[err.code];
    if (mapper) throw mapper(err.message);
    throw AppError.internal(`Failed to fetch profile: ${err.message}`);
  }
}

module.exports = { getProfile };
