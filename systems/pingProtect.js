const env = require('../config/env');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { detectPingStatus, presenceLabel } = require('../utils/fonts');
const { isStaff } = require('../utils/staff');
const { logProtect } = require('./protection');

const protectedPings = new Map();
const NO_PING_USER_IDS = ['1545107998060449803'];

/** Never timeout staff or server owner — public warn instead */
async function safeTimeout(member, ms, reason, channel) {
  if (!member) return { ok: false, reason: 'no member' };
  if (member.id === member.guild?.ownerId) {
    if (channel) {
      await channel
        .send({ embeds: [E('Notice', `Cannot timeout the **server owner**. (${reason})`, brand.gold)] })
        .catch(() => {});
    }
    return { ok: false, reason: 'owner' };
  }
  if (isStaff(member)) {
    if (channel) {
      await channel
        .send({
          embeds: [
            E(
              'Staff warning',
              `${member} is **staff** — timeout skipped.\nReason: **${reason}**\n*Staff are not timed out.*`,
              brand.gold
            )
          ]
        })
        .catch(() => {});
    }
    return { ok: false, reason: 'staff' };
  }
  try {
    await member.timeout(ms, reason);
    if (channel) {
      await channel
        .send({
          embeds: [
            E(
              'Timeout',
              `${member} was timed out.\n**Duration:** ${Math.round(ms / 60000)} minutes\n**Reason:** ${reason}`,
              brand.red
            )
          ]
        })
        .catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    if (channel) {
      await channel
        .send({ embeds: [E('Timeout failed', `${member}: ${e.message}`, brand.red)] })
        .catch(() => {});
    }
    return { ok: false, reason: e.message };
  }
}

async function handleMentions(message) {
  if (!message.mentions.users.size || isStaff(message.member)) return;

  // Pinging the bot → roast + 1h timeout
  const botId = message.client?.user?.id;
  if (botId && message.mentions.users.has(botId)) {
    await message
      .reply({
        content: 'I am a moderator for this server not a member 😈',
        allowedMentions: { parse: [] }
      })
      .catch(() => {});
    await safeTimeout(message.member, 60 * 60 * 1000, 'Pinged the bot', message.channel);
    await logProtect(
      message.client,
      message.guild,
      'Bot ping',
      `**${message.author.tag}** pinged the bot · 1h`
    ).catch(() => {});
    return;
  }

  // Special user: funny reply only
  for (const id of NO_PING_USER_IDS) {
    if (message.mentions.users.has(id)) {
      await message
        .reply({
          content: `Bruhhh! Don't ping <@${id}>.`,
          allowedMentions: { users: [] }
        })
        .catch(() => {});
    }
  }

  const protectedIds = env.PROTECTED_USER_IDS || [];

  for (const protId of protectedIds) {
    if (NO_PING_USER_IDS.includes(protId)) continue;
    if (!message.mentions.users.has(protId)) continue;

    const target =
      message.guild.members.cache.get(protId) ||
      (await message.guild.members.fetch(protId).catch(() => null));

    const display =
      target?.displayName ||
      target?.user?.globalName ||
      target?.user?.username ||
      message.mentions.users.get(protId)?.username ||
      'Protected user';

    const status = presenceLabel(target?.presence?.status || 'offline');
    const key = `${message.author.id}:prot:${protId}`;
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
            `${message.author} **${display}** is currently **${status}** — they will reply soon.\n\n` +
              `⚠ **Another ping will cause a 1 hour timeout.**`,
            brand.gold
          )
        ]
      });
    } else {
      await safeTimeout(
        message.member,
        env.PROTECTED_PING_TIMEOUT_MS || 60 * 60 * 1000,
        `Repeated ping of ${display}`,
        message.channel
      );
      protectedPings.set(key, { count: 0, lastAt: now });
      await logProtect(
        message.client,
        message.guild,
        'Ping protect',
        `**${message.author.tag}** → **${display}**`
      );
    }
  }

  for (const [uid] of message.mentions.users) {
    if (uid === message.author.id) continue;
    if (uid === botId) continue;
    if (protectedIds.includes(uid)) continue;
    if (NO_PING_USER_IDS.includes(uid)) continue;

    const mem =
      message.guild.members.cache.get(uid) || (await message.guild.members.fetch(uid).catch(() => null));
    if (!mem) continue;
    const st = detectPingStatus(mem);
    if (st === 'none') continue;
    if (st === 'mute') {
      await safeTimeout(message.member, 60 * 60 * 1000, `Ping = Mute (${mem.displayName})`, message.channel);
    } else if (st === 'warn') {
      await message.reply({
        embeds: [E('Ping = warn', `${message.author} **${mem.displayName}** has **Ping = Warn**.`, brand.gold)]
      });
    }
  }
}

module.exports = { handleMentions, safeTimeout };
