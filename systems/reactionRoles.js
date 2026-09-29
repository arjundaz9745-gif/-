/**
 * Reaction roles — react with emoji → get role, remove reaction → remove role
 * Data shape:
 * data.reactionRoles[guildId][messageId] = [ { emoji: '🎉' | '123456789', roleId: '...' }, ... ]
 */
const dataStore = require('../utils/data');

function getGuildMap(guildId) {
  const data = dataStore.get();
  if (!data.reactionRoles) data.reactionRoles = {};
  if (!data.reactionRoles[guildId]) data.reactionRoles[guildId] = {};
  return data.reactionRoles[guildId];
}

function normalizeEmoji(emoji) {
  if (!emoji) return null;
  // Custom emoji object from discord.js
  if (typeof emoji === 'object') {
    if (emoji.id) return String(emoji.id);
    if (emoji.name) return emoji.name;
  }
  const s = String(emoji).trim();
  // <:name:id> or <a:name:id>
  const m = s.match(/^<a?:[\w~]+:(\d+)>$/);
  if (m) return m[1];
  return s;
}

function listForMessage(guildId, messageId) {
  return getGuildMap(guildId)[messageId] || [];
}

function addMapping(guildId, messageId, emojiRaw, roleId) {
  const emoji = normalizeEmoji(emojiRaw);
  if (!emoji || !roleId) return { ok: false, reason: 'bad emoji/role' };
  const map = getGuildMap(guildId);
  if (!map[messageId]) map[messageId] = [];
  // replace if same emoji
  map[messageId] = map[messageId].filter((r) => r.emoji !== emoji);
  map[messageId].push({ emoji, roleId: String(roleId) });
  dataStore.save();
  return { ok: true, emoji };
}

function removeMapping(guildId, messageId, emojiRaw) {
  const emoji = normalizeEmoji(emojiRaw);
  const map = getGuildMap(guildId);
  if (!map[messageId]) return { ok: false };
  const before = map[messageId].length;
  map[messageId] = map[messageId].filter((r) => r.emoji !== emoji);
  if (!map[messageId].length) delete map[messageId];
  dataStore.save();
  return { ok: map[messageId] ? map[messageId].length < before : before > 0 };
}

function findRoleId(guildId, messageId, emojiObj) {
  const emoji = normalizeEmoji(emojiObj);
  const list = listForMessage(guildId, messageId);
  const hit = list.find((r) => r.emoji === emoji);
  return hit?.roleId || null;
}

async function onReactionAdd(reaction, user) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message?.partial) await reaction.message.fetch().catch(() => null);
  } catch (_) {}
  const msg = reaction.message;
  if (!msg?.guild) return;
  const roleId = findRoleId(msg.guild.id, msg.id, reaction.emoji);
  if (!roleId) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  await member.roles.add(roleId, 'Reaction role').catch(() => {});
}

async function onReactionRemove(reaction, user) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message?.partial) await reaction.message.fetch().catch(() => null);
  } catch (_) {}
  const msg = reaction.message;
  if (!msg?.guild) return;
  const roleId = findRoleId(msg.guild.id, msg.id, reaction.emoji);
  if (!roleId) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  await member.roles.remove(roleId, 'Reaction role remove').catch(() => {});
}

function registerReactionRoles(client) {
  client.on('messageReactionAdd', (reaction, user) => {
    onReactionAdd(reaction, user).catch((e) => console.error('rr add', e.message));
  });
  client.on('messageReactionRemove', (reaction, user) => {
    onReactionRemove(reaction, user).catch((e) => console.error('rr rem', e.message));
  });
  console.log('Reaction roles listeners registered');
}

module.exports = {
  registerReactionRoles,
  addMapping,
  removeMapping,
  listForMessage,
  normalizeEmoji,
  getGuildMap
};
