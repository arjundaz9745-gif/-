const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');
const { parseDuration } = require('../utils/duration');

function ensure() {
  const d = dataStore.get();
  if (!d.events) d.events = {};
  return d.events;
}

/** pending: userId -> { name, endsAt, guildId, channelId } */
const pendingCreate = new Map();

function setPending(userId, data) {
  pendingCreate.set(String(userId), { ...data, expires: Date.now() + 120000 });
}

function getPending(userId) {
  const p = pendingCreate.get(String(userId));
  if (!p) return null;
  if (Date.now() > p.expires) {
    pendingCreate.delete(String(userId));
    return null;
  }
  return p;
}

function clearPending(userId) {
  pendingCreate.delete(String(userId));
}

function createEvent({ guildId, channelId, name, body, endsAt, createdBy }) {
  const ev = ensure();
  const id = Date.now().toString(36);
  ev[id] = {
    id,
    guildId,
    channelId,
    name,
    body,
    endsAt, // null = infinite
    createdBy,
    payoutStaff: {}, // staffId -> count of confirmed legits
    active: true
  };
  dataStore.save();
  return ev[id];
}

function listActive(guildId) {
  return Object.values(ensure()).filter((e) => e.active && e.guildId === guildId);
}

function markPayout(eventId, staffId) {
  const e = ensure()[eventId];
  if (!e || !e.active) return;
  e.payoutStaff[staffId] = (e.payoutStaff[staffId] || 0) + 1;
  dataStore.save();
}

function endEvent(eventId, client) {
  const e = ensure()[eventId];
  if (!e || !e.active) return;
  e.active = false;
  dataStore.save();
  const staffCount = Object.keys(e.payoutStaff).length;
  const totalPays = Object.values(e.payoutStaff).reduce((a, b) => a + b, 0);
  const ch = client?.channels?.cache?.get(e.channelId);
  if (ch) {
    ch.send(
      `**${e.name}** is over and **${totalPays}** payouts have been done by **${staffCount}** staff.`
    ).catch(() => {});
  }
}

function tickEvents(client) {
  const now = Date.now();
  for (const e of Object.values(ensure())) {
    if (!e.active || e.endsAt == null) continue;
    if (now >= e.endsAt) endEvent(e.id, client);
  }
}

module.exports = {
  setPending,
  getPending,
  clearPending,
  createEvent,
  listActive,
  markPayout,
  endEvent,
  tickEvents,
  ensure
};
