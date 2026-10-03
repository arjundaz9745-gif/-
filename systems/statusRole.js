/**
 * Vanity status → role (free / premium / booster tutorials)
 */
const { ActivityType } = require('discord.js');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');

function getCfg() {
  const d = dataStore.get();
  if (!d.genConfig) d.genConfig = {};
  return {
    freeRoleId: d.genConfig.freeRoleId || process.env.FREE_GEN_ROLE_ID || '1555784683290370058',
    premiumRoleId: d.genConfig.premiumRoleId || process.env.PREMIUM_GEN_ROLE_ID || '1555784773748654153',
    boosterRoleId: d.genConfig.boosterRoleId || process.env.BOOSTER_GEN_ROLE_ID || '',
    restockUserId: d.genConfig.restockUserId || process.env.RESTOCK_USER_ID || '1541659394188509215',
    freeStatusText: d.genConfig.freeStatusText || process.env.FREE_STATUS_TEXT || 'Free g3n at discord.gg/PKtNdEAGC',
    statusInvite: d.genConfig.statusInvite || 'discord.gg/PKtNdEAGC'
  };
}

function memberStatusText(member) {
  const acts = member?.presence?.activities || [];
  const parts = [];
  for (const a of acts) {
    if (a.state) parts.push(a.state);
    if (a.name && a.type === ActivityType.Custom) parts.push(a.name);
    if (a.details) parts.push(a.details);
  }
  return parts.join(' ').toLowerCase();
}

function hasRequiredStatus(member) {
  const cfg = getCfg();
  const text = memberStatusText(member);
  const needle = (cfg.freeStatusText || '').toLowerCase();
  const inv = (cfg.statusInvite || '').toLowerCase();
  if (needle && text.includes(needle)) return true;
  if (inv && text.includes(inv)) return true;
  if (text.includes('free g3n') && text.includes('discord.gg')) return true;
  return false;
}

async function checkAndGrant(member) {
  if (!member || member.user.bot) return { ok: false };
  const cfg = getCfg();
  const ok = hasRequiredStatus(member);
  if (ok && cfg.freeRoleId) {
    if (!member.roles.cache.has(cfg.freeRoleId)) {
      await member.roles.add(cfg.freeRoleId, 'Status unlock free gen').catch(() => {});
      return { ok: true, granted: true };
    }
    return { ok: true, granted: false };
  }
  return { ok: false };
}

const DEFAULT_TUTORIALS = {
  free: {
    title: '🟢 UNLOCK FREE GEN ACCESS',
    body:
      'Add our link to your **Discord status** to get **Free gen** access!\n\n' +
      '📌 **Copy & paste status text:**\n```\nFree g3n at discord.gg/PKtNdEAGC\n```\n\n' +
      '👉 Once updated, use `&cstatus` — your free role is granted automatically!\n\n' +
      'Then use `&fgen <item>` to claim.'
  },
  premium: {
    title: '⭐ PREMIUM GEN',
    body:
      '**Premium gen** — paid tier\n\n' +
      '• Working accounts · daily restock\n' +
      '• Valid longer · priority stock\n' +
      '• Special features\n\n' +
      'Pay **$5 / ₹480.70** then open a ticket.\n' +
      'Use `&pgen <item>` after you have the premium role.'
  },
  booster: {
    title: '🚀 BOOSTER TIER',
    body:
      'Server **boosters** (1×+) get booster perks.\n\n' +
      'Same as free unlock via status, plus extra stock types when configured.\n' +
      'Boost the server, then ask staff if the role is missing.'
  }
};

function tutorialEmbed(key) {
  const d = dataStore.get();
  const custom = d.tutorials?.[key];
  const def = DEFAULT_TUTORIALS[key] || { title: key, body: 'Not set.' };
  const title = custom?.title || def.title;
  const body = custom?.body || def.body;
  return E(title, body, brand.gold);
}

module.exports = {
  getCfg,
  hasRequiredStatus,
  checkAndGrant,
  tutorialEmbed,
  DEFAULT_TUTORIALS,
  memberStatusText
};
