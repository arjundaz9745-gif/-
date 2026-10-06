/** In-memory panel console log (last N lines) */
const MAX = 400;
const lines = [];
let startedAt = Date.now();

function push(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] [${String(level || 'info').toUpperCase()}] ${String(msg || '')}`;
  lines.push(line);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  return line;
}

function info(msg) {
  return push('info', msg);
}
function warn(msg) {
  return push('warn', msg);
}
function error(msg) {
  return push('error', msg);
}
function getLines(limit = 200) {
  return lines.slice(-(limit || 200));
}
function markStart() {
  startedAt = Date.now();
  info('Process start / ready');
}
function getStartedAt() {
  return startedAt;
}

module.exports = { push, info, warn, error, getLines, markStart, getStartedAt };
