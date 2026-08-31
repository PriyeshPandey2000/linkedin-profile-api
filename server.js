// Entry point. Kept at project root (standard Node convention) --
// everything it wires together lives under src/.

require('dotenv').config({ quiet: true }); // load .env before anything reads process.env

const config = require('./src/config');
const logger = require('./src/logger');
const { createApp } = require('./src/app');

// Fail fast: if the scraping engine's prerequisites aren't in place
// (templates.json missing), say so clearly now, not on the first request.
try {
  config.assertReady();
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`Server listening`, { port: config.port, env: config.env });
});

// Graceful shutdown: stop accepting new connections, let in-flight
// requests finish, then exit. Matters once this runs under a process
// manager/container orchestrator that sends SIGTERM on deploy/restart.
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  // don't hang forever waiting for slow in-flight scrapes
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || String(reason) });
});
