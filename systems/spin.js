/**
 * Spin wheel — /spin · -spin @users/@role OR plain names
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

function wheelArt(guild, phase) {
  const gift = ic(guild, 'giveaway', '🎡');
  if (phase === 'spin') {
    return [
      gift + ' **SPINNING…**',
      '```',
      '        ▼',
      '    ╭─────────╮',
      '   ╱  ★  ◆  ★  ╲',
      '  │  ◈  🎯  ◈  │',
      '   ╲  ★  ◆  ★  ╱',
      '    ╰─────────╯',
      '```',
    ].join('\n');
  }
  return [
    gift + ' **SPIN**',
    '```',
    '        ▼',
    '    ╭─────────╮',
    '   ╱           ╲',
    '  │   READY    │',
    '   ╲           ╱',
    '    ╰─────────╯',
    '```',
  ].join('\n');
}

async function collectPlayers(message, args) {
  const out = [];
  const seen = new Set();
  for (const m of message.mentions.members.values()) {
    if (m.user.bot) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: m.displayName || m.user.username, mention: m.toString() });
  }
  for (const r of message.mentions.roles.values()) {
    await message.guild.members.fetch().catch(() => null);
    r.members.forEach((m) => {
      if (m.user.bot) return;
      if (seen.has(m.id)) return;
      seen.add(m.id);
      out.push({ id: m.id, name: m.displayName || m.user.username, mention: m.toString() });
    });
  }
  // plain names from args (no @)
  for (const a of args) {
    if (a.startsWith('<@')) continue;
    if (/^\d{15,22}$/.test(a)) {
      const m = await message.guild.members.fetch(a).catch(() => null);
      if (m && !m.user.bot && !seen.has(m.id)) {
        seen.add(m.id);
        out.push({ id: m.id, name: m.displayName || m.user.username, mention: m.toString() });
      }
      continue;
    }
    const name = a.replace(/^@/, '').trim();
    if (!name) continue;
    // name-only entries (web style)
    const key = 'name:' + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: null, name, mention: `**${name}**` });
  }
  return out.slice(0, 100);
}

async function runSpin(message, args) {
  const players = await collectPlayers(message, args);
  if (players.length < 2) {
    return message.reply({
      embeds: [E('Spin', 'Add at least **2** players: `-spin @a @b` or `-spin Name1 Name2`', brand.red)],
    });
  }
  const gift = ic(message.guild, 'giveaway', '🎡');
  const msg = await message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(brand.purple || 0x9b59b6)
        .setTitle(`${gift} Spin wheel`)
        .setDescription(
          wheelArt(message.guild, 'ready') +
            '\n\n**Players (' +
            players.length +
            '):**\n' +
            players
              .slice(0, 20)
              .map((p, i) => `\`${i + 1}.\` ${p.name}`)
              .join('\n') +
            (players.length > 20 ? `\n… +${players.length - 20}` : '')
        )
        .setFooter({ text: 'DashMod · Spin' }),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('spin_go').setLabel('Spin').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('spin_close').setLabel('Close').setStyle(ButtonStyle.Secondary)
      ),
    ],
  });

  const col = msg.createMessageComponentCollector({ time: 180000 });
  col.on('collect', async (i) => {
    if (i.user.id !== message.author.id && !i.member?.permissions?.has?.('ManageGuild')) {
      return i.reply({ content: 'Only the host can control this.', ephemeral: true });
    }
    if (i.customId === 'spin_close') {
      col.stop();
      await i.update({
        embeds: [E('Spin', 'Closed.', brand.red)],
        components: [],
      });
      return;
    }
    if (i.customId === 'spin_go') {
      await i.update({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.gold || 0xf1c40f)
            .setTitle(`${gift} Spinning…`)
            .setDescription(wheelArt(message.guild, 'spin'))
            .setFooter({ text: 'DashMod · Spin' }),
        ],
        components: [],
      });
      await new Promise((r) => setTimeout(r, 2500));
      const winner = pickWinner(players);
      const tick = ic(message.guild, 'tick', '✅');
      await msg.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.green || 0x2ecc71)
            .setTitle(`${tick} Winner`)
            .setDescription(
              [
                wheelArt(message.guild, 'ready'),
                '',
                `### ${winner.name}`,
                winner.mention,
                '',
                ic(message.guild, 'giveaway', '🎉') + ' Congrats!',
              ].join('\n')
            )
            .setFooter({ text: 'DashMod · Spin' }),
        ],
        components: [],
      });
      col.stop();
    }
  });
}

function handlePrefix(message, args) {
  return runSpin(message, args);
}

module.exports = { handlePrefix, runSpin, collectPlayers };
