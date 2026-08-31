// Minimal structured logger -- one JSON object per line to stdout/stderr.
// No external dependency: this app's log volume doesn't need a full
// logging library, but plain console.log scattered through the codebase
// makes production debugging much harder than it needs to be. This gives
// consistent, greppable/parseable fields (timestamp, level, requestId)
// for roughly the cost of a console.log call.

function write(level, message, meta = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
