/**
 * Hits poster — styled fields (Wither-like), 5s interval
 * Status from pool type only — no live account checks.
 */
const { EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');

const DEFAULT_IGN = 'Notch';
const NOTCH_UUID = '069a79f4-44e9-4726-a5be-f425402f2e10';
const POST_INTERVAL_MS = parseInt(process.env.HIT_POST_INTERVAL_MS || '5000', 10);

const CHANNELS = {
  mixed: process.env.HIT_CH_MIXED || '1557389796777795665',
  hypixel_banned: process.env.HIT_CH_BANNED || '1557389798765764759',
  hypixel_unbanned: process.env.HIT_CH_UNBANNED || '1557389800045154395',
  xbox_codes: process.env.HIT_CH_CODES || '1557389812028153937',
  xbox: process.env.HIT_CH_XBOX || '1557389804235128883'
};

const HIT_TYPES = {
  mixed: { key: 'mixed', label: 'Mixed Hits', emoji: '🎯', channel: CHANNELS.mixed },
  hypixel_banned: { key: 'hypixel_banned', label: 'Hypixel Banned', emoji: '⛔', channel: CHANNELS.hypixel_banned },
  hypixel_unbanned: { key: 'hypixel_unbanned', label: 'Hypixel Unbanned', emoji: '✅', channel: CHANNELS.hypixel_unbanned },
  xbox_codes: { key: 'xbox_codes', label: 'Xbox Codes', emoji: '🎫', channel: CHANNELS.xbox_codes },
  xbox: { key: 'xbox', label: 'Xbox Hits', emoji: '🎮', channel: CHANNELS.xbox }
};

const ALIASES = {
  mixed: 'mixed', mix: 'mixed', m: 'mixed',
  hypixel_unbanned: 'hypixel_unbanned', unbanned: 'hypixel_unbanned', hu: 'hypixel_unbanned',
  hypixel_banned: 'hypixel_banned', banned: 'hypixel_banned', hb: 'hypixel_banned',
  xbox: 'xbox', xb: 'xbox',
  xbox_codes: 'xbox_codes', codes: 'xbox_codes', xbc: 'xbox_codes'
};

/** Configurable emoji names → Discord custom or unicode fallback */
const EM = {
  mail: process.env.EMOJI_MAIL || '📧',
  password: process.env.EMOJI_PASSWORD || '🔒',
  banned: process.env.EMOJI_BANNED || '🚫',
  unbanned: process.env.EMOJI_UNBANNED || '🟢',
  hypixel: process.env.EMOJI_HYPIXEL || '🏆',
  loading: process.env.EMOJI_LOADING || '⏳',
  coin: process.env.EMOJI_MS_COIN || '🪙',
  donut: process.env.EMOJI_DONUT || '🍩',
  capes: process.env.EMOJI_CAPES || '🧥',
  account: process.env.EMOJI_ACCOUNT || '👤',
  combo: process.env.EMOJI_COMBO || '📋'
};

const pendingCapture = new Map();
let posterClient = null;
let posterTimer = null;

function ensure() {
  const d = dataStore.get();
  if (!d.hits) d.hits = {};
  for (const k of Object.keys(HIT_TYPES)) if (!Array.isArray(d.hits[k])) d.hits[k] = [];
  if (typeof d.hitsRunning !== 'boolean') d.hitsRunning = false;
  return d;
}

function resolveType(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return ALIASES[k] || (HIT_TYPES[k] ? k : null);
}

function parseCombo(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#') || s.startsWith('eyJ')) return null;
  const parts = s.split(':');
  if (parts.length < 2) return null;
  const email = parts[0].trim();
  const password = parts[1].trim();
  if (!email || !password) return null;
  const username = parts.length >= 3 ? parts.slice(2).join(':').trim() || null : null;
  return { email, password, username };
}

function extractAccounts(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes(' ') && /@/.test(trimmed)) {
      for (const t of trimmed.split(/\s+/)) {
        const c = parseCombo(t);
        if (c) out.push(c);
      }
    } else {
      const c = parseCombo(trimmed);
      if (c) out.push(c);
    }
  }
  return out;
}

