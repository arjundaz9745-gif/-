const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const env = require('../config/env');

const spamTracker = new Map();
const joinTracker = new Map();

function trackWindow(map, key, windowMs) {
  const now = Date.now();
  let arr = (map.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  map.set(key, arr);
  return arr.length;
}

function getProtection() {
  return dataStore.get().protection || {};
}

async function logProtect(client, guild, title, body) {
  const data = dataStore.get();
  const id = env.LOG_CHANNEL_ID || data.settings?.logChannelId;
  if (!id) return;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (ch?.isTextBased?.()) await ch.send({ embeds: [E(title, body, require('../config/brand').red)] }).catch(() => {});
}

module.exports = { trackWindow, spamTracker, joinTracker, getProtection, logProtect };
