/**
 * Gen stock pools — Freemium / Booster / Premium
 */
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const env = require('../config/env');
const fs = require('fs');
const path = require('path');

// File-backed stock: data/stock/<key>.txt (override with STOCK_DIR)
const STOCK_DIR = process.env.STOCK_DIR || path.join(__dirname, '..', 'data', 'stock');
function ensureStockDir() {
  if (!fs.existsSync(STOCK_DIR)) fs.mkdirSync(STOCK_DIR, { recursive: true });
}
function stockFile(key) {
  ensureStockDir();
  return path.join(STOCK_DIR, `${String(key).toLowerCase().replace(/[^a-z0-9_-]/g, '')}.txt`);
}
function readStockFile(key) {
  try {
    const f = stockFile(key);
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch { return []; }
}
function writeStockFile(key, lines) {
  try {
    fs.writeFileSync(stockFile(key), (lines || []).join('\n') + (lines?.length ? '\n' : ''), 'utf8');
  } catch (e) { console.error('[stock-file]', key, e.message); }
}
function appendStockFile(key, line) {
  const lines = readStockFile(key);
  lines.push(line);
  writeStockFile(key, lines);
}
function shiftStockFile(key) {
  const lines = readStockFile(key);
  if (!lines.length) return null;
  const first = lines.shift();
  writeStockFile(key, lines);
  return first;
}

/** item key → emoji name on server + label + vault */
const PRODUCT_KEYS = {
  // Freemium
  mcnfa: { emoji: 's_yellow', label: 'Mcnfa', unicode: '🟡', vault: 'fgen' },
  xbox: { emoji: 's_yellow', label: 'Xbox', unicode: '🟡', vault: 'fgen' },
  steam: { emoji: 's_yellow', label: 'Steam', unicode: '🟡', vault: 'fgen' },
  crunchyroll: { emoji: 's_yellow', label: 'CrunchyRoll', unicode: '🟡', vault: 'fgen' },
  xbox_code: { emoji: 's_yellow', label: 'Xbox Code', unicode: '🟡', vault: 'fgen' },
  xboxcode: { emoji: 's_yellow', label: 'Xbox Code', unicode: '🟡', vault: 'fgen' },
  netflix: { emoji: 's_yellow', label: 'Netflix', unicode: '🟡', vault: 'fgen' },
  // Booster
  mcsfa: { emoji: 'purple_1', label: 'Mcsfa', unicode: '🟣', vault: 'bgen' },
  donut: { emoji: 'purple_1', label: 'Donut', unicode: '🟣', vault: 'bgen' },
  hypixel: { emoji: 'purple_1', label: 'Hypixel', unicode: '🟣', vault: 'bgen' },
  // Premium (optional pool)
  mcfa: { emoji: 'blue_sparkle', label: 'MCFA', unicode: '💎', vault: 'pgen' }
};

function resolveEmoji(guild, key) {
  const meta = PRODUCT_KEYS[key] || { emoji: key, unicode: '📦', label: key };
  if (!guild) return meta.unicode || '📦';
  const name = meta.emoji;
  const found =
    guild.emojis.cache.find((e) => e.name.toLowerCase() === String(name).toLowerCase()) ||
    null;
  if (found) return found.toString();
  // also try client-wide if passed later
  return meta.unicode || '📦';
}

function getData() {
  const d = dataStore.get();
  if (!d.stocks) d.stocks = {};
  if (!d.methods) d.methods = {};
  if (!d.fgen) d.fgen = {};
  if (!d.bgen) d.bgen = {};
  if (!d.pgen) d.pgen = {};
  if (!d.tutorials) d.tutorials = {};
  if (!d.genConfig) {
    d.genConfig = {
      freeRoleId: process.env.FREE_GEN_ROLE_ID || '1555427829800239175',
      premiumRoleId: process.env.PREMIUM_GEN_ROLE_ID || '1556280665140363274',
      boosterRoleId: process.env.BOOSTER_GEN_ROLE_ID || '',
      freeChannelId: process.env.FREE_GEN_CHANNEL_ID || '1555793184250929325',
      boosterChannelId: process.env.BOOSTER_GEN_CHANNEL_ID || '1555793184250929325',
      premiumChannelId: process.env.PREMIUM_GEN_CHANNEL_ID || '1555793184250929325',
      cmdChannelId: process.env.CMD_CHANNEL_ID || '1553617826814890085',
      vouchChannelId: process.env.VOUCH_CHANNEL_ID || '1556279907838074970',
      vouchUserId: process.env.VOUCH_USER_ID || '1556221818325696512',
      announceChannelId: process.env.GEN_ANNOUNCE_CHANNEL_ID || '',
      restockUserId: process.env.RESTOCK_USER_ID || '1398979148063571989',
      premiumSellerId: process.env.PREMIUM_SELLER_ID || '1398979148063571989',
      premiumPrice: process.env.PREMIUM_PRICE || '$5',
      freeStatusText: process.env.FREE_STATUS_TEXT || 'Free G3n at discord.gg/TcU29KHkAt',
      statusInvite: process.env.STATUS_INVITE || 'TcU29KHkAt'
    };
  }
  // merge env overrides if set later
  return d;
}

function addStock(pool, key, line) {
  const d = getData();
  const map = d[pool] || (d[pool] = {});
  if (!map[key]) map[key] = [];
  // hydrate from file if memory empty
  if (!map[key].length) {
    const fromFile = readStockFile(key);
    if (fromFile.length) map[key] = fromFile.slice();
  }
  if (map[key].length >= 1000) return { ok: false, reason: 'max 1000' };
  map[key].push(line);
  appendStockFile(key, line);
  dataStore.save();
  return { ok: true, count: map[key].length };
}

function takeStock(pool, key) {
  const d = getData();
  const map = d[pool] || {};
  if (!map[key]) map[key] = [];
  if (!map[key].length) {
    const fromFile = readStockFile(key);
    if (fromFile.length) map[key] = fromFile.slice();
  }
  if (!map[key].length) return null;
  const line = map[key].shift();
  // rewrite file without first line
  writeStockFile(key, map[key]);
  dataStore.save();
  return line;
}

function countStock(pool, key) {
  const d = getData();
  return (d[pool]?.[key] || []).length;
}

function listPool(guild, pool) {
  const d = getData();
  const map = d[pool] || {};
  const keys = Object.keys(PRODUCT_KEYS).filter((k) => {
    const v = PRODUCT_KEYS[k].vault;
    if (pool === 'fgen') return v === 'fgen';
    if (pool === 'bgen') return v === 'bgen';
    if (pool === 'pgen') return v === 'pgen';
    return true;
  });
  // unique labels (xboxcode -> xbox_code)
  const seen = new Set();
  const lines = [];
  for (const k of keys) {
    if (k === 'xboxcode') continue;
    const n = (map[k] || []).length;
    const em = resolveEmoji(guild, k);
    lines.push(`${em} \`${PRODUCT_KEYS[k].label}\` → **${n}**`);
  }
  // also show any extra keys in pool
  for (const k of Object.keys(map)) {
    if (PRODUCT_KEYS[k] || k === 'xboxcode') continue;
    lines.push(`📦 \`${k}\` → **${map[k].length}**`);
  }
  return lines.length ? lines.join('\n') : '_Empty_';
}

async function announceAdd(client, pool, key, byTag, added) {
  const d = getData();
  const chId = d.genConfig?.announceChannelId;
  if (!chId || !client) return;
  const ch = await client.channels.fetch(chId).catch(() => null);
  if (!ch) return;
  const label = PRODUCT_KEYS[key]?.label || key;
  await ch
    .send({
      embeds: [
        E(
          'Restock',
          `**${pool}** · **${label}** +${added} by ${byTag}\nTotal: **${countStock(pool, key)}**`,
          brand.green
        )
      ]
    })
    .catch(() => {});
}

module.exports = {
  PRODUCT_KEYS,
  resolveEmoji,
  addStock,
  takeStock,
  countStock,
  announceAdd,
  listPool,
  getData,
  STOCK_DIR,
  readStockFile,
  writeStockFile
};
