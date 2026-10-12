/**
 * Authorized users for /premium · -premium · vault staff actions
 * Permanent: 1541659394188509215, 1080190046138802306
 * /auth @user [time] — time optional = unlimited until removed
 */
const dataStore = require('../utils/data');
const { parseDuration } = require('../utils/duration');

const PERMANENT = new Set(
  String(process.env.BOT_OWNER_IDS || '1541659394188509215,1080190046138802306')
    .split(/[,;\s]+/)
    .filter(Boolean)
);

function ensure() {
  const d = dataStore.get();
  if (!d.authorizedUsers) d.authorizedUsers = {};
  // prune expired
  const now = Date.now();
  for (const [id, row] of Object.entries(d.authorizedUsers)) {
    if (row.expiresAt && row.expiresAt < now) delete d.authorizedUsers[id];
  }
  return d.authorizedUsers;
}

function isPermanent(userId) {
  return PERMANENT.has(String(userId));
}

function isAuthorized(userId) {
  const id = String(userId);
  if (isPermanent(id)) return true;
  const map = ensure();
  const row = map[id];
  if (!row) return false;
  if (row.expiresAt && row.expiresAt < Date.now()) {
    delete map[id];
    dataStore.save();
    return false;
  }
  return true;
}

/** @returns {{ ok, expiresAt|null, unlimited }} */
function authorize(userId, durationRaw, by) {
  const id = String(userId);
  if (isPermanent(id)) return { ok: true, unlimited: true, expiresAt: null, permanent: true };
  let expiresAt = null;
  if (durationRaw && String(durationRaw).trim()) {
    const ms = parseDuration(String(durationRaw).trim());
    if (!ms || ms < 1000) return { ok: false, error: 'bad duration (e.g. 1h, 7d, 30m)' };
    expiresAt = Date.now() + ms;
  }
  const map = ensure();
  map[id] = { expiresAt, by: by || null, at: Date.now() };
  dataStore.save();
  return { ok: true, unlimited: !expiresAt, expiresAt, permanent: false };
}

function revoke(userId) {
  const id = String(userId);
  if (isPermanent(id)) return { ok: false, error: 'cannot revoke permanent admin' };
  const map = ensure();
  if (!map[id]) return { ok: false, error: 'not authorized' };
  delete map[id];
  dataStore.save();
  return { ok: true };
}

function list() {
  const map = ensure();
  return {
    permanent: [...PERMANENT],
    temporary: Object.entries(map).map(([id, row]) => ({
      id,
      expiresAt: row.expiresAt || null,
      unlimited: !row.expiresAt
    }))
  };
}

module.exports = {
  PERMANENT,
  isPermanent,
  isAuthorized,
  authorize,
  revoke,
  list,
  ensure
};
