const { EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');

function ensureInviteStats(gid, uid) {
  const data = dataStore.get();
  if (!data.inviteStats) data.inviteStats = {};
  if (!data.inviteStats[gid]) data.inviteStats[gid] = {};
  if (!data.inviteStats[gid][uid]) data.inviteStats[gid][uid] = { joins: 0, leaves: 0, fake: 0, bonus: 0, rejoins: 0 };
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

function buildInviteEmbed(user, gid, by) {
  const b = inviteBreakdown(gid, user.id);
  return new EmbedBuilder()
    .setColor(brand.color)
    .setTitle('Invite log')
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(`≫ **${user.globalName || user.username}** has **${b.total}** invites`)
    .addFields(
      { name: 'Joins', value: String(b.joins || 0), inline: false },
      { name: 'Left', value: String(b.leaves || 0), inline: false },
      { name: 'Fake', value: String(b.fake || 0), inline: false },
      { name: 'Rejoins', value: `${b.rejoins || 0} (7d)`, inline: false }
    )
    .setFooter({ text: (by ? `Requested by ${by} · ` : '') + brand.footer })
    .setTimestamp();
}

module.exports = { ensureInviteStats, inviteBreakdown, addMessageCount, buildInviteEmbed };
