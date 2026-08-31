// One error shape for the whole app. Routes/services throw these (or let
// errorHandler.js map an unrecognized error to a generic 500) instead of
// each place inventing its own status-code/message convention.

class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

AppError.badRequest = (message, code = 'BAD_REQUEST') => new AppError(400, code, message);
AppError.unauthorized = (message, code = 'UNAUTHORIZED') => new AppError(401, code, message);
AppError.notFound = (message, code = 'NOT_FOUND') => new AppError(404, code, message);
AppError.serviceUnavailable = (message, code = 'SERVICE_UNAVAILABLE') => new AppError(503, code, message);
AppError.timeout = (message = 'Request timed out.', code = 'TIMEOUT') => new AppError(504, code, message);
AppError.internal = (message = 'Internal server error.', code = 'INTERNAL') => new AppError(500, code, message);

module.exports = { AppError };
