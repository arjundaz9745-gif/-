/**
 * Hits poster — clean embed, stars, luck ban, DashWho default skin
 * -hit start | -hit start mixed | stop | stock
 * Add via website only
 */
const { EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');
const { em } = require('./stocks');

const DEFAULT_IGN = 'DashWho';

const SKIN_POOL = [
  'xXShadowXx', 'BlueFlame92', 'PixelNomad', 'CraftyFox7', 'NovaPulse', 'IronWaffle',
  'MapleDrift', 'SilentEcho3', 'JadeRaptor', 'CloudKoi', 'EmberLynx', 'FrostByte42',
  'SolarMoth', 'NeonCactus', 'QuietStorm', 'AmberWolf9', 'TideRunner', 'CopperOwl',
  'VioletSpark', 'GraniteBee', 'MistyCrow', 'LunarPebble', 'CrimsonYak', 'AzureMango',
  'HoneyBadgerX', 'StormPetal', 'ObsidianRay', 'FernKnight', 'CometDuck', 'RubyNoodle',
  'ZincPanda', 'GlacierFox', 'PebbleShark', 'IvoryMoss', 'TurboSnail', 'QuartzMoth',
  'SagePixel', 'BrickOtter', 'VelvetCrab', 'OrchidBat', 'CinderGoose', 'PrismLlama',
  'DustyKoala', 'NeonBison', 'PlumRaven', 'CoralViper', 'MintJaguar', 'AshPhoenix'
];
function pickRandomSkinName() {
  return SKIN_POOL[Math.floor(Math.random() * SKIN_POOL.length)];
}


const crypto = require('crypto');

/** Deterministic "random" skin id from email (always valid render) */
function skinIdFromEmail(email) {
  return crypto
    .createHash('md5')
    .update(String(email || Math.random()) + String(Date.now() % 7))
    .digest('hex');
}

function randomSkinId() {
  return crypto.randomBytes(16).toString('hex');
}


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
  if (!Array.isArray(d.hitsActiveTypes)) d.hitsActiveTypes = Object.keys(HIT_TYPES);
  if (typeof d.hitStarStep !== 'number') d.hitStarStep = 0;
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
      for (const tok of trimmed.split(/\s+/)) {
        const c = parseCombo(tok);
        if (c) out.push(c);
      }
    } else {
      const c = parseCombo(trimmed);
      if (c) out.push(c);
    }
  }
  return out;
}

function nextStarCount() {
  const d = ensure();
  const filled = 5 - (d.hitStarStep % 5);
  d.hitStarStep = (d.hitStarStep + 1) % 5;
  dataStore.save();
  return filled;
}

function formatStars(guild, count) {
  const n = count || 5;
  const star = ic(guild, 'starss');
  return (star + ' ').repeat(n).trim();
}

function luckStatus(type) {
  if (type === 'hypixel_banned') return { hypixel: 'banned', donut: 'banned' };
  if (type === 'hypixel_unbanned') return { hypixel: 'unbanned', donut: 'unbanned' };
  if (type === 'xbox' || type === 'xbox_codes') return { hypixel: 'n/a', donut: 'n/a' };
  const r = Math.random() * 100;
  if (r < 50) return { hypixel: 'banned', donut: 'banned' };
  if (r < 75) return { hypixel: 'banned', donut: 'unbanned' };
  if (r < 90) return { hypixel: 'unbanned', donut: 'banned' };
  return { hypixel: 'unbanned', donut: 'unbanned' };
}

function randomPlaytime() {
  return Math.floor(Math.random() * 800) + 1 + 'h';
}

function randomMoney() {
  if (Math.random() < 0.35) return 'N/A';
  return '$' + (Math.floor(Math.random() * 500000) + 100).toLocaleString();
}

