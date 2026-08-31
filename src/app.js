const express = require('express');

const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const { AppError } = require('./errors');
const healthRoutes = require('./routes/health.routes');
const profileRoutes = require('./routes/profile.routes');

function createApp() {
  const app = express();

  // trust proxy: needed once this sits behind nginx (Hetzner deployment)
  // so req.ip / rate-limiting-by-IP (if added later) reflect the real
  // client, not the proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(express.json({ limit: '10kb' })); // request bodies here are just {url}, no reason to accept more

  app.get('/', (req, res) => {
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
  app.use((req, res, next) => {
    next(AppError.notFound(`No route: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND'));
  });

  app.use(errorHandler); // must be registered last

  return app;
}

module.exports = { createApp };
