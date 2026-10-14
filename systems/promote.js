/**
 * Promote / demote + weekly recommendation (Wed 6:15 server time-ish)
 */
const { EmbedBuilder } = require('discord.js');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');
const { em } = require('./stocks');
const dataStore = require('../utils/data');

const OWNERS = new Set(['1541659394188509215', '1080190046138802306']);

// Rank ladder low → high (edit IDs if needed)
const LADDER = [
  process.env.ROLE_TRIAL_STAFF || '1552608753063297105',
  process.env.ROLE_STAFF_TEAM || '1548173330794815599',
  process.env.ROLE_STOCKER || '1552723730646433802',
  process.env.ROLE_ADMIN || '1547183164185911356',
  process.env.ROLE_HEAD_ADMIN || '1547183162457718847',
  process.env.ROLE_MANAGER || '1549036072909021285',
  process.env.ROLE_CO_OWNER || '1547183161300090950',
];

function ic(g, n, fb) {
  return em(g, n, fb || `:${n}:`);
}

function currentLadderIndex(member) {
  let best = -1;
  for (let i = 0; i < LADDER.length; i++) {
    if (member.roles.cache.has(LADDER[i])) best = i;
  }
  return best;
}

async function promote(message, member, demote = false) {
  if (!OWNERS.has(message.author.id) && !message.member.permissions.has('Administrator')) {
    return message.reply({ embeds: [E('Denied', 'Admin only.', brand.red)] });
  }
  const idx = currentLadderIndex(member);
  if (idx < 0 && !demote) {
    // give lowest
    const role = message.guild.roles.cache.get(LADDER[0]);
    if (!role) return message.reply({ embeds: [E('Error', 'Ladder role missing.', brand.red)] });
    await member.roles.add(role).catch(() => null);
    return announce(message, member, null, role, false);
  }
  if (demote) {
    if (idx <= 0) return message.reply({ embeds: [E('Demote', 'Already lowest / no staff role.', brand.red)] });
    const before = message.guild.roles.cache.get(LADDER[idx]);
    const after = message.guild.roles.cache.get(LADDER[idx - 1]);
    if (before) await member.roles.remove(before).catch(() => null);
    if (after) await member.roles.add(after).catch(() => null);
    return announce(message, member, before, after, true);
  }
  if (idx >= LADDER.length - 1) {
    return message.reply({ embeds: [E('Promote', 'Already top of ladder.', brand.red)] });
  }
  const before = message.guild.roles.cache.get(LADDER[idx]);
  const after = message.guild.roles.cache.get(LADDER[idx + 1]);
  if (before) await member.roles.remove(before).catch(() => null);
  if (after) await member.roles.add(after).catch(() => null);
  return announce(message, member, before, after, false);
}

async function announce(message, member, before, after, demote) {
  const title = demote ? 'Demotion' : 'Promotion';
  const embed = new EmbedBuilder()
    .setColor(demote ? brand.red : brand.green)
    .setDescription(
      [
        ic(message.guild, demote ? 'Wrong' : 'tick', demote ? '⬇️' : '⬆️') + ' **' + title + '**',
        '',
        member.toString() + ' has been **' + (demote ? 'demoted' : 'promoted') + '** into **' + (after ? after.name : '—') + '**',
        '',
        '**Before:** ' + (before ? before.name : '—'),
        '**Now:** ' + (after ? after.name : '—'),
      ].join('\n')
    )
    .setFooter({ text: 'DashMod · Staff' })
    .setTimestamp();
  await message.channel.send({ embeds: [embed] });
}

function handleBeg(message) {
  const t = message.content.toLowerCase();
  if (!/(promot|can i be staff|make me staff)/i.test(t)) return false;
  const mentionsOwners = [...message.mentions.users.keys()].some((id) => OWNERS.has(id));
  if (!mentionsOwners && !OWNERS.has(message.author.id)) {
    // still catch "can I be promoted" without mention
  }
  if (mentionsOwners || /(can i be promoted|promote me)/i.test(t)) {
    message.reply({
      content: ic(message.guild, 'Wrong', '🛑') + ' **Shut up or demoting you!**',
    }).catch(() => null);
    return true;
  }
  return false;
}

/** Wed 6:15 — recommendation (call from index interval) */
async function weeklyRecommendation(client) {
  const guildId = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;
  if (!guildId) return;
  const gid = String(guildId).split(',')[0].trim();
  const guild = await client.guilds.fetch(gid).catch(() => null);
  if (!guild) return;
  const chId = process.env.STAFF_REC_CHANNEL || process.env.LOG_CHANNEL || null;
  const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
  if (!ch || !ch.isTextBased()) return;
  const me = '1541659394188509215';
  const daksh = '1080190046138802306';
  // pick a random staff on ladder for example
  await guild.members.fetch().catch(() => null);
  const staff = guild.members.cache.filter((m) => LADDER.some((r) => m.roles.cache.has(r)) && !m.user.bot);
  const pick = staff.random();
  if (!pick) return;
  const idx = currentLadderIndex(pick);
  const next = idx >= 0 && idx < LADDER.length - 1 ? guild.roles.cache.get(LADDER[idx + 1]) : null;
  const d = dataStore.get();
  const msgs = (d.messages && d.messages[pick.id]) || 0;
  const inv = (d.invites && d.invites[pick.id] && d.invites[pick.id].joins) || 0;
  const pays = (d.payoutsCount && d.payoutsCount[pick.id]) || 0;
  await ch.send({
    content: `<@${me}> <@${daksh}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(brand.purple)
        .setDescription(
          [
            ic(guild, 'Admin', '📋') + ' **Weekly staff recommendation**',
            '',
            `Should we promote ${pick} into **${next ? next.name : '—'}**?`,
            '',
            `Payouts (week): **${pays}**`,
            `Invites: **${inv}**`,
            `Messages: **${msgs}**`,
            '',
            'Use `/promote @user` if yes.',
          ].join('\n')
        ),
    ],
  });
}

module.exports = { promote, handleBeg, weeklyRecommendation, LADDER, OWNERS };
