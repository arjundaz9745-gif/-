/**
 * Pass changer + Microsoft checker
 * &pass / -pass  email:password [newPassword]
 * &check / -check email:password
 */
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { isStaff } = require('../utils/staff');
const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { checkMicrosoft } = require('./msCheck');

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
  const rest = raw.slice(1).trim();
  const args = rest.split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!['pass', 'passchange', 'changepass', 'pc'].includes(cmd)) {
    return false;
  }


  if (['checkproxy', 'proxy'].includes(cmd)) {
    const { probeProxy } = require('./msCheck');
    const wait = await message.reply('Testing proxy…');
    const r = await probeProxy();
    const text = r.ok
      ? ('**Proxy OK**\nIP: `' + r.ip + '`\nMode: ' + r.mode + '\n' + (r.proxy || ''))
      : ('**Proxy FAILED**\n' + (r.error || r.status) + '\n' + (r.proxy || '') + '\n\nSet:\n`MS_CHECK_PROXY=http://USER:PASS@proxy.soax.com:1337`');
    try { await wait.edit(text); } catch (_) { await message.reply(text); }
    return true;
  }

  // ── CHECK (auto + half-manual buttons) ──
  if (['check', 'mscheck', 'chk', 'mcheck'].includes(cmd)) {
    const rawCred = args[0] || '';
    if (!rawCred.includes(':')) {
      await message.reply(
        '**Microsoft checker**\n' +
          '`' + prefix + 'check email:password` — try auto, then staff buttons if needed\n' +
          '`' + prefix + 'mcheck email:password` — staff buttons only (no proxy)\n\n' +
          'Staff clicks: **Login OK** · **Wrong pass** · **No email** · **Not loginable**'
      );
      return true;
    }
    const colon = rawCred.indexOf(':');
    const email = rawCred.slice(0, colon).trim();
    const password = rawCred.slice(colon + 1);
    const manualOnly = cmd === 'mcheck';

    // Optional quick auto (skip if mcheck)
    let auto = null;
    if (!manualOnly) {
      const wait = await message.reply({
        embeds: [E('Checking…', 'Auto-check `' + email + '`…', brand.blurple)]
      });
      try {
        auto = await checkMicrosoft(email, password);
      } catch (e) {
        auto = { ok: false, summary: e.message, error: e.message };
      }
      // Definitive auto results — no need for manual
      const err = String(auto.error || auto.summary || '');
      const definitive =
        auto.ok === true ||
        err === "This Email doesn't exist" ||
        err === 'Not loginable' ||
        err === 'password was changed by original user' ||
        err === 'Login OK';
      if (definitive && (auto.ok || ["This Email doesn't exist", 'Not loginable', 'password was changed by original user'].includes(err))) {
        const color = auto.ok ? brand.green : brand.red;
        const title = auto.ok ? 'Microsoft check · OK' : 'Microsoft check · Problem';
        const desc = auto.ok
          ? '**Status:** Login OK\n**Account:** `' + email + '`'
          : '**Status:** ' + err + '\n**Account:** `' + email + '`\n\n```\n' + err + '\n```';
        try {
          await wait.edit({ embeds: [E(title, desc, color)] });
        } catch (_) {
          await message.reply({ embeds: [E(title, desc, color)] });
        }
        if (!auto.ok) {
          await message.channel.send('```\n' + err + '\n```').catch(() => {});
        }
        return true;
      }
      try {
        await wait.edit({
          embeds: [
            E(
              'Auto-check inconclusive',
              'Could not finish auto check (proxy/Microsoft block).\nSwitching to **staff manual** below.',
              brand.gold
            )
          ]
        });
      } catch (_) {}
    }

    // Half-manual: staff verifies in browser and clicks a button
    const id = 'mc_' + Date.now().toString(36) + '_' + message.author.id.slice(-4);
    const data = dataStore.get();
    if (!data.manualChecks) data.manualChecks = {};
    data.manualChecks[id] = {
      email,
      password,
      userId: message.author.id,
      channelId: message.channel.id,
      guildId: message.guild.id,
      createdAt: Date.now()
    };
    // prune old (>2h)
    for (const [k, v] of Object.entries(data.manualChecks)) {
      if (Date.now() - (v.createdAt || 0) > 2 * 60 * 60 * 1000) delete data.manualChecks[k];
    }
    dataStore.save();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('mcheck:ok:' + id).setLabel('Login OK').setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('mcheck:pass:' + id)
        .setLabel('Wrong password')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mcheck:email:' + id)
        .setLabel("Email doesn't exist")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('mcheck:nol:' + id)
        .setLabel('Not loginable')
        .setStyle(ButtonStyle.Primary)
    );

    const guide =
      '**Half-manual check**\n' +
      '1. Open https://login.live.com in your browser\n' +
      '2. Sign in with the account below\n' +
      '3. Click the button that matches what Microsoft shows\n\n' +
      '**Email**\n```\n' +
      email +
      '\n```\n' +
      '**Password**\n||```' +
      password +
      '```||\n\n' +
      '_Requested by <@' +
      message.author.id +
      '>_';

    await message.reply({
      embeds: [E('Microsoft check · Staff', guide, brand.blurple)],
      components: [row]
    });
    return true;
  }

  // ── PASS CHANGE ──
  const pc = getPassData();
  if (!pc.enabled && !staffOk(message.member)) {
    await message.reply({ embeds: [E('Pass changer', 'Currently offline.', brand.red)] });
    return true;
  }

  if (args[0] && ['list', 'queue'].includes(args[0].toLowerCase()) && staffOk(message.member)) {
    const q = pc.queue.slice(-15);
    const lines = q.length
      ? q.map((j) => '• `' + j.id + '` · ' + j.email + ' · **' + j.status + '** · <@' + j.userId + '>').join('\n')
      : 'Queue empty.';
    await message.reply({ embeds: [E('Pass queue', lines, brand.blurple)] });
    return true;
  }

  const emailpass = args[0];
  let newpass = args[1] || null;
  if (!emailpass || !emailpass.includes(':')) {
    await message.reply(
      '**Pass changer**\n`' +
        prefix +
        'pass email:password [newPassword]`\nExample: `' +
        prefix +
        'pass user@mail.com:OldPass123 MyNewPass!`\n' +
        (staffOk(message.member) ? 'Staff: `' + prefix + 'pass list`' : '')
    );
    return true;
  }

  const parts = emailpass.split(':');
  const email = parts.shift().trim();
  const password = parts.join(':');
  if (!newpass) newpass = genPassword();

  const job = {
    id: 'pc_' + Date.now() + '_' + message.author.id.slice(-4),
    userId: message.author.id,
    userTag: message.author.tag,
    channelId: message.channel.id,
    guildId: message.guild.id,
    email: email,
    password: password,
    newpass: newpass,
    status: 'queued',
    createdAt: new Date().toISOString()
  };

  pc.queue.push(job);
  pc.stats.pending = pc.queue.length;
  dataStore.save();

  const worker = await tryWorker(job);
  if (worker.ok && worker.data && worker.data.status === 'success') {
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
            '**Email** ||`' +
              email +
              '`||\n**New password** ||`' +
              (worker.data.newpass || newpass) +
              '`||',
            brand.green
          )
        ]
      });
    } catch (_) {}
    await message.reply({
      embeds: [E('Pass change', 'Done for `' + email + '` — check your DMs.', brand.green)]
    });
    return true;
  }

  if (worker.ok && worker.data && worker.data.status === 'pending') {
    job.status = 'processing';
    dataStore.save();
  }

  let note = '_No worker URL — staff will process from the dashboard Pass tab._';
  if (worker.reason !== 'no_worker') {
    note = worker.ok ? '_Sent to worker._' : '_Worker: ' + worker.reason + '_';
  }

  await message.reply({
    embeds: [
      E(
        'Pass change queued',
        'Job `' +
          job.id +
          '`\nAccount: `' +
          email +
          '`\nNew password set (saved for when job finishes).\nStatus: **' +
          job.status +
          '**\n' +
          note,
        brand.gold
      )
    ]
  });

  try {
    await message.author.send({
      embeds: [
        E(
          'Pass change request',
          'Job `' +
            job.id +
            '`\nEmail: `' +
            email +
            '`\nRequested new pass: ||`' +
            newpass +
            '`||\nYou will get another DM when it completes.',
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

const CHECK_LABELS = {
  ok: 'Login OK',
  pass: 'password was changed by original user',
  email: "This Email doesn't exist",
  nol: 'Not loginable'
};

async function handleCheckButton(interaction) {
  if (!interaction.customId.startsWith('mcheck:')) return false;
  const parts = interaction.customId.split(':');
  // mcheck:ok:id
  if (parts.length < 3) return false;
  const kind = parts[1];
  const id = parts.slice(2).join(':');
  const label = CHECK_LABELS[kind];
  if (!label) return false;

  // Staff only
  const member = interaction.member;
  if (!staffOk(member)) {
    await interaction.reply({ content: 'Staff only.', ephemeral: true });
    return true;
  }

  const data = dataStore.get();
  const job = data.manualChecks?.[id];
  if (!job) {
    await interaction.reply({ content: 'This check expired. Run the command again.', ephemeral: true });
    return true;
  }

  const email = job.email;
  const ok = kind === 'ok';
  const color = ok ? brand.green : brand.red;
  const title = ok ? 'Microsoft check · OK' : 'Microsoft check · Problem';
  const desc =
    '**Status:** ' +
    label +
    '\n**Account:** `' +
    email +
    '`\n**By:** <@' +
    interaction.user.id +
    '>\n\n```\n' +
    label +
    '\n```';

  delete data.manualChecks[id];
  dataStore.save();

  await interaction.update({
    embeds: [E(title, desc, color)],
    components: []
  });

  // Public copy-paste line
  if (!ok) {
    await interaction.followUp({ content: '```\n' + label + '\n```' }).catch(() => {});
  }

  // DM requester
  try {
    const u = await interaction.client.users.fetch(job.userId);
    await u.send({
      embeds: [
        E(
          title,
          '**Account:** `' + email + '`\n**Result:** ' + label + '\n**Staff:** ' + interaction.user.tag,
          color
        )
      ]
    });
  } catch (_) {}

  return true;
}

module.exports = {
  handlePassMessage,
  handleCheckButton,
  getPassData,
  getPassStats,
  completeJob
};

