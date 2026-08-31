const logger = require('../logger');
const { AppError } = require('../errors');

// Centralized error handling -- every route's errors funnel through here
// via next(err), so status codes/response shape stay consistent instead
// of each route improvising its own. Full detail (stack trace) goes to
// the server log only; the client only ever sees a status code, a stable
// machine-readable "code" string, and a message safe to display.
module.exports = function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL';
  const message = isAppError ? err.message : 'Something went wrong processing this request.';

  logger.error(err.message, {
    requestId: req.id,
    statusCode,
    code,
    path: req.path,
    stack: err.stack,
  });

  res.status(statusCode).json({
    success: false,
    error: { code, message },
    requestId: req.id,
  });
};
