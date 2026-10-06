/**
 * Pass changer — queue + optional worker + manual complete from panel
 * Commands: &pass / $pass / -pass  email:password [newPassword]
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
  if (!Array.isArray(d.passChanger.queue)) d.passChanger.queue = [];
  if (!Array.isArray(d.passChanger.history)) d.passChanger.history = [];
  if (!d.passChanger.stats) d.passChanger.stats = { success: 0, failed: 0, pending: 0 };
  return d.passChanger;
}

function staffOk(m) {
  return isStaff(m) || m?.permissions?.has(PermissionFlagsBits.Administrator);
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function tryWorker(job) {
  const pc = getPassData();
  const base = (pc.workerUrl || process.env.PASS_WORKER_URL || '').replace(/\/$/, '');
  if (!base) return { ok: false, reason: 'no_worker' };
  try {
    const res = await fetch(base + '/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: data.error || String(res.status) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function completeJob(jobId, result) {
  const pc = getPassData();
  const idx = pc.queue.findIndex((j) => j.id === jobId);
  let job = idx >= 0 ? pc.queue[idx] : pc.history.find((j) => j.id === jobId);
  if (!job) return null;
  if (idx >= 0) pc.queue.splice(idx, 1);
  job.status = result.status || 'done';
  job.result = result;
  job.finishedAt = new Date().toISOString();
  pc.history.unshift(job);
  if (pc.history.length > 100) pc.history.length = 100;
  if (job.status === 'success') pc.stats.success = (pc.stats.success || 0) + 1;
  else if (job.status === 'failed') pc.stats.failed = (pc.stats.failed || 0) + 1;
  pc.stats.pending = pc.queue.length;
  dataStore.save();
  return job;
}

async function handlePassMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const raw = message.content.trim();
  if (!raw.startsWith('&') && !raw.startsWith('$') && !raw.startsWith('-')) return false;

  const prefix = raw[0];
  const body = raw.slice(1).trim();
  const args = body.split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!['pass', 'passchange', 'changepass', 'pc'].includes(cmd)) return false;

  const pc = getPassData();
  if (!pc.enabled && !staffOk(message.member)) {
    await message.reply({ embeds: [E('Pass changer', 'Currently offline.', brand.red)] });
    return true;
  }

  // staff: -pass list / complete
  if (args[0] && ['list', 'queue'].includes(args[0].toLowerCase()) && staffOk(message.member)) {
    const q = pc.queue.slice(-15);
    const lines = q.length
      ? q.map((j) => `• \`${j.id}\` · ${j.email} · **${j.status}** · <@${j.userId}>`).join('\n')
      : 'Queue empty.';
    await message.reply({ embeds: [E('Pass queue', lines, brand.blurple)] });
    return true;
  }

  const emailpass = args[0];
  let newpass = args[1] || null;
  if (!emailpass || !emailpass.includes(':')) {
    await message.reply(
      `**Pass changer**\n` +
        `\`${prefix}pass email:password [newPassword]\`\n` +
        `Example: \`${prefix}pass user@mail.com:OldPass123 MyNewPass!\`\n` +
        (staffOk(message.member) ? `Staff: \`${prefix}pass list\`` : '')
    );
    return true;
  }

  const [email, ...rest] = emailpass.split(':');
  const password = rest.join(':');
  if (!newpass) newpass = genPassword();

  const job = {
    id: `pc_${Date.now()}_${message.author.id.slice(-4)}`,
    userId: message.author.id,
    userTag: message.author.tag,
    channelId: message.channel.id,
    guildId: message.guild.id,
    email: email.trim(),
    password,
    newpass,
    status: 'queued',
    createdAt: new Date().toISOString()
  };

  pc.queue.push(job);
  pc.stats.pending = pc.queue.length;
  dataStore.save();

  const worker = await tryWorker(job);
  if (worker.ok && worker.data?.status === 'success') {
    completeJob(job.id, {
      status: 'success',
      newpass: worker.data.newpass || newpass,
      note: 'worker'
    });
    try {
      await message.author.send({
        embeds: [
          E(
            'Password changed',
            `**Email** ||\`\`${email.trim()}\`\`||\n**New password** ||\`\`${worker.data.newpass || newpass}\`\`||`,
            brand.green
          )
        ]
      });
    } catch (_) {}
    await message.reply({
      embeds: [E('Pass change', `Done for \`${email.trim()}\` — check your DMs.`, brand.green)]
    });
    return true;
  }

  if (worker.ok && worker.data?.status === 'pending') {
    job.status = 'processing';
    dataStore.save();
  }

  await message.reply({
    embeds: [
      E(
        'Pass change queued',
        `Job \`${job.id}\`\nAccount: \`${email.trim()}\`\nNew password set (saved for when job finishes).\n` +
          `Status: **${job.status}**\n` +
          (worker.reason === 'no_worker'
            ? '_No worker URL — staff will process from the dashboard Pass tab._'
            : worker.ok
              ? '_Sent to worker._'
              : `_Worker: ${worker.reason}_`),
        brand.gold
      )
    ]
  });

  // DM receipt
  try {
    await message.author.send({
      embeds: [
        E(
          'Pass change request',
          `Job \`${job.id}\`\nEmail: \`${email.trim()}\`\nRequested new pass: ||\`\`${newpass}\`\`||\nYou will get another DM when it completes.`,
          brand.blurple
        )
      ]
    });
  } catch (_) {}

  return true;
}

function getPassStats() {
  return getPassData();
}

module.exports = { handlePassMessage, getPassData, getPassStats, completeJob };
