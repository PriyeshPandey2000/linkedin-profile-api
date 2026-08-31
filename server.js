// Entry-point shim (CommonJS). The real implementation lives in the
// TypeScript source at ./server.ts and is compiled to ./dist/server.js by
// the build step (npm run build / npm start). This thin shim just loads
// the compiled output so the `node server.js` entrypoint keeps working
// unchanged.

require('./dist/server');
