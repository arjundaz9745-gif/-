/**
 * Spin wheel — /spin or -spin @users / @role (max 100)
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');
const { em } = require('./stocks');

function ic(guild, name, fb) {
  return em(guild, name, fb || `:${name}:`);
}

function pickWinner(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function spinVisual(guild, names, winnerName) {
  const pointer = ic(guild, 'emoji_1', '🔻');
  const wheel = ic(guild, 'giveaway', '🎡');
  const lines = [
    wheel + ' **SPIN** ' + wheel,
    '',
    '```',
    '        ' + pointer,
    '   ╭──────────╮',
    '   │  SPINNING │',
    '   ╰──────────╯',
    '```',
    '',
    '**Players:** ' + names.slice(0, 15).map((n) => `\`${n}\``).join(', ') + (names.length > 15 ? ` +${names.length - 15}` : ''),
  ];
  return lines.join('\n');
}

async function collectMembers(message, args) {
  const out = new Map();
  for (const m of message.mentions.members.values()) {
    if (!m.user.bot) out.set(m.id, m);
  }
  for (const r of message.mentions.roles.values()) {
    await message.guild.members.fetch().catch(() => null);
    r.members.forEach((m) => {
      if (!m.user.bot) out.set(m.id, m);
    });
  }
  // bare ids in args
  for (const a of args) {
    const id = a.replace(/[<@!&>]/g, '');
    if (/^\d{15,20}$/.test(id)) {
      const m = await message.guild.members.fetch(id).catch(() => null);
      if (m && !m.user.bot) out.set(m.id, m);
    }
  }
  return [...out.values()].slice(0, 100);
}

async function runSpin(message, args) {
  const members = await collectMembers(message, args);
  if (members.length < 2) {
    return message.reply({ embeds: [E('Spin', 'Mention at least **2** users or a role (max 100).', brand.red)] });
  }
  const names = members.map((m) => m.displayName || m.user.username);
  const msg = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(brand.purple || 0x7B2CBF)
        .setDescription(spinVisual(message.guild, names, null))
        .setFooter({ text: 'DashMod · Spin' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('spin_go').setLabel('Spin').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('spin_close').setLabel('Close').setStyle(ButtonStyle.Secondary)
      ),
    ],
  });

  const col = msg.createMessageComponentCollector({ time: 120000 });
  col.on('collect', async (i) => {
    if (i.user.id !== message.author.id && !i.member.permissions.has('ManageGuild')) {
      return i.reply({ content: 'Only the host can control this spin.', ephemeral: true });
    }
    if (i.customId === 'spin_close') {
      col.stop('close');
      await i.update({ components: [], embeds: [E('Spin', 'Closed.', brand.red)] });
      return;
    }
    if (i.customId === 'spin_go') {
      const winner = pickWinner(members);
      const wName = winner.displayName || winner.user.username;
      await i.update({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.green || 0x10B981)
            .setDescription(
              [
                ic(message.guild, 'giveaway', '🎉') + ' **WINNER** ' + ic(message.guild, 'tick', '✅'),
                '',
                '### ' + wName,
                '',
                spinVisual(message.guild, names, wName),
                '',
                ic(message.guild, 'emoji_1', '🎯') + ' Congrats ' + winner.toString() + '!',
              ].join('\n')
            )
            .setFooter({ text: 'DashMod · Spin' }),
        ],
        components: [],
      });
      col.stop('done');
    }
  });
}

function handlePrefix(message, args) {
  return runSpin(message, args);
}

module.exports = { handlePrefix, runSpin };
