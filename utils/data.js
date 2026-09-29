const fs = require('fs');
const path = require('path');

const DATA_PATH = (process.env.RENDER || process.env.PORT)
  ? path.join('/tmp', 'dashmod-data.json')
  : path.join(__dirname, '..', 'data.json');

function defaultData() {
  return {
    inviteStats: {}, inviteUses: {}, invitedBy: {}, messages: {}, stocks: {},
    warnings: {}, giveaways: {}, afk: {}, snipes: {}, autorole: {}, autoreact: {},
    levels: {}, tickets: {},
    protection: {
      antiraid: true, automod: true, antinuke: true,
      spamLimit: 6, spamWindowMs: 5000, joinLimit: 8, joinWindowMs: 10000, badWords: []
    },
    syncChannelId: process.env.SYNC_CHANNEL_ID || null,
    aiChannelId: process.env.AI_CHANNEL_ID || null,
    settings: {}
  };
}

let data = null;

function load() {
  try {
    if (fs.existsSync(DATA_PATH)) data = { ...defaultData(), ...JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) };
    else data = defaultData();
  } catch (_) { data = defaultData(); }
  return data;
}

function get() {
  if (!data) load();
  return data;
}

function save() {
  try { fs.writeFileSync(DATA_PATH, JSON.stringify(get(), null, 2)); } catch (e) { console.error('save', e.message); }
}

module.exports = { load, get, save, DATA_PATH };
