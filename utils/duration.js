function parseDuration(raw) {
  const m = String(raw || '').trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  return parseInt(m[1], 10) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()]);
}
function formatUptime(sec) {
  const s = Math.floor(sec);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}
module.exports = { parseDuration, formatUptime };
