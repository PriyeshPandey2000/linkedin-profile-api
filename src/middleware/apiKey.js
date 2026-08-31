// API-key gate for this service's own endpoints (separate concern from
// the LinkedIn session cookie -- this protects against random callers
// burning a scarce, single-account LinkedIn session, not LinkedIn auth).
//
// Deliberately OFF by default: no-op unless API_KEY is set in the
// environment. Expected usage for this challenge is low-volume manual/
// interviewer testing, so this was consciously descoped rather than
// left undone by oversight (see README known limitations). Set API_KEY
// and every request must send a matching X-Api-Key header.

const { AppError } = require('../errors');
const config = require('../config');

module.exports = function apiKey(req, res, next) {
  if (!config.apiKey) return next(); // gate disabled

  const provided = req.get('X-Api-Key');
  if (provided !== config.apiKey) {
    return next(AppError.unauthorized('Missing or invalid X-Api-Key header.'));
  }
  next();
};
