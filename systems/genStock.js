/**
 * Product stocks with emoji keys + free/premium gen pools
 */
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const env = require('../config/env');

/** Canonical stock keys → custom emoji name (server emoji) or unicode */
const PRODUCT_KEYS = {
  mcfa: { emoji: 'mcfa', label: 'MCFA', unicode: '⚔️' },
  donut: { emoji: 'donut', label: 'Donut', unicode: '🍩' },
  hypixel: { emoji: 'hypixel', label: 'Hypixel', unicode: '🎮' },
  netflix: { emoji: 'netflix', label: 'Netflix', unicode: '📺' },
  steam: { emoji: 'STEAM', label: 'Steam', unicode: '🕹️' },
  xbox: { emoji: 'xbox', label: 'Xbox', unicode: '🎯' },
  nitro: { emoji: 'Nitro', label: 'Nitro', unicode: '💎' },
  hotmail: { emoji: 'hotmail', label: 'Hotmail', unicode: '📧' },
  crunchyroll: { emoji: 'crunchyroll', label: 'Crunchyroll', unicode: '🍿' },
  minecraft: { emoji: 'MINECRAFT', label: 'Minecraft', unicode: '⛏️' }
};

function resolveEmoji(guild, key) {
  const meta = PRODUCT_KEYS[key] || { emoji: key, unicode: '📦', label: key };
  if (!guild) return meta.unicode || '📦';
  const name = meta.emoji;
  const found = guild.emojis.cache.find(
    (e) => e.name.toLowerCase() === String(name).toLowerCase()
  );
  if (found) return found.toString();
  return meta.unicode || '📦';
}

function getData() {
  const d = dataStore.get();
  if (!d.stocks) d.stocks = {};
  if (!d.methods) d.methods = {};
  if (!d.fgen) d.fgen = {}; // free gen pools by item key
  if (!d.pgen) d.pgen = {}; // premium gen
  if (!d.tutorials) d.tutorials = {};
  if (!d.genConfig) {
    d.genConfig = {
      freeRoleId: process.env.FREE_GEN_ROLE_ID || '1555784683290370058',
      premiumRoleId: process.env.PREMIUM_GEN_ROLE_ID || '1555784773748654153',
      announceChannelId: process.env.GEN_ANNOUNCE_CHANNEL_ID || '1553617811291775067',
      restockUserId: process.env.RESTOCK_USER_ID || '1541659394188509215',
      freeStatusText: process.env.FREE_STATUS_TEXT || 'Free g3n at discord.gg/PKtNdEAGC',
      statusInvite: process.env.STATUS_INVITE || 'discord.gg/PKtNdEAGC'
    };
  }
  return d;
}

function addStock(pool, key, line) {
  const d = getData();
  const map = d[pool] || (d[pool] = {});
  if (!map[key]) map[key] = [];
  if (map[key].length >= 1000) return { ok: false, reason: 'max 1000' };
  map[key].push(line);
  dataStore.save();
  return { ok: true, count: map[key].length };
}

function takeStock(pool, key) {
  const d = getData();
  const map = d[pool] || {};
  const arr = map[key] || [];
  if (!arr.length) return null;
  const item = arr.shift();
  dataStore.save();
  return item;
}

function countStock(pool, key) {
  const d = getData();
  return ((d[pool] || {})[key] || []).length;
}

async function announceAdd(client, guild, pool, key, addedCount, authorTag) {
  const d = getData();
  const chId = d.genConfig.announceChannelId;
  if (!chId) return;
  const ch = await guild.channels.fetch(chId).catch(() => null);
  if (!ch?.isTextBased?.()) return;
  const roleId = pool === 'fgen' ? d.genConfig.freeRoleId : d.genConfig.premiumRoleId;
  const em = resolveEmoji(guild, key);
  const label = (PRODUCT_KEYS[key] || { label: key }).label;
  await ch
    .send({
      content: roleId ? `<@&${roleId}>` : undefined,
      embeds: [
        E(
          `${em} Stock restock`,
          `**${addedCount}** × **${label}** (\`${key}\`) added to **${pool === 'fgen' ? 'Free' : 'Premium'} gen**\nBy **${authorTag}**`,
          brand.green
        )
      ],
      allowedMentions: { roles: roleId ? [roleId] : [] }
    })
    .catch(() => {});
}

function listPool(guild, pool) {
  const d = getData();
  const map = d[pool] || {};
  const lines = [];
  for (const key of Object.keys(PRODUCT_KEYS)) {
    const n = (map[key] || []).length;
    const em = resolveEmoji(guild, key);
    lines.push(`${em} **${PRODUCT_KEYS[key].label}** \`${key}\` · **${n}**`);
  }
  for (const key of Object.keys(map)) {
    if (PRODUCT_KEYS[key]) continue;
    lines.push(`📦 **${key}** · **${(map[key] || []).length}**`);
  }
  return lines.join('\n') || 'Empty';
}

module.exports = {
  PRODUCT_KEYS,
  resolveEmoji,
  getData,
  addStock,
  takeStock,
  countStock,
  announceAdd,
  listPool
};