async function fetchTxt(message) {
  let text = '';
  for (const att of message.attachments.values()) {
    if (!/\.txt$/i.test(att.name || '') && !(att.contentType || '').includes('text')) continue;
    try {
      text += '\n' + (await (await fetch(att.url)).text());
    } catch (_) {}
  }
  return text;
}

function statusForType(type) {
  if (type === 'hypixel_banned') return { hypixel: 'Banned', donut: 'Banned' };
  if (type === 'hypixel_unbanned') return { hypixel: 'Unbanned', donut: 'Unbanned' };
  if (type === 'mixed') return { hypixel: 'Mixed', donut: 'Unknown' };
  return { hypixel: 'N/A', donut: 'N/A' };
}

function makeRecord(acc, type, meta = {}) {
  const hasName = !!(acc.username && String(acc.username).trim());
  const st = statusForType(type);
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    email: acc.email,
    password: acc.password,
    name: hasName ? String(acc.username).trim() : DEFAULT_IGN,
    uuid: hasName ? null : NOTCH_UUID,
    type,
    hypixel: st.hypixel,
    donut: st.donut,
    canChangeName: 'False',
    hypixelLevel: 'N/A',
    hypixelKarma: 'N/A',
    donutBalance: 'N/A',
    donutPlaytime: 'N/A',
    donutShards: 'N/A',
    donutKills: 'N/A',
    donutDeaths: 'N/A',
    capes: 'Pan',
    accountType: 'Normal',
    addedAt: Date.now(),
    addedBy: meta.addedBy || null
  };
}

function queueAdd(type, accounts, meta = {}) {
  const d = ensure();
  let n = 0;
  for (const a of accounts) {
    d.hits[type].push(makeRecord(a, type, meta));
    n++;
  }
  dataStore.save();
  return n;
}

function countAll() {
  const d = ensure();
  const o = {};
  for (const k of Object.keys(HIT_TYPES)) o[k] = d.hits[k].length;
  return o;
}

function skinUrl(uuid, name) {
  if (uuid) return `https://crafatar.com/renders/body/${String(uuid).replace(/-/g, '')}?overlay=true&scale=6`;
  if (name && name !== DEFAULT_IGN) return `https://mc-heads.net/body/${encodeURIComponent(name)}/128`;
  return `https://crafatar.com/renders/body/${NOTCH_UUID.replace(/-/g, '')}?overlay=true&scale=6`;
}
function avatarUrl(uuid, name) {
  if (uuid) return `https://crafatar.com/avatars/${String(uuid).replace(/-/g, '')}?overlay=true&size=128`;
  if (name) return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/128`;
  return `https://crafatar.com/avatars/${NOTCH_UUID.replace(/-/g, '')}?overlay=true&size=128`;
}

function ynLine(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('unban')) return `${EM.unbanned} Unbanned`;
  if (s.includes('ban')) return `${EM.banned} Banned`;
  if (s.includes('mixed')) return `🎯 Mixed`;
  return 'N/A';
}

