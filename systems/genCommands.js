const { PermissionFlagsBits } = require('discord.js');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { isStaff } = require('../utils/staff');
const {
  PRODUCT_KEYS,
  resolveEmoji,
  addStock,
  takeStock,
  countStock,
  announceAdd,
  listPool,
  getData
} = require('./genStock');
const { hasRequiredStatus, checkAndGrant, tutorialEmbed, getCfg } = require('./statusRole');
const { parseDuration } = require('../utils/duration');
const { parseEventArgs, getEvents } = require('./events');

function staffOk(member) {
  return isStaff(member) || member?.permissions?.has(PermissionFlagsBits.Administrator);
}

/** Handle -mcfa add, -stock, -steal, -free, &fgen, .fgen, etc. */
async function handleGenMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const raw = message.content.trim();
  if (!raw) return false;

  // Alternate prefixes: & and .
  let prefix = null;
  if (raw.startsWith('&')) prefix = '&';
  else if (raw.startsWith('.')) prefix = '.';
  else if (raw.startsWith(brand.PREFIX)) prefix = brand.PREFIX;
  else return false;

  const body = raw.slice(prefix.length).trim();
  const args = body.split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!cmd) return false;

  const data = getData();
  const P = brand.PREFIX;

  // ——— Tutorials (delete user msg for -premium etc.) ———
  if (['free', 'premium', 'booster'].includes(cmd) && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    await message.delete().catch(() => {});
    await message.channel.send({ embeds: [tutorialEmbed(cmd)] }).catch(() => {});
    return true;
  }

  // set tutorial text: -tutorial free|premium|booster <text>
  if (cmd === 'tutorial' && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    const key = (args[0] || '').toLowerCase();
    const text = args.slice(1).join(' ');
    if (!['free', 'premium', 'booster'].includes(key) || !text) {
      await message.reply('`' + P + 'tutorial free|premium|booster <message text>`');
      return true;
    }
    if (!data.tutorials) data.tutorials = {};
    data.tutorials[key] = { title: key.toUpperCase(), body: text };
    dataStore.save();
    await message.reply({ embeds: [E('Tutorial', `Saved **${key}**`, brand.green)] });
    return true;
  }

  // ——— Status check ———
  if (cmd === 'cstatus' || cmd === 'statuscheck') {
    const ok = hasRequiredStatus(message.member);
    if (ok) {
      const r = await checkAndGrant(message.member);
      await message.reply({
        embeds: [
          E(
            'Status',
            r.granted
              ? '✅ Status OK — **Free gen role** granted!'
              : '✅ Status OK — you already have access.',
            brand.green
          )
        ]
      });
    } else {
      const cfg = getCfg();
      await message.reply({
        embeds: [
          E(
            'Status',
            `❌ Required status not found.\nSet custom status to:\n\`\`\`\n${cfg.freeStatusText}\n\`\`\`\nThen run \`&cstatus\` again.`,
            brand.red
          )
        ]
      });
    }
    return true;
  }

  // ——— User claim: fgen / pgen ———
  if (cmd === 'fgen' || cmd === 'pgen') {
    const pool = cmd === 'fgen' ? 'fgen' : 'pgen';
    const key = (args[0] || '').toLowerCase();
    if (!key) {
      await message.reply({
        embeds: [E(cmd.toUpperCase(), listPool(message.guild, pool) + `\n\nUsage: \`${prefix}${cmd} <item>\``)]
      });
      return true;
    }

    const cfg = getCfg();
    if (pool === 'fgen') {
      if (cfg.freeRoleId && !message.member.roles.cache.has(cfg.freeRoleId)) {
        await message.reply({
          embeds: [
            E(
              'Free gen',
              `You need the **Free gen** role.\nSet status + \`&cstatus\` or see \`${P}free\`.`,
              brand.red
            )
          ]
        });
        return true;
      }
      const item = takeStock('fgen', key);
      if (!item) {
        await message.reply({
          content: `${message.author} free role stock is over. Please wait for <@${cfg.restockUserId}> for restocking. To enjoy unlimited stocks upgrade to **premium** tier.`,
          allowedMentions: { users: [message.author.id, cfg.restockUserId].filter(Boolean) }
        });
        return true;
      }
      try {
        await message.author.send({
          embeds: [E(`${resolveEmoji(message.guild, key)} Free gen · ${key}`, `||${item}||\nLeft in pool may be limited.`, brand.green)]
        });
        await message.reply({ embeds: [E('Free gen', 'Sent to your DMs.', brand.green)] });
      } catch {
        await message.reply({ embeds: [E('Free gen', 'Open DMs to receive stock.', brand.red)] });
        addStock('fgen', key, item); // put back
      }
      return true;
    }

    // premium
    if (cfg.premiumRoleId && !message.member.roles.cache.has(cfg.premiumRoleId)) {
      await message.reply({
        embeds: [E('Premium gen', `Premium role required. See \`${P}premium\`.`, brand.red)]
      });
      return true;
    }
    const item = takeStock('pgen', key);
    if (!item) {
      // "never over" messaging soft
      await message.reply({
        embeds: [
          E(
            'Premium gen',
            `No **${key}** lines right now — staff restock soon. Premium queue is priority.`,
            brand.gold
          )
        ]
      });
      return true;
    }
    try {
      await message.author.send({
        embeds: [E(`${resolveEmoji(message.guild, key)} Premium · ${key}`, `||${item}||`, brand.green)]
      });
      await message.reply({ embeds: [E('Premium gen', 'Sent to your DMs.', brand.green)] });
    } catch {
      await message.reply({ embeds: [E('Premium gen', 'Open DMs.', brand.red)] });
      addStock('pgen', key, item);
    }
    return true;
  }

  // ——— Staff add: .fgen add / .pgen add / -mcfa add ———
  const productCmd = PRODUCT_KEYS[cmd] ? cmd : null;
  if (productCmd && (args[0] || '').toLowerCase() === 'add') {
    if (!staffOk(message.member)) return true;
    const line = args.slice(1).join(' ');
    if (!line) {
      await message.reply('`' + prefix + cmd + ' add email:pass`');
      return true;
    }
    // default to main stocks pool
    const r = addStock('stocks', productCmd, line);
    if (!r.ok) {
      await message.reply(r.reason);
      return true;
    }
    await message.reply({
      embeds: [
        E(
          resolveEmoji(message.guild, productCmd) + ' ' + PRODUCT_KEYS[productCmd].label,
          `Added · total **${r.count}**`,
          brand.green
        )
      ]
    });
    return true;
  }

  if ((cmd === 'fgen' || cmd === 'pgen') && (args[0] || '').toLowerCase() === 'add') {
    if (!staffOk(message.member)) return true;
    const pool = cmd;
    const key = (args[1] || '').toLowerCase();
    const line = args.slice(2).join(' ');
    if (!key || !line) {
      await message.reply('`' + prefix + cmd + ' add <item> email:pass`');
      return true;
    }
    const lines = line.includes('\n') ? line.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [line];
    let n = 0;
    for (const L of lines) {
      const r = addStock(pool, key, L);
      if (r.ok) n++;
    }
    await announceAdd(client, message.guild, pool, key, n, message.author.tag);
    await message.reply({
      embeds: [E(cmd.toUpperCase(), `Added **${n}** × \`${key}\` · total **${countStock(pool, key)}**`, brand.green)]
    });
    return true;
  }

  // ——— stock list ———
  if (cmd === 'stock' && prefix === brand.PREFIX) {
    const main = listPool(message.guild, 'stocks');
    const free = listPool(message.guild, 'fgen');
    const prem = listPool(message.guild, 'pgen');
    await message.reply({
      embeds: [
        E('📦 Stocks', main),
        E('Free gen', free),
        E('Premium gen', prem)
      ]
    });
    return true;
  }

  // ——— methods ———
  if (cmd === 'methods' || cmd === 'method') {
    if (cmd === 'method' && (args[0] || '').toLowerCase() === 'set') {
      if (!staffOk(message.member)) return true;
      const key = (args[1] || '').toLowerCase();
      const text = args.slice(2).join(' ');
      if (!key || !text) {
        await message.reply('`' + P + 'method set <key> <text>`');
        return true;
      }
      data.methods[key] = text;
      dataStore.save();
      await message.reply({ embeds: [E('Method', `Saved **${key}**`, brand.green)] });
      return true;
    }
    const lines = Object.entries(data.methods || {}).map(([k, v]) => {
      const em = resolveEmoji(message.guild, k);
      return `${em} **${k}**\n${String(v).slice(0, 200)}`;
    });
    await message.reply({
      embeds: [E('📜 Methods', lines.join('\n\n') || `Empty — \`${P}method set key text\``)]
    });
    return true;
  }

  // ——— steal emoji ———
  if (cmd === 'steal' && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    const emoji = args[0] || message.content.match(/<a?:\w+:\d+>/)?.[0];
    if (!emoji) {
      await message.reply('`' + P + 'steal <emoji>` or reply with emoji');
      return true;
    }
    const m = String(emoji).match(/<(a?):(\w+):(\d+)>/);
    if (!m) {
      await message.reply('Custom emoji only.');
      return true;
    }
    const animated = m[1] === 'a';
    const name = m[2];
    const id = m[3];
    const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`;
    try {
      const created = await message.guild.emojis.create({ attachment: url, name });
      await message.reply({ embeds: [E('Steal', `Added ${created} \`:${name}:\``, brand.green)] });
    } catch (e) {
      await message.reply({ embeds: [E('Steal', e.message, brand.red)] });
    }
    return true;
  }

  // ——— invite rewards panel ———
  if (cmd === 'inviterewards' || cmd === 'irewards') {
    if (!staffOk(message.member)) return true;
    await message.channel.send({
      content: '@everyone',
      embeds: [
        E(
          '🎁 INVITE · REWARD EVENT 🎁',
          [
            '> ✨ **INVITE • UNLOCK • CLAIM EXCLUSIVE REWARDS**',
            '',
            '╭━━━━━━━━━━━ 🏆 ━━━━━━━━━━━╮',
            '### 🎁 INVITE REWARDS',
            '╰━━━━━━━━━━━ 🏆 ━━━━━━━━━━━╯',
            '',
            '🎟️ **2** → MCFA',
            '🎮 **4** → Xbox Account',
            '⚔️ **5** → MCFA — Hypixel Unbanned',
            '📧 **7** → 3 Hotmail Accounts',
            '📺 **8** → Stream Accounts',
            '📺 **10** → Netflix Premium',
            '🍿 **12** → Crunchyroll Premium',
            '',
            '╭━━━━━━━━━━━ ⚡ ━━━━━━━━━━━╮',
            '### 🔥 METHOD REWARDS',
            '╰━━━━━━━━━━━ ⚡ ━━━━━━━━━━━╯',
            '',
            '🎟️ **2** → MC Redeem Code Method',
            '💠 **4** → Nitro Basic Yearly Method',
            '📧 **5** → MCFA Email Change Method',
            '🔐 **8** → MCFA Password Change Method',
            '💎 **12** → 5,000 Robux Method',
            '👑 **15** → Amazon Prime Method',
            '🎮 **18** → Xbox Gift Card Method',
            '🚀 **20** → 30× Boost Method',
            '🌐 **25** → Free Website Hosting',
            '',
            '### 🚀 HOW TO CLAIM',
            '> Complete invites · Open Support Ticket · Submit proof · Staff claims',
            '',
            '> 💎 **INVITE MORE • UNLOCK MORE**'
          ].join('\n'),
          brand.gold
        )
      ]
    });
    await message.delete().catch(() => {});
    return true;
  }

  // ——— timed event: -event 1h 1=mcfa 2=netflix ———
  if (cmd === 'event' && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    const { timeRaw, rewards } = parseEventArgs(args);
    const ms = parseDuration(timeRaw || '');
    if (!ms || !rewards.length) {
      await message.reply('`' + P + 'event 1h 1=mcfa 2=netflix`');
      return true;
    }
    const id = Date.now().toString(36);
    const events = getEvents();
    events[id] = {
      ends: Date.now() + ms,
      rewards,
      channelId: message.channel.id,
      hostId: message.author.id
    };
    dataStore.save();
    const lines = rewards.map((r) => `**${r.invites}** inv → \`${r.reward}\``).join('\n');
    await message.channel.send({
      embeds: [
        E(
          '🎉 Drop event',
          `${lines}\n\nEnds <t:${Math.floor((Date.now() + ms) / 1000)}:R>\nStaff pays when invites match.`,
          brand.gold
        )
      ]
    });
    return true;
  }

  return false;
}

module.exports = { handleGenMessage };
