/**
 * Hits poster — server emojis :hit: :mail: :banned: etc.
 * Adding mixed/banned/unbanned/xbox/codes = website only (API).
 * Discord: -hit start | stop | stock
 */
const { EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');
const { em } = require('./stocks');

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
  mixed: { key: 'mixed', label: 'Mixed Hits', emojiName: 'mixed', channel: CHANNELS.mixed },
  hypixel_banned: { key: 'hypixel_banned', label: 'Hypixel Banned', emojiName: 'banned', channel: CHANNELS.hypixel_banned },
  hypixel_unbanned: { key: 'hypixel_unbanned', label: 'Hypixel Unbanned', emojiName: 'unbanned', channel: CHANNELS.hypixel_unbanned },
  xbox_codes: { key: 'xbox_codes', label: 'Xbox Codes', emojiName: 'codes', channel: CHANNELS.xbox_codes },
  xbox: { key: 'xbox', label: 'Xbox Hits', emojiName: 'xbox', channel: CHANNELS.xbox }
};

const ALIASES = {
  mixed: 'mixed', mix: 'mixed', m: 'mixed',
  hypixel_unbanned: 'hypixel_unbanned', unbanned: 'hypixel_unbanned', hu: 'hypixel_unbanned',
  hypixel_banned: 'hypixel_banned', banned: 'hypixel_banned', hb: 'hypixel_banned',
  xbox: 'xbox', xb: 'xbox',
  xbox_codes: 'xbox_codes', codes: 'xbox_codes', xbc: 'xbox_codes'
};

function ic(guild, name) {
  return em(guild, name, `:${name}:`);
}

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
  if (!s || s.startsWith('#')) return null;
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

/** Website / API: body { type, lines: "email:pass\\n..." or combos: [] } */
function addFromWebsite(typeRaw, textOrList, meta = {}) {
  const type = resolveType(typeRaw);
  if (!type) return { ok: false, error: 'bad type' };
  let accounts = [];
  if (Array.isArray(textOrList)) {
    accounts = textOrList
      .map((x) => (typeof x === 'string' ? parseCombo(x) : x))
      .filter(Boolean);
  } else {
    accounts = extractAccounts(String(textOrList || ''));
  }
  if (!accounts.length) return { ok: false, error: 'no combos' };
  const n = queueAdd(type, accounts, meta);
  return { ok: true, added: n, total: ensure().hits[type].length, type };
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

function ynLine(guild, status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('unban')) return `${ic(guild, 'unbanned')} Unbanned`;
  if (s.includes('ban')) return `${ic(guild, 'banned')} Banned`;
  if (s.includes('mixed')) return `${ic(guild, 'mixed')} Mixed`;
  return 'N/A';
}

function buildHitEmbed(hit, guild) {
  const t = HIT_TYPES[hit.type] || HIT_TYPES.mixed;
  const ign = hit.name || DEFAULT_IGN;
  const combo = `${hit.email}:${hit.password}`;
  const typeIcon = ic(guild, t.emojiName);

  const desc = [
    `### ${ic(guild, 'hit')} ${ign}`,
    '',
    `${ic(guild, 'mail')} **Email**`,
    `||\`\`\`${hit.email}\`\`\`||`,
    `${ic(guild, 'password')} **Password**`,
    `||\`\`\`${hit.password}\`\`\`||`,
    '',
    `${ic(guild, 'banned')} **Hypixel Banned**`,
    ynLine(guild, hit.hypixel),
    `${ic(guild, 'hypixel')} **Hypixel Name**`,
    ign,
    `${ic(guild, 'loading')} **Can Change Name**`,
    hit.canChangeName || 'False',
    `${ic(guild, 'ms-coin')} **Hypixel Level**`,
    hit.hypixelLevel || 'N/A',
    `${ic(guild, 'hypixel')} **Hypixel Karma**`,
    hit.hypixelKarma || 'N/A',
    '',
    `${ic(guild, 'donut')} **Donut SMP Banned**`,
    ynLine(guild, hit.donut),
    `${ic(guild, 'donut')} **Donut SMP Balance**`,
    hit.donutBalance || '$N/A',
    `${ic(guild, 'donut')} **Donut SMP PlayTime**`,
    hit.donutPlaytime || 'N/A',
    `${ic(guild, 'donut')} **Donut SMP Shards**`,
    hit.donutShards || 'N/A',
    `${ic(guild, 'donut')} **Donut SMP Kills**`,
    hit.donutKills || 'N/A',
    `${ic(guild, 'donut')} **Donut SMP Deaths**`,
    hit.donutDeaths || 'N/A',
    '',
    `${ic(guild, 'capes')} **Capes**`,
    hit.capes || 'Pan',
    `${ic(guild, 'account')} **Account Type**`,
    hit.accountType || 'Normal',
    `${ic(guild, 'combo')} **Combo**`,
    `||\`\`\`${combo}\`\`\`||`,
    '',
    `*${brand.footer || 'Coded by DashWho · Enhanced by DakshBro'}*`
  ].join('\n');

  return new EmbedBuilder()
    .setColor(hit.type === 'hypixel_banned' ? 0xed4245 : hit.type === 'hypixel_unbanned' ? 0x57f287 : 0x5865f2)
    .setTitle(`${typeIcon} ${t.label}`)
    .setDescription(desc)
    .setThumbnail(avatarUrl(hit.uuid, ign))
    .setImage(skinUrl(hit.uuid, ign))
    .setTimestamp();
}

