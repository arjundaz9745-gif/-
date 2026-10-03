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

async function handleGenMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const raw = message.content.trim();
  if (!raw) return false;

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

  // Tutorials
  if (['free', 'premium', 'booster'].includes(cmd) && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    await message.delete().catch(() => {});
    await message.channel.send({ embeds: [tutorialEmbed(cmd)] }).catch(() => {});
    return true;
  }

  if (cmd === 'tutorial' && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    const key = (args[0] || '').toLowerCase();
    const text = args.slice(1).join(' ');
    if (!['free', 'premium', 'booster'].includes(key) || !text) {
      await message.reply('`' + P + 'tutorial free|premium|booster <text>`');
      return true;
    }
    if (!data.tutorials) data.tutorials = {};
    data.tutorials[key] = { title: key.toUpperCase(), body: text };
    dataStore.save();
    await message.reply({ embeds: [E('Tutorial', 'Saved **' + key + '**', brand.green)] });
    return true;
  }

  // Status
  if (cmd === 'cstatus' || cmd === 'statuscheck') {
    const ok = hasRequiredStatus(message.member);
    if (ok) {
      const r = await checkAndGrant(message.member);
      await message.reply({
        embeds: [
          E(
            'Status',
            r.granted ? 'Status OK — **Free gen role** granted!' : 'Status OK — you already have access.',
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
            'Required status not found.\nSet custom status to:\n```\n' +
              cfg.freeStatusText +
              '\n```\nThen run `&cstatus` again.',
            brand.red
          )
        ]
      });
    }
    return true;
  }

  // Stock lists: -stock (payment), &fstock, &pstock
  if (cmd === 'stock' && prefix === brand.PREFIX) {
    await message.reply({
      embeds: [E('Payment stock', listPool(message.guild, 'stocks') + '\n\nAdd: `-mcfa add email:pass`')]
    });
    return true;
  }
  if (cmd === 'fstock') {
    await message.reply({
      embeds: [E('Free gen stock', listPool(message.guild, 'fgen') + '\n\nClaim: `&fgen <item>` · Staff: `.fgen add <item> email:pass`')]
    });
    return true;
  }
  if (cmd === 'pstock') {
    await message.reply({
      embeds: [E('Premium gen stock', listPool(message.guild, 'pgen') + '\n\nClaim: `&pgen <item>` · Staff: `.pgen add <item> email:pass`')]
    });
    return true;
  }

  // User claim fgen / pgen
  if (cmd === 'fgen' || cmd === 'pgen') {
    // staff add: .fgen add key line
    if ((args[0] || '').toLowerCase() === 'add') {
      if (!staffOk(message.member)) return true;
      const pool = cmd;
      const key = (args[1] || '').toLowerCase();
      const line = args.slice(2).join(' ');
      if (!key || !line) {
        await message.reply('`' + prefix + cmd + ' add <item> email:pass`');
        return true;
      }
      const lines = line.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      let n = 0;
      for (const L of lines) {
        const r = addStock(pool, key, L);
        if (r.ok) n++;
      }
      await announceAdd(client, message.guild, pool, key, n, message.author.tag);
      await message.reply({
        embeds: [
          E(cmd.toUpperCase(), 'Added **' + n + '** × `' + key + '` · total **' + countStock(pool, key) + '**', brand.green)
        ]
      });
      return true;
    }

    const pool = cmd === 'fgen' ? 'fgen' : 'pgen';
    const key = (args[0] || '').toLowerCase();
    if (!key) {
      await message.reply({
        embeds: [E(cmd.toUpperCase(), listPool(message.guild, pool) + '\n\nUsage: `' + prefix + cmd + ' <item>`')]
      });
      return true;
    }

    const cfg = getCfg();
    const restockId = cfg.restockUserId || '1541659394188509215';
    const vouchLine = 'Legit got ' + key + ' from <@1541659394188509215>';

    if (pool === 'fgen') {
      if (cfg.freeRoleId && !message.member.roles.cache.has(cfg.freeRoleId)) {
        await message.reply({
          embeds: [
            E('Free gen', 'You need the **Free gen** role.\nSet status + `&cstatus` or see `' + P + 'free`.', brand.red)
          ]
        });
        return true;
      }
      const item = takeStock('fgen', key);
      if (!item) {
        await message.reply({
          content:
            String(message.author) +
            ' free role stock is over. Please wait for <@' +
            restockId +
            '> for restocking. To enjoy unlimited stocks upgrade to **premium** tier.',
          allowedMentions: { users: [message.author.id, restockId] }
        });
        return true;
      }
      const dmBody =
        '||' + item + '||\n\n---\n**Vouch required**\nIn <#1553617835635380278> post:\n`' + vouchLine + '`';
      try {
        await message.author.send({
          embeds: [E(resolveEmoji(message.guild, key) + ' Free gen · ' + key, dmBody, brand.green)]
        });
        await message.reply({ embeds: [E('Free gen', 'Sent to your DMs. Vouch in the vouch channel!', brand.green)] });
      } catch (_) {
        await message.reply({ embeds: [E('Free gen', 'Open DMs to receive stock.', brand.red)] });
        addStock('fgen', key, item);
      }
      return true;
    }

    // premium claim
    if (cfg.premiumRoleId && !message.member.roles.cache.has(cfg.premiumRoleId)) {
      await message.reply({
        embeds: [E('Premium gen', 'Premium role required. See `' + P + 'premium`.', brand.red)]
      });
      return true;
    }
    const itemP = takeStock('pgen', key);
    if (!itemP) {
      await message.reply({
        embeds: [
          E('Premium gen', 'No **' + key + '** right now — staff restock soon.', brand.gold)
        ]
      });
      return true;
    }
    const dmBodyP =
      '||' + itemP + '||\n\n---\n**Vouch required**\nIn <#1553617835635380278> post:\n`' + vouchLine + '`';
    try {
      await message.author.send({
        embeds: [E(resolveEmoji(message.guild, key) + ' Premium · ' + key, dmBodyP, brand.green)]
      });
      await message.reply({ embeds: [E('Premium gen', 'Sent to your DMs. Vouch in the vouch channel!', brand.green)] });
    } catch (_) {
      await message.reply({ embeds: [E('Premium gen', 'Open DMs.', brand.red)] });
      addStock('pgen', key, itemP);
    }
    return true;
  }

  // Product: -mcfa add
  if (PRODUCT_KEYS[cmd] && (args[0] || '').toLowerCase() === 'add') {
    if (!staffOk(message.member)) return true;
    const line = args.slice(1).join(' ');
    if (!line) {
      await message.reply('`' + prefix + cmd + ' add email:pass`');
      return true;
    }
    const r = addStock('stocks', cmd, line);
    if (!r.ok) {
      await message.reply(r.reason || 'Failed');
      return true;
    }
    await message.reply({
      embeds: [
        E(
          resolveEmoji(message.guild, cmd) + ' ' + PRODUCT_KEYS[cmd].label,
          'Added · total **' + r.count + '**',
          brand.green
        )
      ]
    });
    return true;
  }

  // methods
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
      await message.reply({ embeds: [E('Method', 'Saved **' + key + '**', brand.green)] });
      return true;
    }
    const lines = Object.entries(data.methods || {}).map(([k, v]) => {
      return resolveEmoji(message.guild, k) + ' **' + k + '**\n' + String(v).slice(0, 200);
    });
    await message.reply({
      embeds: [E('Methods', lines.join('\n\n') || 'Empty — `' + P + 'method set key text`')]
    });
    return true;
  }

  // steal
  if (cmd === 'steal' && prefix === brand.PREFIX) {
    if (!staffOk(message.member)) return true;
    const emoji = args[0] || (message.content.match(/<a?:\w+:\d+>/) || [])[0];
    if (!emoji) {
      await message.reply('`' + P + 'steal <emoji>`');
      return true;
    }
    const m = String(emoji).match(/<(a?):(\w+):(\d+)>/);
    if (!m) {
      await message.reply('Custom emoji only.');
      return true;
    }
    const url = 'https://cdn.discordapp.com/emojis/' + m[3] + '.' + (m[1] === 'a' ? 'gif' : 'png');
    try {
      const created = await message.guild.emojis.create({ attachment: url, name: m[2] });
      await message.reply({ embeds: [E('Steal', 'Added ' + String(created), brand.green)] });
    } catch (e) {
      await message.reply({ embeds: [E('Steal', e.message, brand.red)] });
    }
    return true;
  }

  if (cmd === 'inviterewards' || cmd === 'irewards') {
    if (!staffOk(message.member)) return true;
    await message.channel.send({
      content: '@everyone',
      embeds: [
        E(
          'INVITE · REWARD EVENT',
          '2 inv → MCFA\n4 → Xbox\n5 → Hypixel Unbanned\n…\nOpen a support ticket to claim.\nUse `' +
            P +
            'inviterewards` staff panel text as needed.',
          brand.gold
        )
      ]
    });
    await message.delete().catch(() => {});
    return true;
  }

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
    events[id] = { ends: Date.now() + ms, rewards, channelId: message.channel.id, hostId: message.author.id };
    dataStore.save();
    const lines = rewards.map((r) => '**' + r.invites + '** inv → `' + r.reward + '`').join('\n');
    await message.channel.send({
      embeds: [
        E('Drop event', lines + '\n\nEnds <t:' + Math.floor((Date.now() + ms) / 1000) + ':R>', brand.gold)
      ]
    });
    return true;
  }

  return false;
}

module.exports = { handleGenMessage };
