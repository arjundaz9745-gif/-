const dataStore = require('../utils/data');
const env = require('../config/env');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');

async function getLogChannel(client, guild) {
  const data = dataStore.get();
  const id = data.settings?.logChannelId || env.LOG_CHANNEL_ID;
  if (!id || !guild) return null;
  return guild.channels.fetch(id).catch(() => null);
}

async function botLog(client, guild, title, body, color) {
  const ch = await getLogChannel(client, guild);
  if (!ch?.isTextBased?.()) return;
  await ch.send({ embeds: [E(title, body, color || brand.blurple)] }).catch(() => {});
}

module.exports = { getLogChannel, botLog };
