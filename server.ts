// Entry point (TypeScript source). Kept at project root (standard Node
// convention) -- everything it wires together lives under src/. The root
// server.js shim requires the compiled output of this file (dist/server.js).

import dotenv from 'dotenv'; // load .env before anything reads process.env
import { config, assertReady } from './src/config';
import { logger } from './src/logger';
import { createApp } from './src/app';

dotenv.config({ quiet: true });

// Fail fast: if the scraping engine's prerequisites aren't in place
// (templates.json missing), say so clearly now, not on the first request.
try {
  assertReady();
} catch (err) {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('Server listening', { port: config.port, env: config.env });
});

// Graceful shutdown: stop accepting new connections, let in-flight
// requests finish, then exit. Matters once this runs under a process
// manager/container orchestrator that sends SIGTERM on deploy/restart.
function shutdown(signal: string): void {
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

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
