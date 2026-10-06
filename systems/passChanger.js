/**
 * Pass changer — queue jobs for dashboard / external worker
 * Command: &pass <email:password> [newpass]
 */
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { isStaff } = require('../utils/staff');
const { PermissionFlagsBits } = require('discord.js');

function getPassData() {
  const d = dataStore.get();
  if (!d.passChanger) {
    d.passChanger = {
      enabled: true,
      workerUrl: process.env.PASS_WORKER_URL || '',
      queue: [],
      history: [],
      stats: { success: 0, failed: 0, pending: 0 }
    };
  }
  return d.passChanger;
}

function staffOk(m) {
  return isStaff(m) || m?.permissions?.has(PermissionFlagsBits.Administrator);
}

async function handlePassMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const raw = message.content.trim();
  if (!raw.startsWith('&') && !raw.startsWith('$')) return false;

  const prefix = raw[0];
  const body = raw.slice(1).trim();
  const args = body.split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!['pass', 'passchange', 'changepass', 'pc'].includes(cmd)) return false;

  const pc = getPassData();
  if (!pc.enabled && !staffOk(message.member)) {
    await message.reply('Pass changer is offline.');
    return true;
  }

  const emailpass = args[0];
  const newpass = args[1] || null;
  if (!emailpass || !emailpass.includes(':')) {
    await message.reply(
      `Usage: \`${prefix}pass email:password [newPassword]\`\n` +
        `Example: \`${prefix}pass user@mail.com:oldpass MyNewPass123\``
    );
    return true;
  }

  const [email, ...rest] = emailpass.split(':');
  const password = rest.join(':');
  const job = {
    id: `pc_${Date.now()}_${message.author.id}`,
    userId: message.author.id,
    userTag: message.author.tag,
    channelId: message.channel.id,
    email: email.trim(),
    password,
    newpass: newpass || null,
    status: 'queued',
    createdAt: new Date().toISOString()
  };

  pc.queue.push(job);
  pc.stats.pending = (pc.stats.pending || 0) + 1;
  dataStore.save();

  // optional external worker
  if (pc.workerUrl) {
    try {
      const res = await fetch(pc.workerUrl.replace(/\/$/, '') + '/job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch (e) {
      console.error('[pass] worker', e.message);
    }
  }

  await message.reply({
    embeds: [
      E(
        'Pass change queued',
        `Job **${job.id}**\nAccount: \`${email.trim()}\`\n` +
          (newpass ? `Target password set.\n` : `A password will be generated.\n`) +
          `Status: **queued** — check dashboard or wait for DM when done.`,
        brand.gold
      )
    ]
  });
  return true;
}

function getPassStats() {
  return getPassData();
}

module.exports = { handlePassMessage, getPassData, getPassStats };
