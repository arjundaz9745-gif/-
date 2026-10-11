const fs = require('fs');
const path = require('path');
const dataStore = require('../utils/data');
const brand = require('../config/brand');
const { E } = require('../utils/embeds');

const STAFF_ROLE = process.env.STOCK_STAFF_ROLE || '1548173330794815599';
const OWNERS = new Set(
  String(process.env.BOT_OWNER_IDS || '1541659394188509215,1080190046138802306')
    .split(/[,;\s]+/)
    .filter(Boolean)
);

const FREE_SERVICES = ['mcnfa', 'mcfa', 'donut', 'hypixel'];
const PREMIUM_SERVICES = ['mcnfa', 'mcfa', 'donut', 'hypixel'];

function stockDir() {
  // Prefer project folder; on Render free this resets unless persistent disk
  const base = process.env.STOCK_DIR || path.join(__dirname, '..', 'stockdata');
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch (_) {}
  return base;
}

function filePath(tier, service) {
  return path.join(stockDir(), `${tier}_${service}.txt`);
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

function writeStock(tier, service, lines) {
  fs.writeFileSync(filePath(tier, service), lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function addStock(tier, service, combos) {
  const cur = readStock(tier, service);
  cur.push(...combos);
  writeStock(tier, service, cur);
  return combos.length;
}

function takeStock(tier, service) {
  const cur = readStock(tier, service);
  if (!cur.length) return null;
  const item = cur.shift();
  writeStock(tier, service, cur);
  return item;
}

function counts(tier) {
  const services = tier === 'premium' ? PREMIUM_SERVICES : FREE_SERVICES;
  const o = {};
  for (const s of services) o[s] = readStock(tier, s).length;
  return o;
}

function isStockStaff(member) {
  if (!member) return false;
  if (OWNERS.has(member.id)) return true;
  return member.roles?.cache?.has(STAFF_ROLE);
}

function vaultEmbed(tier) {
  const c = counts(tier);
  const title = tier === 'premium' ? '💎 PREMIUM VAULT' : '🆓 FREE VAULT';
  const note = tier === 'premium' ? '(permanent stock files)' : '';
  const lines = Object.entries(c).map(([s, n]) => `• **${s}** → \`${n}\``);
  return E(title, lines.join('\n') + `\n${note}\n\`-${tier} <service>\``, brand.color);
}

/** Pending legit confirmations: messageId -> { staffId, customerId, item, channelId } */
const pendingLegit = new Map();

async function handleStockCommands(message) {
  if (!message.guild || message.author.bot) return false;
  const P = brand.PREFIX || '-';
  if (!message.content.startsWith(P)) return false;
  const args = message.content.slice(P.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();

  if (cmd === 'free' || cmd === 'premium') {
    const tier = cmd;
    const service = (args[0] || '').toLowerCase();
    if (!service) {
      await message.reply({ embeds: [vaultEmbed(tier)] });
      return true;
    }
    if (!isStockStaff(message.member)) {
      await message.reply({ embeds: [E('Vault', 'Staff only.', brand.red)] });
      return true;
    }
    if (args[0]?.toLowerCase() === 'add' || args[1]) {
      // -free add mcfa email:pass...  OR -free mcfa add ...
    }
    // deliver
    const item = takeStock(tier, service);
    if (!item) {
      await message.reply({ embeds: [E('Vault', `No stock for **${service}**.`, brand.red)] });
      return true;
    }
    const reply = await message.reply({
      content:
        `||${item}||\n\n# ARE WE LEGIT?\n` +
        `Reply **yes** / **yeah** / **yep** or **no** / **nope**`
    });
    // try find ticket opener / mentioned user
    const customer =
      message.mentions.users.first()?.id ||
      message.channel.topic?.match(/\d{17,20}/)?.[0] ||
      null;
    pendingLegit.set(reply.id, {
      staffId: message.author.id,
      customerId: customer,
      item: service,
      channelId: message.channel.id,
      expires: Date.now() + 15 * 60 * 1000
    });
    return true;
  }

  // -free add mcfa email:pass
  if ((cmd === 'fadd' || cmd === 'padd') && isStockStaff(message.member)) {
    const tier = cmd === 'fadd' ? 'free' : 'premium';
    const service = (args.shift() || '').toLowerCase();
    const combos = args.filter((a) => a.includes(':'));
    if (!service || !combos.length) {
      await message.reply({ embeds: [E('Vault', `\`-${cmd} <service> email:pass ...\``, brand.gold)] });
      return true;
    }
    const n = addStock(tier, service, combos);
    await message.reply({ embeds: [E('Vault', `Added **${n}** to **${tier}/${service}**`, brand.green)] });
    return true;
  }

  if (cmd === 'stock' || cmd === 'fstock' || cmd === 'pstock') {
    if (cmd === 'fstock') {
      await message.reply({ embeds: [vaultEmbed('free')] });
      return true;
    }
    if (cmd === 'pstock') {
      await message.reply({ embeds: [vaultEmbed('premium')] });
      return true;
    }
    // -stock → both vaults
    const free = counts('free');
    const prem = counts('premium');
    const fl = Object.entries(free).map(([s, n]) => `• **${s}** → \`${n}\``).join('\n') || '_empty_';
    const pl = Object.entries(prem).map(([s, n]) => `• **${s}** → \`${n}\``).join('\n') || '_empty_';
    await message.reply({
      embeds: [
        E(
          '📦 Stock',
          `**FREE VAULT**\n${fl}\n\n**PREMIUM VAULT**\n${pl}\n\n\`-free <service>\` · \`-premium <service>\`\n\`-fadd / -padd <service> email:pass\``,
          brand.color
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
  // reply to bot's ARE WE LEGIT message
  const ref = message.reference?.messageId;
  if (!ref) return false;
  const pend = pendingLegit.get(ref);
  if (!pend || Date.now() > pend.expires) return false;
  if (message.author.id !== pend.staffId && message.author.id !== pend.customerId) {
    // allow customer or staff
  }
  const t = message.content.trim();
  if (YES.test(t)) {
    pendingLegit.delete(ref);
    const who = pend.customerId ? `<@${pend.customerId}>` : 'customer';
    await message.channel.send(`-# PLEASE VOUCH ${who}`).catch(() => {});
    // listen one vouch is handled separately via onVouch
    message.client._pendingVouch = message.client._pendingVouch || new Map();
    message.client._pendingVouch.set(message.channel.id, {
      staffId: pend.staffId,
      customerId: pend.customerId,
      item: pend.item,
      expires: Date.now() + 30 * 60 * 1000
    });
    return true;
  }
  if (NO.test(t)) {
    pendingLegit.delete(ref);
    await message.channel.send(
      `<@${pend.staffId}>, Please Handle it...\n` +
        (pend.customerId ? `<@${pend.customerId}>` : '@customer') +
        `, We're really sorry for that issue.`
    );
    return true;
  }
  return false;
}

async function handleVouchMessage(message) {
  const map = message.client._pendingVouch;
  if (!map) return false;
  const pend = map.get(message.channel.id);
  if (!pend || Date.now() > pend.expires) return false;
  if (!/legit/i.test(message.content)) return false;
  map.delete(message.channel.id);
  const staff = `<@${pend.staffId}>`;
  const text = `Legit got **${pend.item}** from ${staff}`;
  // announce in this channel
  await message.channel
    .send(
      `${pend.customerId ? `<@${pend.customerId}>` : 'Customer'}, Thank you for using our service ❤️\n${text}`
    )
    .catch(() => {});
  // optional: record payout for events
  try {
    const { listActive, markPayout } = require('./events');
    for (const ev of listActive(message.guild.id)) markPayout(ev.id, pend.staffId);
  } catch (_) {}
  return true;
}

module.exports = {
  handleStockCommands,
  handleLegitReply,
  handleVouchMessage,
  addStock,
  takeStock,
  counts,
  vaultEmbed,
  FREE_SERVICES,
  PREMIUM_SERVICES,
  isStockStaff
};
