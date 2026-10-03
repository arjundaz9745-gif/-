const env = require('../config/env');
const { botLog } = require('./logger');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');

function generateCode(len = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function registerCodeOnWebsite(code, meta = {}) {
  const base = (env.WEBSITE_URL || process.env.WEBSITE_URL || '').replace(/\/$/, '');
  const secret = env.REDEEM_SECRET || process.env.REDEEM_SECRET || 'ultimate-redeem-secret-change-me';
  if (!base) return { ok: false, reason: 'WEBSITE_URL not set' };
  try {
    const res = await fetch(base + '/api/redeem/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-redeem-secret': secret
      },
      body: JSON.stringify({
        code,
        secret,
        createdBy: meta.createdBy || 'bot',
        channelId: meta.channelId || null,
        userId: meta.userId || null,
        ticketHint: meta.ticketHint || null
      })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: j.error || `HTTP ${res.status}` };
    return { ok: true, already: !!j.already };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** User says @bot I am here (or "i am here" after mentioning bot) */
async function handleIAmHere(message) {
  const text = (message.content || '').toLowerCase();
  if (!/i\s*am\s*here|i'm\s*here|im\s*here/.test(text)) return false;

  const botId = message.client?.user?.id;
  const mentionedBot =
    (botId && message.mentions.users.has(botId)) ||
    text.includes('i am here') ||
    text.includes("i'm here");

  // Prefer when bot is mentioned OR phrase is clear
  if (!mentionedBot && !/^(hey\s+)?(bot\s+)?i\s*('?m|am)\s*here/.test(text.trim())) {
    // still allow plain "I am here" in any channel
    if (!/i\s*('?m|am)\s*here/.test(text)) return false;
  }

  const code = generateCode(14);
  const reg = await registerCodeOnWebsite(code, {
    createdBy: message.author.tag,
    channelId: message.channel.id,
    userId: message.author.id
  });

  if (!reg.ok) {
    await message.reply({
      embeds: [
        E(
          'Code',
          `Could not register code on website.\n\`${reg.reason}\`\nSet **WEBSITE_URL** + **REDEEM_SECRET** (same as website).`,
          brand.red
        )
      ]
    }).catch(() => {});
    return true;
  }

  await message.reply({
    embeds: [
      E(
        'Redeem code ready',
        `${message.author} your code:\n\n# \`${code}\`\n\n` +
          `1. Open the **Ultimate Rewards** website\n` +
          `2. Log in with Discord\n` +
          `3. Redeem this code\n\n` +
          `*Do not share this code.*`,
        brand.green
      )
    ]
  }).catch(() => {});

  await botLog(
    message.client,
    message.guild,
    'Redeem code generated',
    `**User:** ${message.author.tag} (\`${message.author.id}\`)\n**Code:** ||\`${code}\`||\n**Channel:** ${message.channel}`,
    brand.gold
  );

  // Also notify purchase notify channel if set
  const notifyId = process.env.PURCHASE_NOTIFY_CHANNEL_ID || '1553617840651771974';
  try {
    const ch = await message.guild.channels.fetch(notifyId).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send({
        embeds: [
          E(
            'Customer ready',
            `**${message.author.tag}** said **I am here**\nCode issued · redeem on website`,
            brand.blurple
          )
        ]
      }).catch(() => {});
    }
  } catch (_) {}

  return true;
}

module.exports = { generateCode, registerCodeOnWebsite, handleIAmHere };
