const env = require('../config/env');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { detectPingStatus, presenceLabel } = require('../utils/fonts');
const { isStaff } = require('../utils/staff');
const { logProtect } = require('./protection');

const protectedPings = new Map();

async function handleMentions(message) {
  if (!message.mentions.users.size || isStaff(message.member)) return;

  if (message.mentions.users.has(env.PROTECTED_USER_ID)) {
    const target =
      message.guild.members.cache.get(env.PROTECTED_USER_ID) ||
      (await message.guild.members.fetch(env.PROTECTED_USER_ID).catch(() => null));
    const status = presenceLabel(target?.presence?.status || 'offline');
    const key = message.author.id + ':prot';
    const now = Date.now();
    let rec = protectedPings.get(key) || { count: 0, lastAt: 0 };
    if (now - rec.lastAt > 30 * 60 * 1000) rec = { count: 0, lastAt: 0 };
    rec.count++;
    rec.lastAt = now;
    protectedPings.set(key, rec);

    if (rec.count === 1) {
      await message.reply({
        embeds: [
          E(
            'Ping notice',
            `${message.author} **DashWho** is currently **${status}** — he will reply soon.\n\n` +
              `⚠ **Another ping will cause a 1 hour timeout.**`,
            brand.gold
          )
        ]
      });
    } else {
      await message.member.timeout(env.PROTECTED_PING_TIMEOUT_MS, 'Repeated ping of DashWho').catch(() => {});
      await message.reply({
        embeds: [E('Timeout', `${message.author} timed out **1 hour** for pinging DashWho again.`, brand.red)]
      });
      protectedPings.set(key, { count: 0, lastAt: now });
      await logProtect(message.client, message.guild, 'Ping protect · DashWho', `**${message.author.tag}** → 1h`);
    }
  }

  for (const [uid] of message.mentions.users) {
    if (uid === message.author.id || uid === env.PROTECTED_USER_ID) continue;
    const mem =
      message.guild.members.cache.get(uid) || (await message.guild.members.fetch(uid).catch(() => null));
    if (!mem) continue;
    const st = detectPingStatus(mem);
    if (st === 'none') continue;
    if (st === 'mute') {
      await message.member.timeout(60 * 60 * 1000, 'Ping = mute').catch(() => {});
      await message.reply({
        embeds: [
          E(
            'Ping = mute',
            `${message.author} **${mem.displayName}** has **Ping = Mute**.\n**1 hour timeout**.`,
            brand.red
          )
        ]
      });
    } else if (st === 'warn') {
      await message.reply({
        embeds: [E('Ping = warn', `${message.author} **${mem.displayName}** has **Ping = Warn**.`, brand.gold)]
      });
    }
  }
}

module.exports = { handleMentions };
