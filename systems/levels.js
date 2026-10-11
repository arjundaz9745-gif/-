const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');

const MSG_PER_LEVEL = 2000; // lvl 1 = 2000, lvl 2 = 4000, ...

function ensureLevels(guildId) {
  const d = dataStore.get();
  if (!d.levels) d.levels = {};
  if (!d.levels[guildId]) d.levels[guildId] = {};
  return d.levels[guildId];
}

function addMessageXp(guildId, userId) {
  const g = ensureLevels(guildId);
  g[userId] = (g[userId] || 0) + 1;
  dataStore.save();
  return g[userId];
}

function getLevel(xp) {
  return Math.floor((xp || 0) / MSG_PER_LEVEL);
}

function xpForLevel(lvl) {
  return lvl * MSG_PER_LEVEL;
}

function progress(xp) {
  const lvl = getLevel(xp);
  const into = (xp || 0) - xpForLevel(lvl);
  return { lvl, into, need: MSG_PER_LEVEL, next: xpForLevel(lvl + 1) };
}

async function sendLevelCard(channel, member, xp) {
  const { lvl, into, need, next } = progress(xp);
  const barLen = 12;
  const filled = Math.round((into / need) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  const embed = new EmbedBuilder()
    .setColor(brand.color || 0x1abc9c)
    .setAuthor({
      name: member.displayName || member.user.username,
      iconURL: member.user.displayAvatarURL({ size: 128 })
    })
    .setTitle(`📊 Level ${lvl}`)
    .setDescription(
      `**Messages:** \`${xp}\`\n**Progress:** \`${into}/${need}\` → Level ${lvl + 1}\n\`${bar}\`\n**Next level at:** \`${next}\` messages`
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: brand.footer || 'DashMod' })
    .setTimestamp();
  await channel.send({ embeds: [embed] });
}

function handleLevelUp(message, prevXp, newXp) {
  const prev = getLevel(prevXp);
  const next = getLevel(newXp);
  if (next > prev) {
    message.channel
      .send({
        content: `🎉 <@${message.author.id}> reached **Level ${next}**! (${newXp} messages)`
      })
      .catch(() => {});
  }
}

module.exports = {
  addMessageXp,
  getLevel,
  progress,
  sendLevelCard,
  handleLevelUp,
  MSG_PER_LEVEL
};
