import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { AppError } from '../errors';

// Centralized error handling -- every route's errors funnel through here
// via next(err), so status codes/response shape stay consistent instead
// of each route improvising its own. Full detail (stack trace) goes to
// the server log only; the client only ever sees a status code, a stable
// machine-readable "code" string, and a message safe to display.
export default function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL';
  const message = isAppError ? err.message : 'Something went wrong processing this request.';

  logger.error(err instanceof Error ? err.message : String(err), {
    requestId: req.id,
    statusCode,
    code,
    path: req.path,
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    error: { code, message },
    requestId: req.id,
  });
}
