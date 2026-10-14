const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { em } = require('./stocks');

function giveawayEmbed(g, ended = false, guild = null) {
  const mins = Math.ceil(Math.max(0, (g.ends || 0) - Date.now()) / 60000);
  const gift = em(guild, 'giveaway', '🎉');
  const tick = em(guild, 'tick', '✅');
  const star = em(guild, 'starss', '✨');
  return new EmbedBuilder()
    .setColor(ended ? brand.dark || 0x2b2d31 : brand.gold || 0xf1c40f)
    .setTitle(ended ? `${tick} Giveaway ended` : `${gift} GIVEAWAY`)
    .setDescription(
      [
        `${star} **Prize:** ${g.prize}`,
        `**Winners:** ${g.winners}`,
        ended
          ? `**Winner(s):** ${g.winnerTags || 'None'}`
          : `**Ends:** <t:${Math.floor((g.ends || Date.now()) / 1000)}:R> (~${mins}m)`,
        '',
        ended ? '' : `${em(guild, 'emoji_1', '🎈')} Click **Enter** to join!`,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .setImage(g.image || null)
    .setFooter({ text: brand.footer || 'DashMod · Giveaway' })
    .setTimestamp(ended ? new Date(g.ends || Date.now()) : new Date());
}

function giveawayRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gw_enter')
      .setLabel('Enter')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('gw_count')
      .setLabel('Entries')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)
  );
}

/** Normalize: giveaways may be {} keyed by messageId OR [] */
function listGiveaways(data) {
  if (!data.giveaways) {
    data.giveaways = {};
    return [];
  }
  if (Array.isArray(data.giveaways)) {
    return data.giveaways.map((g, i) => ({ key: g.messageId || String(i), g }));
  }
  return Object.entries(data.giveaways).map(([key, g]) => ({ key, g }));
}

async function endGiveaway(client, g, key) {
  const data = dataStore.get();
  if (!data.giveaways) data.giveaways = {};
  g.ended = true;

  const chId = g.channelId;
  const msgId = g.messageId || key;
  const ch = chId ? await client.channels.fetch(chId).catch(() => null) : null;

  const entries = (g.entries || []).filter(Boolean);
  const winners = [];
  const pool = [...entries];
  for (let i = 0; i < (g.winners || 1) && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  g.winnerIds = winners;
  g.winnerTags = winners.length ? winners.map((id) => `<@${id}>`).join(', ') : 'None';

  if (Array.isArray(data.giveaways)) {
    // keep array form if somehow array
  } else if (key != null) {
    data.giveaways[key] = g;
  } else if (msgId) {
    data.giveaways[msgId] = g;
  }
  dataStore.save();

  if (!ch) return;

  const gift = em(ch.guild, 'giveaway', '🎉');
  const tick = em(ch.guild, 'tick', '✅');
  try {
    if (msgId) {
      const msg = await ch.messages.fetch(msgId).catch(() => null);
      if (msg) {
        await msg.edit({
          embeds: [giveawayEmbed(g, true, ch.guild)],
          components: [giveawayRow(true)],
        });
      }
    }
  } catch (_) {}

  await ch
    .send({
      content: winners.length
        ? `${gift} ${tick} **Giveaway ended!** Congratulations ${g.winnerTags} — you won **${g.prize}**!`
        : `${gift} Giveaway ended — no valid entries for **${g.prize}**.`,
      allowedMentions: { users: winners },
    })
    .catch(() => null);
}

function startGiveawayChecker(client) {
  setInterval(async () => {
    try {
      const data = dataStore.get();
      if (!data.giveaways) return;
      const now = Date.now();
      const list = listGiveaways(data);
      for (const { key, g } of list) {
        if (!g || g.ended) continue;
        if (!g.ends || g.ends > now) continue;
        try {
          await endGiveaway(client, g, key);
        } catch (e) {
          console.error('gw end', e.message);
        }
      }
    } catch (e) {
      console.error('gw checker', e.message);
    }
  }, 15000);
}

module.exports = {
  giveawayEmbed,
  giveawayRow,
  endGiveaway,
  startGiveawayChecker,
  listGiveaways,
};
