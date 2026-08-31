import express from 'express';
import type { Request, Response, NextFunction } from 'express';

import requestId from './middleware/requestId';
import errorHandler from './middleware/errorHandler';
import { AppError } from './errors';
import healthRoutes from './routes/health.routes';
import profileRoutes from './routes/profile.routes';

export function createApp(): express.Express {
  const app = express();

  // trust proxy: needed once this sits behind nginx (Hetzner deployment)
  // so req.ip / rate-limiting-by-IP (if added later) reflect the real
  // client, not the proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(express.json({ limit: '10kb' })); // request bodies here are just {url}, no reason to accept more

  app.get('/', (req: Request, res: Response) => {
    res.json({
      name: 'LinkedIn Profile API',
      endpoints: {
        'POST /profile': 'body: { "url": "https://www.linkedin.com/in/<slug>/" }',
        'GET /health': 'liveness check',
      },
    });
  });

  app.use(healthRoutes);
  app.use(profileRoutes);

  // anything that reaches here matched no route
  app.use((req: Request, res: Response, next: NextFunction) => {
    next(AppError.notFound(`No route: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
  });

  app.use(errorHandler); // must be registered last

  return app;
}