function buildHitEmbed(hit) {
  const t = HIT_TYPES[hit.type] || HIT_TYPES.mixed;
  const ign = hit.name || DEFAULT_IGN;
  const combo = `${hit.email}:${hit.password}`;

  const desc = [
    `### ${ign}`,
    '',
    `${EM.mail} **Email**`,
    `||\`\`\`${hit.email}\`\`\`||`,
    `${EM.password} **Password**`,
    `||\`\`\`${hit.password}\`\`\`||`,
    '',
    `${EM.banned} **Hypixel Banned**`,
    ynLine(hit.hypixel),
    `${EM.hypixel} **Hypixel Name**`,
    ign,
    `${EM.loading} **Can Change Name**`,
    hit.canChangeName || 'False',
    `${EM.coin} **Hypixel Level**`,
    hit.hypixelLevel || 'N/A',
    `${EM.hypixel} **Hypixel Karma**`,
    hit.hypixelKarma || 'N/A',
    '',
    `${EM.donut} **Donut SMP Banned**`,
    ynLine(hit.donut),
    `${EM.donut} **Donut SMP Balance**`,
    hit.donutBalance || '$N/A',
    `${EM.donut} **Donut SMP PlayTime**`,
    hit.donutPlaytime || 'N/A',
    `${EM.donut} **Donut SMP Shards**`,
    hit.donutShards || 'N/A',
    `${EM.donut} **Donut SMP Kills**`,
    hit.donutKills || 'N/A',
    `${EM.donut} **Donut SMP Deaths**`,
    hit.donutDeaths || 'N/A',
    '',
    `${EM.capes} **Capes**`,
    hit.capes || 'Pan',
    `${EM.account} **Account Type**`,
    hit.accountType || 'Normal',
    `${EM.combo} **Combo**`,
    `||\`\`\`${combo}\`\`\`||`,
    '',
    `*${brand.footer || 'Coded by DashWho · Enhanced by DakshBro'}*`
  ].join('\n');

  return new EmbedBuilder()
    .setColor(hit.type === 'hypixel_banned' ? 0xed4245 : hit.type === 'hypixel_unbanned' ? 0x57f287 : 0x5865f2)
    .setTitle(`${t.emoji} ${t.label}`)
    .setDescription(desc)
    .setThumbnail(avatarUrl(hit.uuid, ign))
    .setImage(skinUrl(hit.uuid, ign))
    .setTimestamp();
}

async function postOne(client, type) {
  const d = ensure();
  const queue = d.hits[type];
  if (!queue?.length) return false;
  const hit = queue.shift();
  dataStore.save();
  const ch = await client.channels.fetch(HIT_TYPES[type].channel).catch(() => null);
  if (!ch?.isTextBased?.()) {
    queue.unshift(hit);
    dataStore.save();
    return false;
  }
  try {
    await ch.send({ embeds: [buildHitEmbed(hit)] });
    return true;
  } catch (e) {
    console.error('[hits]', e.message);
    queue.unshift(hit);
    dataStore.save();
    return false;
  }
}

async function tickPoster() {
  if (!posterClient || !ensure().hitsRunning) return;
  for (const type of ['hypixel_banned', 'mixed', 'hypixel_unbanned', 'xbox', 'xbox_codes']) {
    if (ensure().hits[type]?.length) {
      await postOne(posterClient, type);
      return;
    }
  }
}

function startPoster(client) {
  posterClient = client;
  ensure().hitsRunning = true;
  dataStore.save();
  if (posterTimer) clearInterval(posterTimer);
  posterTimer = setInterval(() => tickPoster().catch(() => {}), POST_INTERVAL_MS);
  tickPoster().catch(() => {});
}

function stopPoster() {
  ensure().hitsRunning = false;
  dataStore.save();
  if (posterTimer) {
    clearInterval(posterTimer);
    posterTimer = null;
  }
}

function stockEmbed() {
  const counts = countAll();
  const run = ensure().hitsRunning ? '🟢 **RUNNING**' : '🔴 **STOPPED**';
  const lines = Object.keys(HIT_TYPES).map((k) => {
    const t = HIT_TYPES[k];
    return `${t.emoji} **${t.label}** → \`${counts[k]}\` · <#${t.channel}>`;
  });
  return E(
    '🎯 Hits',
    `${run} · every **${POST_INTERVAL_MS / 1000}s**\n\n${lines.join('\n')}\n\n` +
      `\`-hit start\` · \`-hit stop\` · \`-hit add <type> email:pass\` · \`-hit add <type> email:pass:Name\``,
    brand.gold
  );
}

function setCapture(uid, type) {
  pendingCapture.set(String(uid), { type, expires: Date.now() + 300000 });
}
function getCapture(uid) {
  const p = pendingCapture.get(String(uid));
  if (!p) return null;
  if (Date.now() > p.expires) {
    pendingCapture.delete(String(uid));
    return null;
  }
  return p;
}
function clearCapture(uid) {
  pendingCapture.delete(String(uid));
}

