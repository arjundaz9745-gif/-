const { EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { em } = require('./stocks');

function ensureInviteStats(gid, uid) {
  const data = dataStore.get();
  if (!data.inviteStats) data.inviteStats = {};
  if (!data.inviteStats[gid]) data.inviteStats[gid] = {};
  if (!data.inviteStats[gid][uid]) {
    data.inviteStats[gid][uid] = { joins: 0, leaves: 0, fake: 0, bonus: 0, rejoins: 0 };
  }
  return data.inviteStats[gid][uid];
}

function inviteBreakdown(gid, uid) {
  const s = ensureInviteStats(gid, uid);
  const regular = Math.max(0, (s.joins || 0) - (s.leaves || 0) - (s.fake || 0));
  return { ...s, regular, total: Math.max(0, regular + (s.bonus || 0)) };
}

function addMessageCount(gid, uid) {
  const data = dataStore.get();
  if (!data.messages) data.messages = {};
  if (!data.messages[gid]) data.messages[gid] = {};
  data.messages[gid][uid] = (data.messages[gid][uid] || 0) + 1;
}

function arrow(guild) {
  return em(guild, 'arrowXd', em(guild, 'arrow_1', '≫'));
}
function nonArrow(guild) {
  return em(guild, 'non-arrow', em(guild, 'non_arrow', '›'));
}

/** Falcon-style invite log (enhanced) */
function buildInviteEmbed(user, gid, by, guild) {
  const b = inviteBreakdown(gid, user.id);
  const name = user.globalName || user.username;
  const a = guild ? arrow(guild) : '≫';
  const n = guild ? nonArrow(guild) : '›';
  const inv = em(guild, 'gift', '📨');
  const tick = em(guild, 'tick', '✅');
  const desc = [
    `${a} ${inv} **${name}** ${tick} has **${b.total}** invites`,
    '',
    `${n} **Joins :** \`${b.joins || 0}\``,
    `${n} **Left :** \`${b.leaves || 0}\``,
    `${n} **Fake :** \`${b.fake || 0}\``,
    `${n} **Rejoins :** \`${b.rejoins || 0}\` (7d)`,
    `${n} **Bonus :** \`${b.bonus || 0}\``,
    `${n} **Regular :** \`${b.regular || 0}\``,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(brand.color || 0x7B2CBF)
    .setTitle(`${inv} Invite log`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(desc)
    .setFooter({ text: (by ? `Requested by ${by} · ` : '') + (brand.footer || 'DashMod') })
    .setTimestamp();
}

function buildMessagesEmbed(user, count, by, guild) {
  const a = guild ? arrow(guild) : '≫';
  const n = guild ? nonArrow(guild) : '›';
  const msg = em(guild, 'inbox', '💬');
  return new EmbedBuilder()
    .setColor(brand.color || 0x7B2CBF)
    .setTitle(`${msg} Message log`)
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(
      [
        `${a} **${user.globalName || user.username}**`,
        '',
        `${n} **Messages :** \`${Number(count || 0).toLocaleString()}\``,
      ].join('\n')
    )
    .setFooter({ text: (by ? `Requested by ${by} · ` : '') + (brand.footer || 'DashMod') })
    .setTimestamp();
}

/**
 * If Falcon (or similar) posts Invite log, delete it and re-post DashMod version.
 * Call from messageCreate when message.author.bot.
 */
async function tryReplaceFalconInvite(message, client) {
  if (!message.author?.bot || !message.guild) return false;
  // skip ourselves
  if (client?.user && message.author.id === client.user.id) return false;
  const emb = message.embeds?.[0];
  if (!emb) return false;
  const title = String(emb.title || '').toLowerCase();
  if (!title.includes('invite')) return false;

  // Prefer matching against our recent -i requests; else parse name from description
  let user = null;
  const desc = String(emb.description || '');
  // try mention in message
  if (message.mentions?.users?.size) {
    user = message.mentions.users.first();
  }
  // parse "**Name** has"
  if (!user) {
    const m = desc.match(/\*\*([^*]+)\*\*.*has/i) || desc.match(/≫\s*\*\*?([^*\n]+)/);
    const uname = m ? m[1].replace(/[^\w\s.\-]/g, '').trim() : null;
    if (uname) {
      await message.guild.members.fetch().catch(() => null);
      const mem = message.guild.members.cache.find(
        (x) =>
          x.user.username.toLowerCase() === uname.toLowerCase() ||
          (x.displayName || '').toLowerCase() === uname.toLowerCase() ||
          (x.user.globalName || '').toLowerCase() === uname.toLowerCase()
      );
      if (mem) user = mem.user;
    }
  }
  // fallback: last command author in channel is hard — use embed footer "Requested by"
  if (!user) {
    const foot = emb.footer?.text || '';
    const rm = foot.match(/Requested by\s+(\S+)/i);
    if (rm) {
      await message.guild.members.fetch().catch(() => null);
      const mem = message.guild.members.cache.find(
        (x) => x.user.username.toLowerCase() === rm[1].toLowerCase().replace(/_+/g, '_')
      );
      // actually requester not target — skip
    }
  }

  // Sync counts from Falcon embed if present (so numbers match Falcon)
  if (user) {
    const s = ensureInviteStats(message.guild.id, user.id);
    const joins = desc.match(/Joins\s*:\s*(\d+)/i) || emb.fields?.find((f) => /joins/i.test(f.name));
    const left = desc.match(/Left\s*:\s*(\d+)/i) || emb.fields?.find((f) => /left/i.test(f.name));
    const fake = desc.match(/Fake\s*:\s*(\d+)/i) || emb.fields?.find((f) => /fake/i.test(f.name));
    const rej = desc.match(/Rejoins?\s*:\s*(\d+)/i) || emb.fields?.find((f) => /rejoin/i.test(f.name));
    const num = (x) => {
      if (!x) return null;
      if (typeof x === 'object' && x.value) return parseInt(String(x.value).replace(/\D/g, ''), 10);
      if (Array.isArray(x)) return parseInt(x[1], 10);
      return null;
    };
    const j = num(joins);
    const l = num(left);
    const f = num(fake);
    const r = num(rej);
    if (j != null) s.joins = j;
    if (l != null) s.leaves = l;
    if (f != null) s.fake = f;
    if (r != null) s.rejoins = r;
    dataStore.save();
  }

  try {
    await message.delete().catch(() => null);
  } catch (_) {}

  if (!user) return true; // deleted Falcon spam even if we couldn't resolve

  const by = emb.footer?.text?.match(/Requested by\s+([^·|]+)/i)?.[1]?.trim() || 'server';
  await message.channel
    .send({ embeds: [buildInviteEmbed(user, message.guild.id, by, message.guild)] })
    .catch(() => null);
  return true;
}

module.exports = {
  ensureInviteStats,
  inviteBreakdown,
  addMessageCount,
  buildInviteEmbed,
  buildMessagesEmbed,
  tryReplaceFalconInvite,
  arrow,
  nonArrow,
};
