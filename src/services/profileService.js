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

// NOTE: this races a timeout against fetchProfile() -- it stops the HTTP
// response from hanging forever, but does NOT actually cancel the
// in-flight scrape (no AbortController wired through lib/fetch-profile.js
// yet). A timed-out request still finishes its LinkedIn calls in the
// background. Acceptable for now given expected request volume (see
// README known limitations); true cancellation would need AbortSignal
// threaded through every fetch() call in the lib.
async function getProfile(url) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(AppError.timeout(`Profile scrape exceeded ${config.requestTimeoutMs}ms.`));
    }, config.requestTimeoutMs);
  });

  try {
    return await Promise.race([fetchProfile(url), timeoutPromise]);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const mapper = ERROR_CODE_MAP[err.code];
    if (mapper) throw mapper(err.message);
    throw AppError.internal(`Failed to fetch profile: ${err.message}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

module.exports = { getProfile };