async function handleHitsMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const content = (message.content || '').trim();
  const P = brand.PREFIX || '-';
  const { isStaff } = require('../utils/staff');

  const cap = getCapture(message.author.id);
  if (cap && !content.startsWith(P)) {
    if (!isStaff(message.member)) return false;
    const accounts = extractAccounts(content + '\n' + (await fetchTxt(message)));
    if (!accounts.length) {
      await message.reply({ embeds: [E('🎯 Hits', '❌ No email:pass', brand.red)] });
      clearCapture(message.author.id);
      return true;
    }
    const n = queueAdd(cap.type, accounts, { addedBy: message.author.id });
    clearCapture(message.author.id);
    await message.reply({
      embeds: [
        E('🎯 Queued', `${HIT_TYPES[cap.type].emoji} **${n}** queued · total **${countAll()[cap.type]}**`, brand.green)
      ]
    });
    return true;
  }

  if (!content.startsWith(P)) return false;
  const args = content.slice(P.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!['hit', 'hits', 'cd'].includes(cmd)) return false;
  const staff = isStaff(message.member);

  if (cmd === 'cd') {
    if (!staff) return void message.reply({ embeds: [E('🎯', 'Staff only', brand.red)] });
    const type = resolveType(args[0]);
    if (!type) return void message.reply({ embeds: [E('🎯', '`-cd mixed|banned|unbanned|xbox|codes`', brand.gold)] });
    setCapture(message.author.id, type);
    await message.reply({ embeds: [E('🎯 Capture', `Next msg → **${HIT_TYPES[type].label}**`, brand.green)] });
    return true;
  }

  if (cmd === 'hits' || (cmd === 'hit' && (!args[0] || ['stock', 'list', 'status'].includes(args[0].toLowerCase())))) {
    await message.reply({ embeds: [stockEmbed()] });
    return true;
  }

  if (cmd === 'hit' && args[0]?.toLowerCase() === 'start') {
    if (!staff) return void message.reply({ embeds: [E('🎯', 'Staff only', brand.red)] });
    startPoster(client || message.client);
    await message.reply({ embeds: [E('🎯 Hits', `🟢 Started · **${POST_INTERVAL_MS / 1000}s**`, brand.green)] });
    return true;
  }

  if (cmd === 'hit' && args[0]?.toLowerCase() === 'stop') {
    if (!staff) return void message.reply({ embeds: [E('🎯', 'Staff only', brand.red)] });
    stopPoster();
    await message.reply({ embeds: [E('🎯 Hits', '🔴 Stopped', brand.gold)] });
    return true;
  }

  if (cmd === 'hit' && args[0]?.toLowerCase() === 'add') {
    if (!staff) return void message.reply({ embeds: [E('🎯', 'Staff only', brand.red)] });
    args.shift();
    let type = resolveType(args[0]);
    let rest = args.slice(1);
    if (!type) {
      type = 'mixed';
      rest = args;
    }
    const accounts = extractAccounts(rest.join(' ') + '\n' + (await fetchTxt(message)));
    if (!accounts.length) {
      await message.reply({ embeds: [E('🎯', '`-hit add mixed email:pass` or `email:pass:Name`', brand.red)] });
      return true;
    }
    const n = queueAdd(type, accounts, { addedBy: message.author.id });
    await message.reply({
      embeds: [E('🎯 Queued', `${HIT_TYPES[type].emoji} **${n}** · queue **${countAll()[type]}**`, brand.green)]
    });
    return true;
  }

  if (cmd === 'hit') {
    await message.reply({ embeds: [stockEmbed()] });
    return true;
  }
  return false;
}

function resumeHitsPoster(client) {
  if (ensure().hitsRunning) startPoster(client);
}

module.exports = {
  HIT_TYPES,
  handleHitsMessage,
  startPoster,
  stopPoster,
  resumeHitsPoster,
  queueAdd,
  countAll,
  stockEmbed,
  ensure
};
