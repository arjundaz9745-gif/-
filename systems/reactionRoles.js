/**
 * Reaction roles — react → role, remove reaction → remove role
 * Also parses panel embed text if data was lost after restart.
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
  if (typeof emoji === 'object') {
    if (emoji.id) return String(emoji.id);
    if (emoji.name) return String(emoji.name);
  }
  const s = String(emoji).trim();
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
  map[messageId] = map[messageId].filter((r) => r.emoji !== emoji);
  map[messageId].push({ emoji, roleId: String(roleId) });
  dataStore.save();
  console.log('RR map', guildId, messageId, emoji, '→', roleId);
  return { ok: true, emoji };
}

function removeMapping(guildId, messageId, emojiRaw) {
  const emoji = normalizeEmoji(emojiRaw);
  const map = getGuildMap(guildId);
  if (!map[messageId]) return { ok: false };
  map[messageId] = map[messageId].filter((r) => r.emoji !== emoji);
  if (!map[messageId].length) delete map[messageId];
  dataStore.save();
  return { ok: true };
}

/** Match role from stored map OR from embed lines: React with X to get **Name** */
function findRoleId(guildId, message, emojiObj) {
  const emoji = normalizeEmoji(emojiObj);
  if (!emoji || !message) return null;

  const list = listForMessage(guildId, message.id);
  const hit = list.find((r) => r.emoji === emoji);
  if (hit) return hit.roleId;

  // Fallback: parse embed description (survives restart if panel still exists)
  try {
    const embeds = message.embeds || [];
    for (const emb of embeds) {
      const desc = emb.description || '';
      const lines = desc.split('\n');
      for (const line of lines) {
        // React with 🎉 to get **Events Ping**
        const m = line.match(/React with\s+(.+?)\s+to get\s+\*\*(.+?)\*\*/i);
        if (!m) continue;
        const lineEmoji = normalizeEmoji(m[1].trim());
        if (lineEmoji !== emoji) continue;
        const roleName = m[2].trim();
        const role = message.guild.roles.cache.find(
          (r) => r.name === roleName || r.name.toLowerCase() === roleName.toLowerCase()
        );
        if (role) {
          // re-cache for next time
          addMapping(guildId, message.id, emoji, role.id);
          return role.id;
        }
      }
    }
  } catch (e) {
    console.error('RR parse', e.message);
  }
  return null;
}

async function onReactionAdd(reaction, user) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();
  } catch (e) {
    console.error('RR fetch', e.message);
    return;
  }
  const msg = reaction.message;
  if (!msg?.guild) return;

  const roleId = findRoleId(msg.guild.id, msg, reaction.emoji);
  if (!roleId) {
    console.log('RR no mapping', msg.id, normalizeEmoji(reaction.emoji));
    return;
  }

  const member = await msg.guild.members.fetch(user.id).catch((e) => {
    console.error('RR member', e.message);
    return null;
  });
  if (!member) return;

  try {
    await member.roles.add(roleId, 'Reaction role');
    console.log('RR added', user.tag, roleId);
  } catch (e) {
    console.error('RR add failed:', e.message, '— bot needs Manage Roles & higher role position');
  }
}

async function onReactionRemove(reaction, user) {
  if (user.bot) return;
  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message?.partial) await reaction.message.fetch();
  } catch (_) {
    return;
  }
  const msg = reaction.message;
  if (!msg?.guild) return;
  const roleId = findRoleId(msg.guild.id, msg, reaction.emoji);
  if (!roleId) return;
  const member = await msg.guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  await member.roles.remove(roleId, 'Reaction role remove').catch((e) =>
    console.error('RR remove failed', e.message)
  );
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
