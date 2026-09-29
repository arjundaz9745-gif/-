const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');

function giveawayEmbed(g, ended = false) {
  const mins = Math.ceil(Math.max(0, g.ends - Date.now()) / 60000);
  return new EmbedBuilder()
    .setColor(ended ? brand.dark : brand.gold)
    .setTitle(ended ? 'Giveaway ended' : '🎉 Giveaway')
    .setDescription(
      `**Prize:** ${g.prize}\n**Winners:** ${g.winners}\n` +
        (ended
          ? `**Winner(s):** ${g.winnerTags || 'None'}`
          : `**Ends:** ~**${mins}m** · <t:${Math.floor(g.ends / 1000)}:R>`) +
        `\n**Entries:** ${(g.entries || []).length}\n**Host:** <@${g.hostId}>`
    )
    .setFooter({ text: brand.footer })
    .setTimestamp();
}

function giveawayRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gw_enter')
      .setLabel('Enter')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎉')
      .setDisabled(disabled)
  );
}

async function endGiveaway(client, messageId) {
  const data = dataStore.get();
  const g = data.giveaways?.[messageId];
  if (!g || g.ended) return;
  g.ended = true;
  const pool = [...new Set(g.entries || [])];
  const winners = [];
  for (let i = 0; i < g.winners && pool.length; i++) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  g.winnerTags = winners.length ? winners.map((id) => `<@${id}>`).join(', ') : 'No entries';
  dataStore.save();
  const ch = await client.channels.fetch(g.channelId).catch(() => null);
  if (!ch) return;
  const msg = await ch.messages.fetch(messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [giveawayEmbed(g, true)], components: [giveawayRow(true)] }).catch(() => {});
  await ch
    .send({
      content: winners.length ? `Congrats ${g.winnerTags}! Won **${g.prize}**` : 'No entries.',
      embeds: [E('Giveaway result', g.winnerTags, brand.green)]
    })
    .catch(() => {});
}

module.exports = { giveawayEmbed, giveawayRow, endGiveaway };
