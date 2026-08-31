// Vercel serverless entry-point shim (CommonJS). The real implementation
// lives in the TypeScript source at ./index.ts and is compiled to
// ../dist/api/index.js by the build step. Vercel's Node runtime wraps
// whatever this file exports as the request handler for every path (see
// vercel.json's rewrite -- all incoming requests are routed here, Express's
// own routing in src/app.ts then dispatches based on the real path/method).
//
// Deliberately does NOT call app.listen() -- Vercel manages the actual
// server/port itself; a serverless function just needs to export a
// (req, res) => {} compatible handler, which an Express app already is.
// Local development uses server.js instead (npm start), which does call
// .listen() for a normal long-running process.

module.exports = require('../dist/api/index');
