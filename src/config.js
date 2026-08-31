// Single source of truth for runtime config. Loaded and validated once at
// startup -- if something required is missing, fail immediately with a
// clear message instead of crashing confusingly mid-request later.

const fs = require('fs');
const path = require('path');

const TEMPLATES_PATH = path.join(__dirname, '..', 'lib', 'templates.json');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,

  // Overall time budget for a single profile scrape. Pagination loops
  // (Skills/Education/Certifications) can take several sequential
  // requests -- this guards against a hung request holding the HTTP
  // connection open indefinitely if something upstream stalls.
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 180000,

  // How long a successfully-scraped profile is served from cache before
  // re-fetching. Protects the single shared LinkedIn session from
  // redundant concurrent/repeat load (see profileService.js) -- not a
  // freshness guarantee, just a short window against duplicate requests.
  profileCacheTtlMs: Number(process.env.PROFILE_CACHE_TTL_MS) || 5 * 60 * 1000,

  // Not enforced yet -- deliberately descoped for now (expected usage is
  // low-volume manual/interviewer testing, see README known limitations).
  // Left wired through config/middleware so turning it on later is a
  // one-line change (uncomment the check in middleware/apiKey.js), not a
  // redesign.
  apiKey: process.env.API_KEY || null,
};

function assertReady() {
  if (!fs.existsSync(TEMPLATES_PATH)) {
    throw new Error(
      `${TEMPLATES_PATH} not found. The scraping engine cannot run without it -- ` +
      `see README setup instructions.`
    );
  }

  // The committed templates.json has its cookie/csrf-token fields
  // redacted (see README) -- LINKEDIN_COOKIE must be set at runtime to
  // supply the real value. Check the actual condition directly (is the
  // baked-in value the redacted placeholder?) rather than inferring it
  // from NODE_ENV, so this also catches a local run against a redacted
  // file, not just a production deploy.
  const templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
  const cookieIsRedacted = (templates.componentTemplate?.headers?.cookie || '').startsWith('REDACTED');
  if (cookieIsRedacted && !process.env.LINKEDIN_COOKIE) {
    throw new Error(
      'lib/templates.json has its session cookie redacted and LINKEDIN_COOKIE is not ' +
      'set in the environment. Set LINKEDIN_COOKIE to a valid LinkedIn Cookie header ' +
      'value (see README setup instructions) before starting the server.'
    );
  }
}

module.exports = { ...config, assertReady, TEMPLATES_PATH };