let posterClient = null;
let posterTimer = null;

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
    await ch.send({ embeds: [buildHitEmbed(hit, ch.guild)] });
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

function stockEmbed(guild) {
  const counts = countAll();
  const run = ensure().hitsRunning ? `${ic(guild, 'unbanned')} **RUNNING**` : `${ic(guild, 'banned')} **STOPPED**`;
  const lines = Object.keys(HIT_TYPES).map((k) => {
    const t = HIT_TYPES[k];
    return `${ic(guild, t.emojiName)} **${t.label}** → \`${counts[k]}\` · <#${t.channel}>`;
  });
  return E(
    `${ic(guild, 'hit')} Hits`,
    `${run} · every **${POST_INTERVAL_MS / 1000}s**\n\n${lines.join('\n')}\n\n` +
      `\`-hit start\` · \`-hit stop\` · \`-hit stock\`\n` +
      `➕ Add combos on the **website** (mixed / banned / unbanned / xbox / codes)`,
    brand.gold
  );
}

async function handleHitsMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const content = (message.content || '').trim();
  const P = brand.PREFIX || '-';
  if (!content.startsWith(P)) return false;
  const args = content.slice(P.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!['hit', 'hits'].includes(cmd)) return false;

  const { isStaff } = require('../utils/staff');
  const staff = isStaff(message.member);
  const g = message.guild;

  if (cmd === 'hits' || !args[0] || ['stock', 'list', 'status'].includes(args[0].toLowerCase())) {
    await message.reply({ embeds: [stockEmbed(g)] });
    return true;
  }

  const sub = args[0].toLowerCase();

  if (sub === 'start') {
    if (!staff) {
      await message.reply({ embeds: [E('Hits', 'Staff only.', brand.red)] });
      return true;
    }
    startPoster(client || message.client);
    await message.reply({
      embeds: [E(`${ic(g, 'hit')} Hits`, `${ic(g, 'unbanned')} Started · **${POST_INTERVAL_MS / 1000}s**`, brand.green)]
    });
    return true;
  }

  if (sub === 'stop') {
    if (!staff) {
      await message.reply({ embeds: [E('Hits', 'Staff only.', brand.red)] });
      return true;
    }
    stopPoster();
    await message.reply({ embeds: [E(`${ic(g, 'hit')} Hits`, `${ic(g, 'banned')} Stopped`, brand.gold)] });
    return true;
  }

  // add / cd blocked on Discord — website only
  if (sub === 'add' || sub === 'cd') {
    await message.reply({
      embeds: [
        E(
          `${ic(g, 'hit')} Hits`,
          `Adding **mixed / banned / unbanned / xbox / codes** is only on the **website** panel.\n` +
            `Discord: \`-hit start\` · \`-hit stop\` · \`-hit stock\``,
          brand.gold
        )
      ]
    });
    return true;
  }

  await message.reply({ embeds: [stockEmbed(g)] });
  return true;
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
  addFromWebsite,
  countAll,
  stockEmbed,
  ensure,
  resolveType
};
