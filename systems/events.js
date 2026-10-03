const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');

function getEvents() {
  const d = dataStore.get();
  if (!d.dropEvents) d.dropEvents = {};
  return d.dropEvents;
}

/** -event 1h 1=mcfa 2=netflix */
function parseEventArgs(args) {
  // time first
  const timeRaw = args[0];
  const rewards = [];
  for (let i = 1; i < args.length; i++) {
    const m = String(args[i]).match(/^(\d+)\s*=\s*([a-z0-9_]+)$/i);
    if (m) rewards.push({ invites: parseInt(m[1], 10), reward: m[2].toLowerCase() });
  }
  return { timeRaw, rewards };
}

module.exports = { getEvents, parseEventArgs };
