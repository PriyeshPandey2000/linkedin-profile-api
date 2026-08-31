// One error shape for the whole app. Routes/services throw these (or let
// errorHandler.js map an unrecognized error to a generic 500) instead of
// each place inventing its own status-code/message convention.

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(message: string, code = 'BAD_REQUEST'): AppError {
    return new AppError(400, code, message);
  }

  static unauthorized(message: string, code = 'UNAUTHORIZED'): AppError {
    return new AppError(401, code, message);
  }

  static notFound(message: string, code = 'NOT_FOUND'): AppError {
    return new AppError(404, code, message);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE'): AppError {
    return new AppError(503, code, message);
  }

  static timeout(message = 'Request timed out.', code = 'TIMEOUT'): AppError {
    return new AppError(504, code, message);
  }

  static internal(message = 'Internal server error.', code = 'INTERNAL'): AppError {
    return new AppError(500, code, message);
  }
}
