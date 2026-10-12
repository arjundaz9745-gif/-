/**
 * Free / Premium vault — hits-style delivery embeds + ARE WE LEGIT + vouch channel
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');
const { em } = require('./stocks');

const STAFF_ROLE = process.env.STOCK_STAFF_ROLE || '1548173330794815599';
const OWNERS = new Set(
  String(process.env.BOT_OWNER_IDS || '1541659394188509215,1080190046138802306')
    .split(/[,;\s]+/)
    .filter(Boolean)
);
const VOUCH_CHANNEL_ID = process.env.VOUCH_CHANNEL_ID || '1557389777840373820';
const DEFAULT_SERVICES = ['mcnfa', 'mcfa', 'donut', 'hypixel'];

/** Non-Steve variety — real-looking names that usually have custom skins on mc-heads */
const SKIN_POOL = [
  'xXShadowXx', 'BlueFlame92', 'PixelNomad', 'CraftyFox7', 'NovaPulse', 'IronWaffle',
  'MapleDrift', 'SilentEcho3', 'JadeRaptor', 'CloudKoi', 'EmberLynx', 'FrostByte42',
  'SolarMoth', 'NeonCactus', 'QuietStorm', 'AmberWolf9', 'TideRunner', 'CopperOwl',
  'VioletSpark', 'GraniteBee', 'MistyCrow', 'LunarPebble', 'CrimsonYak', 'AzureMango',
  'HoneyBadgerX', 'StormPetal', 'ObsidianRay', 'FernKnight', 'CometDuck', 'RubyNoodle',
  'ZincPanda', 'GlacierFox', 'PebbleShark', 'IvoryMoss', 'TurboSnail', 'QuartzMoth',
  'SagePixel', 'BrickOtter', 'VelvetCrab', 'OrchidBat', 'CinderGoose', 'PrismLlama',
  'DustyKoala', 'NeonBison', 'PlumRaven', 'CoralViper', 'MintJaguar', 'AshPhoenix',
  'CobaltSlug', 'PearlBadger', 'TimberOwl', 'SolarToad', 'NimbusFox', 'AmberPuffin'
];

function pickSkin(username) {
  if (username && String(username).trim() && String(username).toLowerCase() !== 'dashwho') {
    return String(username).trim();
  }
  return SKIN_POOL[Math.floor(Math.random() * SKIN_POOL.length)];
}

function skinUrl(name) {
  return 'https://mc-heads.net/body/' + encodeURIComponent(name) + '/180';
}
function avatarUrl(name) {
  return 'https://mc-heads.net/avatar/' + encodeURIComponent(name) + '/128';
}

function getServices(tier) {
  const d = dataStore.get();
  if (!d.vaultServices) d.vaultServices = { free: [...DEFAULT_SERVICES], premium: [...DEFAULT_SERVICES] };
  const list = d.vaultServices[tier === 'premium' ? 'premium' : 'free'];
  return Array.isArray(list) && list.length ? list.map((s) => String(s).toLowerCase()) : [...DEFAULT_SERVICES];
}

function addService(tier, name, emojiName) {
  const d = dataStore.get();
  if (!d.vaultServices) d.vaultServices = { free: [...DEFAULT_SERVICES], premium: [...DEFAULT_SERVICES] };
  const key = tier === 'premium' ? 'premium' : 'free';
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!n) return { ok: false, error: 'bad name' };
  if (!d.vaultServices[key].includes(n)) d.vaultServices[key].push(n);
  if (!d.serviceEmojis) d.serviceEmojis = {};
  if (emojiName) d.serviceEmojis[n] = String(emojiName).replace(/^:|:$/g, '');
  dataStore.save();
  return { ok: true, services: d.vaultServices, emojis: d.serviceEmojis };
}

function listServiceEmojis() {
  return dataStore.get().serviceEmojis || {};
}

const FREE_SERVICES = DEFAULT_SERVICES;
const PREMIUM_SERVICES = DEFAULT_SERVICES;

function stockDir() {
  const base = process.env.STOCK_DIR || path.join(__dirname, '..', 'stockdata');
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch (_) {}
  return base;
}

