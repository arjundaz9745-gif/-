const env = require('../config/env');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { detectPingStatus, presenceLabel } = require('../utils/fonts');
const { isStaff } = require('../utils/staff');
const { logProtect } = require('./protection');

const protectedPings = new Map();
const NO_PING_USER_IDS = ['1545107998060449803'];

const NORMAL_RESET_MS = 20 * 60 * 1000; // 20 min
const TICKET_RESET_MS = 60 * 60 * 1000; // 1 hour in tickets
const MAX_PINGS = 2;

function isTicketChannel(channel) {
  const n = (channel?.name || '').toLowerCase();
  return /^ticket[-_]/i.test(n) || /ticket-\d+/i.test(n);
}

function resetMs(channel) {
  return isTicketChannel(channel) ? TICKET_RESET_MS : NORMAL_RESET_MS;
}

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
              `${member} is **staff** — timeout skipped.\nReason: **${reason}**`,
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
              `${member} timed out **${Math.round(ms / 60000)}m** · ${reason}`,
              brand.red
            )
          ]
        })
        .catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    if (channel) {
      await channel.send({ embeds: [E('Timeout failed', `${member}: ${e.message}`, brand.red)] }).catch(() => {});
    }
    return { ok: false, reason: e.message };
  }
}

/** Only enforce when target appears offline / invisible */
function isInvisible(member) {
  const s = member?.presence?.status;
  // offline or null (no presence) treated as invisible
  return !s || s === 'offline';
}

function pingKey(authorId, targetId, channelId) {
  return `${authorId}:${targetId}:${channelId}`;
}

function getCount(authorId, targetId, channel) {
  const key = pingKey(authorId, targetId, channel.id);
  const row = protectedPings.get(key);
  const window = resetMs(channel);
  if (!row || Date.now() - row.at > window) {
    protectedPings.set(key, { count: 0, at: Date.now() });
    return 0;
  }
  return row.count;
}

function bump(authorId, targetId, channel) {
  const key = pingKey(authorId, targetId, channel.id);
  const window = resetMs(channel);
  const row = protectedPings.get(key);
  if (!row || Date.now() - row.at > window) {
    protectedPings.set(key, { count: 1, at: Date.now() });
    return 1;
  }
  row.count += 1;
  row.at = Date.now();
  return row.count;
}

async function handleMentions(message) {
  if (!message.mentions.users.size) return;
  if (isStaff(message.member)) return;

  const botId = message.client?.user?.id;

  // No-ping special users (always)
  for (const uid of NO_PING_USER_IDS) {
    if (message.mentions.users.has(uid)) {
      await message
        .reply({ content: `Bruhhh! Don't ping <@${uid}>.`, allowedMentions: { users: [] } })
        .catch(() => {});
    }
  }

  // Bot ping — only if you want; user asked invisible system for people
  if (botId && message.mentions.users.has(botId)) {
    await message
      .reply({ content: 'I am a moderator for this server not a member 😈', allowedMentions: { parse: [] } })
      .catch(() => {});
    await safeTimeout(message.member, 60 * 60 * 1000, 'Pinged the bot', message.channel);
    return;
  }

  const protectedIds = String(process.env.PROTECTED_USER_IDS || env.PROTECTED_USER_IDS || '')
    .split(/[,;\s]+/)
    .filter(Boolean);

  for (const [uid] of message.mentions.users) {
    if (uid === message.author.id) continue;
    if (uid === botId) continue;
    if (NO_PING_USER_IDS.includes(uid)) continue;

    const mem =
      message.guild.members.cache.get(uid) || (await message.guild.members.fetch(uid).catch(() => null));
    if (!mem) continue;

    // ONLY when target is invisible / offline
    if (!isInvisible(mem)) continue;

    // Optional: also honor Ping=Mute status text
    const st = detectPingStatus(mem);
    if (st === 'none' && !protectedIds.includes(uid) && !isStaff(mem)) {
      // only protected / staff-looking invisible users? User said ping system for invisible
      // Apply to any invisible ping with max 2
    }

    const n = bump(message.author.id, uid, message.channel);
    const windowLabel = isTicketChannel(message.channel) ? '1 hour' : '20 minutes';

    if (n === 1) {
      await message
        .reply({
          content: `Okay ${message.author}, **${mem.displayName}** looks offline/invisible.\nOne more ping → timeout. (resets in ${windowLabel}) 😈`,
          allowedMentions: { users: [message.author.id] }
        })
        .catch(() => {});
    } else if (n >= MAX_PINGS) {
      await safeTimeout(
        message.member,
        60 * 60 * 1000,
        `Pinged invisible user ${mem.displayName} (${n}x)`,
        message.channel
      );
      protectedPings.delete(pingKey(message.author.id, uid, message.channel.id));
      await logProtect(
        message.client,
        message.guild,
        'Invisible ping',
        `**${message.author.tag}** → **${mem.user.tag}** · ${n}x`
      ).catch(() => {});
    }
  }
}

module.exports = { handleMentions, safeTimeout };
