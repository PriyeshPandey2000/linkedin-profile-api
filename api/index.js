// Vercel serverless entry point. Vercel's Node runtime wraps whatever this
// file exports as the request handler for every path (see vercel.json's
// rewrite -- all incoming requests are routed here, Express's own routing
// in src/app.js then dispatches based on the real path/method).
//
// Deliberately does NOT call app.listen() -- Vercel manages the actual
// server/port itself; a serverless function just needs to export a
// (req, res) => {} compatible handler, which an Express app already is.
// Local development uses server.js instead (npm start), which does call
// .listen() for a normal long-running process.

const config = require('../src/config');
const { createApp } = require('../src/app');

// Fail fast at cold start, same intent as server.js -- but no
// process.exit() here: that's a normal-process pattern, not appropriate
// inside a serverless function's module load. Let it throw; Vercel
// surfaces that as a function initialization error, which is still far
// clearer than silently serving broken requests.
config.assertReady();

module.exports = createApp();
