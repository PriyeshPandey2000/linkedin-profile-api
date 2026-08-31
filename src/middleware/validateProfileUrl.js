const { AppError } = require('../errors');

// Deliberately permissive on trailing path/query (LinkedIn profile URLs
// sometimes carry tracking params or a locale segment) but strict on host
// and the /in/<slug> shape -- rejects anything that isn't a LinkedIn
// profile URL before spending any time/requests on it.
const LINKEDIN_PROFILE_URL = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?/i;

module.exports = function validateProfileUrl(req, res, next) {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return next(AppError.badRequest('Request body must include a "url" string field.', 'MISSING_URL'));
  }

  const trimmed = url.trim();
  if (!LINKEDIN_PROFILE_URL.test(trimmed)) {
    return next(AppError.badRequest(
      'url must be a LinkedIn profile URL, e.g. https://www.linkedin.com/in/some-person/',
      'INVALID_URL'
    ));
  }

  req.body.url = trimmed;
  next();
};