function makeRecord(acc, type, meta = {}) {
  const hasName = !!(acc.username && String(acc.username).trim());
  const st = luckStatus(type);
  const displayName = hasName ? String(acc.username).trim() : DEFAULT_IGN;
  const skinId = hasName ? displayName : pickRandomSkinName();
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    email: acc.email,
    password: acc.password,
    name: displayName,
    skinId,
    type,
    hypixel: st.hypixel,
    donut: st.donut,
    playtime: randomPlaytime(),
    money: randomMoney(),
    rating: nextStarCount(),
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

function addFromWebsite(typeRaw, textOrList, meta = {}) {
  const type = resolveType(typeRaw);
  if (!type) return { ok: false, error: 'bad type' };
  let accounts = [];
  if (Array.isArray(textOrList)) {
    accounts = textOrList.map((x) => (typeof x === 'string' ? parseCombo(x) : x)).filter(Boolean);
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

function bareId(idOrName) {
  const id = String(idOrName || 'Steve');
  if (/^[0-9a-f]{32}$/i.test(id)) return id.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return id.replace(/-/g, '').toLowerCase();
  return encodeURIComponent(id);
}

/** Discord-friendly skin renders (minotar + mc-heads always return an image) */
function skinUrl(idOrName) {
  const id = String(idOrName || pickRandomSkinName());
  return 'https://mc-heads.net/body/' + encodeURIComponent(id) + '/180';
}
function avatarUrl(idOrName) {
  const id = String(idOrName || pickRandomSkinName());
  return 'https://mc-heads.net/avatar/' + encodeURIComponent(id) + '/128';
}
function skinForHit(hit) {
  return hit.skinId || hit.name || randomSkinId();
}

function banLine(guild, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'banned') return ic(guild, 'ban') + ' Banned';
  if (s === 'unbanned') return ic(guild, 'unban') + ' Unbanned';
  return 'N/A';
}

function buildHitEmbed(hit, guild) {
  const t = HIT_TYPES[hit.type] || HIT_TYPES.mixed;
  const ign = hit.name || DEFAULT_IGN;
  const combo = hit.email + ':' + hit.password;
  const stars = formatStars(guild, hit.rating || 5);

  const desc = [
    '### ' + ic(guild, 'hit') + ' `' + ign + '`',
    '',
    ic(guild, 'mail') + ' **Email**',
    '||' + hit.email + '||',
    ic(guild, 'password') + ' **Password**',
    '||' + hit.password + '||',
    '',
    ic(guild, 'hypixel') + ' **Hypixel** · ' + banLine(guild, hit.hypixel),
    '⏱️ **Playtime** · ' + (hit.playtime || 'N/A'),
    ic(guild, 'donut') + ' **Donut** · ' + banLine(guild, hit.donut),
    ic(guild, 'money') + ' **Money** · ' + (hit.money || 'N/A'),
    '',
    '✨ **Account rated**',
    stars,
    '',
    ic(guild, 'combo') + ' **Combo**',
    '||' + combo + '||'
  ].join('\n');

  return new EmbedBuilder()
    .setColor(
      hit.type === 'hypixel_banned' ? 0xed4245 : hit.type === 'hypixel_unbanned' ? 0x57f287 : 0x5865f2
    )
    .setTitle(ic(guild, t.emojiName) + ' ' + t.label)
    .setDescription(desc)
    .setThumbnail(avatarUrl(skinForHit(hit)))
    .setImage(skinUrl(skinForHit(hit)))
    .setFooter({ text: 'Ultimate Rewards · DashMod' })
    .setTimestamp();
}

let posterClient = null;
let posterTimer = null;

async function postOne(client, type) {
  const d = ensure();
  const queue = d.hits[type];
  if (!queue || !queue.length) return false;
  const hit = queue.shift();
  dataStore.save();
  const ch = await client.channels.fetch(HIT_TYPES[type].channel).catch(() => null);
  if (!ch || !ch.isTextBased || !ch.isTextBased()) {
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
  const d = ensure();
  const order = ['hypixel_banned', 'mixed', 'hypixel_unbanned', 'xbox', 'xbox_codes'];
  const active = new Set(d.hitsActiveTypes || Object.keys(HIT_TYPES));
  for (const type of order) {
    if (!active.has(type)) continue;
    if (d.hits[type] && d.hits[type].length) {
      await postOne(posterClient, type);
      return;
    }
  }
}

function startPoster(client, types) {
  posterClient = client;
  const d = ensure();
  d.hitsRunning = true;
  if (types && types.length) {
    d.hitsActiveTypes = types.map((x) => resolveType(x) || x).filter((x) => HIT_TYPES[x]);
  } else {
    d.hitsActiveTypes = Object.keys(HIT_TYPES);
  }
  if (!d.hitsActiveTypes.length) d.hitsActiveTypes = Object.keys(HIT_TYPES);
  dataStore.save();
  if (posterTimer) clearInterval(posterTimer);
  posterTimer = setInterval(() => tickPoster().catch(() => {}), POST_INTERVAL_MS);
  tickPoster().catch(() => {});
  return d.hitsActiveTypes;
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
  const run = ensure().hitsRunning
    ? ic(guild, 'unbanned') + ' **RUNNING**'
    : ic(guild, 'banned') + ' **STOPPED**';
  const lines = Object.keys(HIT_TYPES).map((k) => {
    const t = HIT_TYPES[k];
    return ic(guild, t.emojiName) + ' **' + t.label + '** → `' + counts[k] + '` · <#' + t.channel + '>';
  });
  return E(
    ic(guild, 'hit') + ' Hits',
    run +
      ' · every **' +
      POST_INTERVAL_MS / 1000 +
      's**\n\n' +
      lines.join('\n') +
      '\n\n`-hit start` (all) · `-hit start mixed` · `-hit stop` · `-hit stock`\n➕ Add on **website**',
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
  if (cmd !== 'hit' && cmd !== 'hits') return false;

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
    const which = args[1] ? resolveType(args[1]) : null;
    const active = startPoster(client || message.client, which ? [which] : null);
    const label = which ? '**' + HIT_TYPES[which].label + '** only' : '**all pools**';
    await message.reply({
      embeds: [
        E(
          ic(g, 'hit') + ' Hits',
          ic(g, 'unbanned') +
            ' Started ' +
            label +
            ' · every **' +
            POST_INTERVAL_MS / 1000 +
            's**\n' +
            active.map((k) => ic(g, HIT_TYPES[k].emojiName) + ' ' + HIT_TYPES[k].label).join('\n'),
          brand.green
        )
      ]
    });
    return true;
  }

  if (sub === 'stop') {
    if (!staff) {
      await message.reply({ embeds: [E('Hits', 'Staff only.', brand.red)] });
      return true;
    }
    stopPoster();
    await message.reply({
      embeds: [E(ic(g, 'hit') + ' Hits', ic(g, 'banned') + ' Stopped', brand.gold)]
    });
    return true;
  }

  if (sub === 'add' || sub === 'cd') {
    await message.reply({
      embeds: [
        E(
          ic(g, 'hit') + ' Hits',
          'Add combos on the **website** Hits tab.\nDiscord: `-hit start` · `-hit start mixed` · `-hit stop` · `-hit stock`',
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
  if (ensure().hitsRunning) startPoster(client, ensure().hitsActiveTypes);
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