function filePath(tier, service) {
  return path.join(stockDir(), `${tier}_${service}.txt`);
}

function metaPath(tier, service) {
  return path.join(stockDir(), `${tier}_${service}_meta.json`);
}

function readStock(tier, service) {
  const fp = filePath(tier, service);
  try {
    if (!fs.existsSync(fp)) return [];
    return fs
      .readFileSync(fp, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readMeta(tier, service) {
  try {
    const fp = metaPath(tier, service);
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeMeta(tier, service, meta) {
  fs.writeFileSync(metaPath(tier, service), JSON.stringify(meta, null, 0), 'utf8');
}

function writeStock(tier, service, lines) {
  fs.writeFileSync(filePath(tier, service), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function parseLine(line) {
  // email:pass OR email:pass:username OR JSON
  if (line.startsWith('{')) {
    try {
      return JSON.parse(line);
    } catch (_) {}
  }
  const parts = String(line).split(':');
  if (parts.length < 2) return null;
  return {
    email: parts[0].trim(),
    password: parts[1].trim(),
    username: parts.length >= 3 ? parts.slice(2).join(':').trim() : null,
    hypixel: null,
    donut: null,
    money: null
  };
}

function addStock(tier, service, combos, extraMeta = {}) {
  const cur = readStock(tier, service);
  const meta = readMeta(tier, service);
  for (const c of combos) {
    const line =
      typeof c === 'string'
        ? c
        : c.username
          ? `${c.email}:${c.password}:${c.username}`
          : `${c.email}:${c.password}`;
    cur.push(line);
    if (typeof c === 'object' && c.email) {
      meta[line] = {
        username: c.username || null,
        hypixel: c.hypixel || null,
        donut: c.donut || null,
        money: c.money || null,
        ...extraMeta
      };
    }
  }
  writeStock(tier, service, cur);
  writeMeta(tier, service, meta);
  return combos.length;
}

function takeStock(tier, service) {
  const cur = readStock(tier, service);
  if (!cur.length) return null;
  const item = cur.shift();
  writeStock(tier, service, cur);
  const meta = readMeta(tier, service);
  const m = meta[item] || {};
  delete meta[item];
  writeMeta(tier, service, meta);
  const parsed = parseLine(item);
  if (!parsed) return null;
  return { ...parsed, ...m, raw: item };
}

function counts(tier) {
  const services = getServices(tier);
  const o = {};
  for (const s of services) o[s] = readStock(tier, s).length;
  return o;
}

function isStockStaff(member) {
  if (!member) return false;
  try {
    const { isAuthorized } = require('./authUsers');
    if (isAuthorized(member.id)) return true;
  } catch (_) {}
  if (OWNERS.has(member.id)) return true;
  return member.roles?.cache?.has(STAFF_ROLE);
}

function icon(guild, name) {
  const map = listServiceEmojis();
  const en = map[name] || name;
  return em(guild, en, `:${en}:`);
}

function banLine(guild, status) {
  const s = String(status || '').toLowerCase();
  if (s === 'banned' || s === 'ban' || s === 'yes' || s === 'y') return `${icon(guild, 'ban')} Banned`;
  if (s === 'unbanned' || s === 'unban' || s === 'no' || s === 'n') return `${icon(guild, 'unban')} Unbanned`;
  if (s === 'unknown' || !s) return '❓ Unknown';
  return String(status);
}

function buildPayEmbed(guild, service, acc) {
  const skin = pickSkin(acc.username);
  const ign = acc.username || skin;
  const combo = `${acc.email}:${acc.password}`;
  const desc = [
    `### ${icon(guild, 'hit')} \`${ign}\``,
    '',
    `${icon(guild, 'mail')} **Email**`,
    `||${acc.email}||`,
    `${icon(guild, 'password')} **Password**`,
    `||${acc.password}||`,
    '',
    `${icon(guild, 'donut')} **DonutSMP** · ${banLine(guild, acc.donut)}`,
    `${icon(guild, 'money')} **Money** · ${acc.money != null && acc.money !== '' ? acc.money : 'N/A'}`,
    `${icon(guild, 'hypixel')} **Hypixel** · ${banLine(guild, acc.hypixel)}`,
    '',
    `${icon(guild, 'combo')} **Combo**`,
    `||${combo}||`
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`${icon(guild, service)} ${String(service).toUpperCase()}`)
    .setDescription(desc)
    .setThumbnail(avatarUrl(skin))
    .setImage(skinUrl(skin))
    .setFooter({ text: 'Ultimate Rewards · DashMod' })
    .setTimestamp();
}

function vaultEmbed(tier, guild) {
  const c = counts(tier);
  const title =
    tier === 'premium'
      ? `${icon(guild, 'premium')} PREMIUM VAULT`
      : `${icon(guild, 'free')} FREE VAULT`;
  const note = tier === 'premium' ? '(permanent stock files)' : '';
  const lines = Object.entries(c).map(([s, n]) => `${icon(guild, s)} **${s}** → \`${n}\``);
  return E(title, `${lines.join('\n')}\n${note}\n\`-${tier} <service>\``, brand.color);
}

const pendingLegit = new Map();
/** staffId -> { tier, service, email, password, username, step } */
const pendingAdd = new Map();

function registerLegitPending(messageId, data) {
  pendingLegit.set(String(messageId), {
    ...data,
    expires: Date.now() + 15 * 60 * 1000
  });
}

async function handleStockCommands(message) {
  if (!message.guild || message.author.bot) return false;
  const P = brand.PREFIX || '-';
  if (!message.content.startsWith(P)) return false;
  const args = message.content.slice(P.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const g = message.guild;

  if (cmd === 'stock' || cmd === 'fstock' || cmd === 'pstock') {
    if (cmd === 'fstock') {
      await message.reply({ embeds: [vaultEmbed('free', g)] });
      return true;
    }
    if (cmd === 'pstock') {
      await message.reply({ embeds: [vaultEmbed('premium', g)] });
      return true;
    }
    const free = counts('free');
    const prem = counts('premium');
    const fl =
      Object.entries(free)
        .map(([s, n]) => `${icon(g, s)} **${s}** → \`${n}\``)
        .join('\n') || '_empty_';
    const pl =
      Object.entries(prem)
        .map(([s, n]) => `${icon(g, s)} **${s}** → \`${n}\``)
        .join('\n') || '_empty_';
    await message.reply({
      embeds: [
        E(
          `${icon(g, 'stock')} Stock`,
          `**FREE VAULT**\n${fl}\n\n**PREMIUM VAULT**\n${pl}\n\n\`-free <service>\` · \`-premium <service>\`\n\`-padd <service> email:pass:Username\``,
          brand.color
        )
      ]
    });
    return true;
  }

  // -padd / -premium add → guided questions
  if ((cmd === 'padd' || (cmd === 'premium' && args[0]?.toLowerCase() === 'add')) && isStockStaff(message.member)) {
    if (cmd === 'premium') args.shift();
    const service = (args.shift() || '').toLowerCase();
    const rest = args.join(' ');
    const parts = rest.split(':');
    if (!service || parts.length < 2) {
      await message.reply({
        embeds: [
          E(
            'Premium add',
            '`-padd <service> email:pass:Username`\nThen answer Hypixel / Donut / Money questions.',
            brand.gold
          )
        ]
      });
      return true;
    }
    const email = parts[0].trim();
    const password = parts[1].trim();
    const username = parts.length >= 3 ? parts.slice(2).join(':').trim() : null;
    pendingAdd.set(message.author.id, {
      tier: 'premium',
      service,
      email,
      password,
      username,
      step: 'hypixel',
      expires: Date.now() + 5 * 60 * 1000
    });
    await message.reply({
      content: `${icon(g, 'hypixel')} **Banned on Hypixel?** Reply \`yes\` or \`no\``
    });
    return true;
  }

  if ((cmd === 'fadd' || (cmd === 'free' && args[0]?.toLowerCase() === 'add')) && isStockStaff(message.member)) {
    if (cmd === 'free') args.shift();
    const service = (args.shift() || '').toLowerCase();
    const combos = args.filter((a) => a.includes(':'));
    // also support single blob
    if (!combos.length && args.length) {
      const blob = args.join(' ');
      if (blob.includes(':')) combos.push(...blob.split(/\s+/).filter((x) => x.includes(':')));
    }
    if (!service || !combos.length) {
      await message.reply({
        embeds: [E('Vault', `\`-fadd <service> email:pass\` or \`email:pass:User\``, brand.gold)]
      });
      return true;
    }
    const objs = combos.map(parseLine).filter(Boolean);
    const n = addStock('free', service, objs);
    await message.reply({
      embeds: [E('Vault', `${icon(g, service)} Added **${n}** → free/${service}`, brand.green)]
    });
    return true;
  }

  if (cmd === 'free' || cmd === 'premium') {
    const tier = cmd;
    const service = (args[0] || '').toLowerCase();
    if (!service) {
      await message.reply({ embeds: [vaultEmbed(tier, g)] });
      return true;
    }
    if (!isStockStaff(message.member)) {
      await message.reply({ embeds: [E('Vault', 'Staff only.', brand.red)] });
      return true;
    }
    const acc = takeStock(tier, service);
    if (!acc) {
      await message.reply({
        embeds: [E('Vault', `${icon(g, service)} **${service}** is empty.`, brand.red)]
      });
      return true;
    }
    // luck fill if missing status
    if (!acc.hypixel) acc.hypixel = Math.random() < 0.55 ? 'banned' : 'unbanned';
    if (!acc.donut) acc.donut = Math.random() < 0.55 ? 'banned' : 'unbanned';
    if (acc.money == null) acc.money = Math.random() < 0.4 ? 'N/A' : '$' + (Math.floor(Math.random() * 200000) + 50);

    await message.channel.send({ embeds: [buildPayEmbed(g, service, acc)] });
    const legitMsg = await message.channel.send({
      content: `# ARE WE LEGIT?\nReply **yes** / **yeah** / **yep** or **no** / **nope**`
    });
    const customer =
      message.mentions.users.first()?.id ||
      (message.channel.topic || '').match(/\d{17,20}/)?.[0] ||
      null;
    registerLegitPending(legitMsg.id, {
      staffId: message.author.id,
      customerId: customer,
      item: service,
      channelId: message.channel.id
    });
    return true;
  }

  return false;
}

/** Guided premium-add answers */
async function handlePendingAdd(message) {
  const pend = pendingAdd.get(message.author.id);
  if (!pend || Date.now() > pend.expires) {
    if (pend) pendingAdd.delete(message.author.id);
    return false;
  }
  if (message.content.startsWith(brand.PREFIX || '-')) return false;
  const t = message.content.trim().toLowerCase();
  const g = message.guild;

  if (pend.step === 'hypixel') {
    if (!/^(yes|y|no|n|banned|unbanned)$/i.test(t)) {
      await message.reply('Reply `yes` (banned) or `no` (unbanned) for Hypixel.');
      return true;
    }
    pend.hypixel = /^(yes|y|banned)$/i.test(t) ? 'banned' : 'unbanned';
    pend.step = 'donut';
    pendingAdd.set(message.author.id, pend);
    await message.reply(`${icon(g, 'donut')} **Banned on DonutSMP?** Reply \`yes\` or \`no\``);
    return true;
  }
  if (pend.step === 'donut') {
    if (!/^(yes|y|no|n|banned|unbanned)$/i.test(t)) {
      await message.reply('Reply `yes` or `no` for DonutSMP.');
      return true;
    }
    pend.donut = /^(yes|y|banned)$/i.test(t) ? 'banned' : 'unbanned';
    pend.step = 'money';
    pendingAdd.set(message.author.id, pend);
    await message.reply(`${icon(g, 'money')} **How much money on DonutSMP?** (number or \`N/A\`)`);
    return true;
  }
  if (pend.step === 'money') {
    pend.money = message.content.trim() || 'N/A';
    addStock(pend.tier, pend.service, [
      {
        email: pend.email,
        password: pend.password,
        username: pend.username,
        hypixel: pend.hypixel,
        donut: pend.donut,
        money: pend.money
      }
    ]);
    pendingAdd.delete(message.author.id);
    await message.reply({
      embeds: [
        E(
          'Premium stock',
          `${icon(g, pend.service)} Saved **${pend.service}**\n` +
            `User: **${pend.username || 'random skin'}**\n` +
            `Hypixel: **${pend.hypixel}** · Donut: **${pend.donut}** · Money: **${pend.money}**`,
          brand.green
        )
      ]
    });
    return true;
  }
  return false;
}

const YES = /^(yes|yeah|yea|yep|yup|ya|ye|ok|okay|legit)$/i;
const NO = /^(no|nope|nah|not|false)$/i;

async function handleLegitReply(message) {
  if (message.author.bot) return false;
  const ref = message.reference?.messageId;
  let pend = ref ? pendingLegit.get(ref) : null;
  let pendKey = ref;
  if (!pend) {
    for (const [id, p] of pendingLegit) {
      if (p.channelId === message.channel.id && Date.now() <= p.expires) {
        pend = p;
        pendKey = id;
      }
    }
  }
  if (!pend || Date.now() > pend.expires) return false;
  if (!YES.test(message.content.trim()) && !NO.test(message.content.trim())) return false;
  const t = message.content.trim();
  if (YES.test(t)) {
    pendingLegit.delete(pendKey);
    const who = pend.customerId ? `<@${pend.customerId}>` : 'customer';
    await message.channel
      .send(`-# PLEASE VOUCH ${who} in <#${VOUCH_CHANNEL_ID}>`)
      .catch(() => {});
    message.client._pendingVouch = message.client._pendingVouch || new Map();
    message.client._pendingVouch.set(pend.customerId || message.author.id, {
      staffId: pend.staffId,
      customerId: pend.customerId,
      item: pend.item,
      channelId: message.channel.id,
      expires: Date.now() + 60 * 60 * 1000
    });
    return true;
  }
  if (NO.test(t)) {
    pendingLegit.delete(pendKey);
    await message.channel.send(
      `<@${pend.staffId}>, Please Handle it...\n` +
        (pend.customerId ? `<@${pend.customerId}>` : '@customer') +
        `, We're really sorry for that issue.`
    );
    return true;
  }
  return false;
}

/** Only accept vouch messages in VOUCH_CHANNEL_ID */
async function handleVouchMessage(message) {
  if (message.author.bot) return false;
  if (message.channel.id !== VOUCH_CHANNEL_ID) return false;
  if (!/legit/i.test(message.content)) return false;

  const map = message.client._pendingVouch;
  if (!map || !map.size) return false;

  // match by author as customer, or any pending
  let pend = map.get(message.author.id);
  let key = message.author.id;
  if (!pend) {
    for (const [k, p] of map) {
      if (Date.now() <= p.expires) {
        pend = p;
        key = k;
        break;
      }
    }
  }
  if (!pend || Date.now() > pend.expires) return false;
  map.delete(key);

  const staff = `<@${pend.staffId}>`;
  await message.channel
    .send(
      `${pend.customerId ? `<@${pend.customerId}>` : `<@${message.author.id}>`}, Thank you for using our service ❤️\n` +
        `**Legit got ${pend.item}** from ${staff}`
    )
    .catch(() => {});
  try {
    const { listActive, markPayout } = require('./events');
    for (const ev of listActive(message.guild.id)) markPayout(ev.id, pend.staffId);
  } catch (_) {}
  return true;
}

module.exports = {
  handleStockCommands,
  handlePendingAdd,
  handleLegitReply,
  handleVouchMessage,
  registerLegitPending,
  addStock,
  takeStock,
  counts,
  vaultEmbed,
  getServices,
  addService,
  listServiceEmojis,
  FREE_SERVICES,
  PREMIUM_SERVICES,
  isStockStaff,
  buildPayEmbed,
  VOUCH_CHANNEL_ID
};
