// Assigns a unique id to every incoming request, echoed back in the
// X-Request-Id response header. Costs nothing, and is the difference
// between "a request failed somewhere in the logs" and "here is the exact
// request a specific client can report back to us."

const crypto = require('crypto');

module.exports = function requestId(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
