const { PermissionFlagsBits } = require('discord.js');
const brand = require('../config/brand');
const env = require('../config/env');
const { ROLE } = require('../config/roles');
const { E } = require('../utils/embeds');
const { isStaff } = require('../utils/staff');
const { stylish } = require('../utils/fonts');
const { parseDuration } = require('../utils/duration');
const dataStore = require('../utils/data');
const { buildInviteEmbed, ensureInviteStats, inviteBreakdown } = require('../systems/invites');
const { exportToChannel, importFromChannel, scheduleExport } = require('../systems/sync');
const { giveawayEmbed, giveawayRow, endGiveaway } = require('../systems/giveaways');

async function handleCommand(message, client) {
  if (!message.content.startsWith(brand.PREFIX)) return false;
  const args = message.content.slice(brand.PREFIX.length).trim().split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!cmd) return true;

  const data = dataStore.get();
  const P = brand.PREFIX;
  const needStaff = () => {
    if (!isStaff(message.member)) {
      message.reply({ embeds: [E('Denied', 'Staff only.', brand.red)] });
      return false;
    }
    return true;
  };

  // ── HELP ──
  if (cmd === 'help' || cmd === 'commands') {
    await message.reply({
      embeds: [
        E(brand.BOT_NAME, [
          '**Invites** `' + P + 'i` `' + P + 'lb i` `' + P + 'addinvite` `' + P + 'rmi`',
          '**Messages** `' + P + 'm` `' + P + 'lb m`',
          '**Mod** `' + P + 'ban` kick timeout warn purge lock slowmode role',
          '**Giveaway** `' + P + 'gstart 1h 1 Prize` · `' + P + 'gend`',
          '**Utility** si userinfo avatar ping afk snipe say poll steal',
          '**Levels** `' + P + 'rank` `' + P + 'level`',
          '**Setup** protection setlog setai setsync export import autorole stock dashboard staffroles',
          '',
          'Slash: /help /invites /giveaway /purge /ban /kick /timeout …'
        ].join('\n'))
      ]
    });
    return true;
  }

  // ── INVITES ──
  if (cmd === 'i' || cmd === 'invites' || cmd === 'inv') {
    const u = message.mentions.users.first() || message.author;
    await message.reply({ embeds: [buildInviteEmbed(u, message.guild.id, message.author.username)] });
    return true;
  }
  if (cmd === 'addinvite' || cmd === 'ainv') {
    if (!needStaff()) return true;
    const u = message.mentions.users.first();
    const n = parseInt(args.find((a) => /^\d+$/.test(a)), 10) || 1;
    if (!u) return message.reply('`' + P + 'addinvite @user [n]`');
    ensureInviteStats(message.guild.id, u.id).joins += n;
    dataStore.save();
    scheduleExport(client, 'addinvite');
    await message.reply({ embeds: [buildInviteEmbed(u, message.guild.id, message.author.username)] });
    return true;
  }
  if (cmd === 'rmi' || cmd === 'removeinvite') {
    const u = message.mentions.users.first() || message.author;
    if (u.id !== message.author.id && !isStaff(message.member)) {
      await message.reply({ embeds: [E('Denied', 'Own invites only.', brand.red)] });
      return true;
    }
    const n = parseInt(args.find((a) => /^\d+$/.test(a)), 10);
    const s = ensureInviteStats(message.guild.id, u.id);
    if (!n && args.length === 0) {
      s.joins = 0; s.leaves = 0; s.fake = 0; s.bonus = 0;
    } else s.joins = Math.max(0, (s.joins || 0) - (n || 1));
    dataStore.save();
    scheduleExport(client, 'rmi');
    await message.reply({ embeds: [buildInviteEmbed(u, message.guild.id, message.author.username)] });
    return true;
  }

  // ── MESSAGES / LB ──
  if (cmd === 'm' || cmd === 'messages') {
    const u = message.mentions.users.first() || message.author;
    const n = data.messages?.[message.guild.id]?.[u.id] || 0;
    await message.reply({ embeds: [E('Messages', `**${u.username}** · **${n.toLocaleString()}**`)] });
    return true;
  }
  if (cmd === 'lb' || cmd === 'leaderboard' || cmd === 'top') {
    const kind = (args[0] || 'm').toLowerCase();
    const gid = message.guild.id;
    if (kind === 'i' || kind === 'invites') {
      const rows = Object.keys(data.inviteStats?.[gid] || {})
        .map((id) => ({ id, ...inviteBreakdown(gid, id) }))
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 15);
      if (!rows.length) return message.reply({ embeds: [E('LB', 'No data')] });
      const lines = [];
      for (let i = 0; i < rows.length; i++) {
        let name = rows[i].id;
        try { name = (await client.users.fetch(rows[i].id)).username; } catch (_) {}
        lines.push(`**#${i + 1}** › **${name}** — **${rows[i].total}**`);
      }
      await message.reply({ embeds: [E('Invite leaderboard', lines.join('\n'))] });
      return true;
    }
    const rows = Object.entries(data.messages?.[gid] || {})
      .map(([id, n]) => ({ id, n: n || 0 }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 15);
    if (!rows.length) return message.reply({ embeds: [E('LB', 'No data')] });
    const lines = [];
    for (let i = 0; i < rows.length; i++) {
      let name = rows[i].id;
      try { name = (await client.users.fetch(rows[i].id)).username; } catch (_) {}
      lines.push(`**#${i + 1}** › **${name}** — **${rows[i].n.toLocaleString()}**`);
    }
    await message.reply({ embeds: [E('Message leaderboard', lines.join('\n'))] });
    return true;
  }

  // ── LEVELS (simple XP from messages) ──
  if (cmd === 'rank' || cmd === 'level' || cmd === 'xp') {
    const u = message.mentions.users.first() || message.author;
    if (!data.levels) data.levels = {};
    if (!data.levels[message.guild.id]) data.levels[message.guild.id] = {};
    const xp = data.levels[message.guild.id][u.id] || 0;
    const level = Math.floor(Math.sqrt(xp / 100));
    const next = Math.pow(level + 1, 2) * 100;
    await message.reply({
      embeds: [E('Level', `**${u.username}**\nLevel **${level}** · XP **${xp}** / **${next}**`)]
    });
    return true;
  }

  // ── MOD ──
  if (['ban', 'kick', 'timeout', 'mute', 'untimeout', 'unmute', 'warn', 'softban'].includes(cmd)) {
    if (!needStaff()) return true;
    const user = message.mentions.users.first();
    if (!user) return message.reply('`' + P + cmd + ' @user`');
    const member = message.guild.members.cache.get(user.id) || (await message.guild.members.fetch(user.id).catch(() => null));
    const reason = args.filter((a) => !a.startsWith('<@')).join(' ') || 'No reason';
    if (cmd === 'warn') {
      if (!data.warnings) data.warnings = {};
      if (!data.warnings[user.id]) data.warnings[user.id] = [];
      data.warnings[user.id].push({ reason, by: message.author.id, at: Date.now() });
      dataStore.save();
      await message.reply({ embeds: [E('Warn', `**${user.tag}** · ${data.warnings[user.id].length} total`, brand.green)] });
      return true;
    }
    if (cmd === 'ban') {
      await message.guild.members.ban(user.id, { reason }).catch((e) => message.reply(e.message));
      await message.reply({ embeds: [E('Banned', user.tag, brand.green)] });
      return true;
    }
    if (cmd === 'softban') {
      await message.guild.members.ban(user.id, { deleteMessageSeconds: 86400, reason }).catch(() => {});
      await message.guild.members.unban(user.id).catch(() => {});
      await message.reply({ embeds: [E('Softban', user.tag, brand.green)] });
      return true;
    }
    if (cmd === 'kick') {
      if (!member) return message.reply('Not found');
      await member.kick(reason).catch((e) => message.reply(e.message));
      await message.reply({ embeds: [E('Kicked', user.tag, brand.green)] });
      return true;
    }
    if (cmd === 'timeout' || cmd === 'mute') {
      if (!member) return message.reply('Not found');
      const dur = args.find((a) => /^\d+[smhd]$/i.test(a)) || '1h';
      const ms = parseDuration(dur);
      if (!ms) return message.reply('Duration e.g. 1h');
      await member.timeout(ms, reason).catch((e) => message.reply(e.message));
      await message.reply({ embeds: [E('Timeout', `**${user.tag}** · **${dur}**`, brand.green)] });
      return true;
    }
    if (cmd === 'untimeout' || cmd === 'unmute') {
      if (!member) return message.reply('Not found');
      await member.timeout(null).catch(() => {});
      await message.reply({ embeds: [E('Untimeout', user.tag, brand.green)] });
      return true;
    }
  }

  if (cmd === 'warnings' || cmd === 'warns') {
    const user = message.mentions.users.first() || message.author;
    const list = data.warnings?.[user.id] || [];
    if (!list.length) return message.reply({ embeds: [E('Warnings', 'None')] });
    await message.reply({ embeds: [E('Warnings', list.slice(-10).map((w, i) => `**${i + 1}.** ${w.reason}`).join('\n'))] });
    return true;
  }
  if (cmd === 'unban') {
    if (!needStaff()) return true;
    const id = (args[0] || '').replace(/\D/g, '');
    if (!id) return message.reply('Need user id');
    await message.guild.members.unban(id).catch(() => null);
    await message.reply({ embeds: [E('Unbanned', id, brand.green)] });
    return true;
  }
  if (cmd === 'purge' || cmd === 'clear' || cmd === 'prune') {
    if (!needStaff()) return true;
    let amount = Math.min(parseInt(args[0], 10) || 0, 100);
    if (amount < 1) return message.reply('`' + P + 'purge 1-100`');
    await message.delete().catch(() => {});
    const deleted = await message.channel.bulkDelete(amount, true).catch(() => null);
    const conf = await message.channel.send({ embeds: [E('Purge', `Deleted **${deleted?.size || 0}**`, brand.green)] });
    setTimeout(() => conf.delete().catch(() => {}), 4000);
    return true;
  }
  if (cmd === 'lock' || cmd === 'unlock') {
    if (!needStaff()) return true;
    const ch = message.mentions.channels.first() || message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: cmd === 'lock' ? false : null }).catch(() => {});
    await message.reply({ embeds: [E(cmd === 'lock' ? 'Locked' : 'Unlocked', `${ch}`, brand.green)] });
    return true;
  }
  if (cmd === 'slowmode' || cmd === 'slow') {
    if (!needStaff()) return true;
    const secs = parseInt(args[0], 10);
    if (isNaN(secs) || secs < 0 || secs > 21600) return message.reply('0-21600');
    await message.channel.setRateLimitPerUser(secs).catch(() => {});
    await message.reply({ embeds: [E('Slowmode', secs ? `${secs}s` : 'Off', brand.green)] });
    return true;
  }
  if (cmd === 'hide' || cmd === 'show') {
    if (!needStaff()) return true;
    const ch = message.mentions.channels.first() || message.channel;
    await ch.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: cmd === 'hide' ? false : null }).catch(() => {});
    await message.reply({ embeds: [E(cmd === 'hide' ? 'Hidden' : 'Shown', `${ch}`, brand.green)] });
    return true;
  }
  if (cmd === 'nick' || cmd === 'nickname') {
    if (!needStaff()) return true;
    const member = message.mentions.members.first() || message.member;
    const nick = args.filter((a) => !a.startsWith('<@')).join(' ') || null;
    await member.setNickname(nick).catch((e) => message.reply(e.message));
    await message.reply({ embeds: [E('Nickname', nick || 'cleared', brand.green)] });
    return true;
  }
  if (cmd === 'role' || cmd === 'addrole' || cmd === 'removerole') {
    if (!needStaff()) return true;
    let sub = (args[0] || '').toLowerCase();
    if (cmd === 'addrole') sub = 'add';
    if (cmd === 'removerole') sub = 'remove';
    const mem = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!mem || !role) return message.reply('`' + P + 'role add|remove @user @role`');
    if (sub === 'add') await mem.roles.add(role).catch((e) => message.reply(e.message));
    else await mem.roles.remove(role).catch((e) => message.reply(e.message));
    await message.reply({ embeds: [E('Role', `**${role.name}** (${sub})`, brand.green)] });
    return true;
  }

  // ── GIVEAWAY ──
  if (cmd === 'gstart' || cmd === 'giveaway') {
    if (!needStaff()) return true;
    const timeRaw = args[0];
    const winners = parseInt(args[1], 10) || 1;
    const prize = args.slice(2).join(' ');
    if (!timeRaw || !prize) return message.reply('`' + P + 'gstart 1h 1 Nitro`');
    const ms = parseDuration(timeRaw);
    if (!ms || ms < 10000) return message.reply('Bad time');
    const g = {
      channelId: message.channel.id,
      prize,
      winners,
      ends: Date.now() + ms,
      hostId: message.author.id,
      entries: [],
      ended: false
    };
    const msg = await message.channel.send({ embeds: [giveawayEmbed(g)], components: [giveawayRow()] });
    if (!data.giveaways) data.giveaways = {};
    data.giveaways[msg.id] = g;
    dataStore.save();
    setTimeout(() => endGiveaway(client, msg.id), ms + 500);
    return true;
  }
  if (cmd === 'gend') {
    if (!needStaff()) return true;
    if (!args[0]) return message.reply('Need message id');
    await endGiveaway(client, args[0]);
    await message.reply({ embeds: [E('Giveaway', 'Ended', brand.green)] });
    return true;
  }

  // ── UTILITY ──
  if (cmd === 'si' || cmd === 'serverinfo' || cmd === 'server') {
    const g = message.guild;
    await message.reply({
      embeds: [
        E('Server info')
          .setThumbnail(g.iconURL({ size: 256 }))
          .addFields(
            { name: 'Name', value: g.name, inline: true },
            { name: 'Members', value: String(g.memberCount), inline: true },
            { name: 'Channels', value: String(g.channels.cache.size), inline: true },
            { name: 'Roles', value: String(g.roles.cache.size), inline: true }
          )
      ]
    });
    return true;
  }
  if (cmd === 'userinfo' || cmd === 'ui' || cmd === 'whois') {
    const user = message.mentions.users.first() || message.author;
    const member = message.guild.members.cache.get(user.id) || (await message.guild.members.fetch(user.id).catch(() => null));
    await message.reply({
      embeds: [
        E(user.username)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'ID', value: user.id, inline: true },
            { name: 'Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
            {
              name: 'Joined',
              value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : '—',
              inline: true
            }
          )
      ]
    });
    return true;
  }
  if (cmd === 'avatar' || cmd === 'av') {
    const user = message.mentions.users.first() || message.author;
    await message.reply({ embeds: [E(user.username).setImage(user.displayAvatarURL({ size: 512 }))] });
    return true;
  }
  if (cmd === 'banner') {
    const user = message.mentions.users.first() || message.author;
    const full = await client.users.fetch(user.id, { force: true }).catch(() => user);
    const banner = full.bannerURL?.({ size: 512 });
    if (!banner) return message.reply({ embeds: [E('Banner', 'None')] });
    await message.reply({ embeds: [E(user.username).setImage(banner)] });
    return true;
  }
  if (cmd === 'ping') {
    const sent = await message.reply({ embeds: [E('Ping', '…')] });
    await sent.edit({
      embeds: [E('Ping', `RT **${sent.createdTimestamp - message.createdTimestamp}ms** · WS **${Math.round(client.ws.ping)}ms**`)]
    });
    return true;
  }
  if (cmd === 'uptime') {
    const s = Math.floor(process.uptime());
    await message.reply({ embeds: [E('Uptime', `**${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s**`)] });
    return true;
  }
  if (cmd === 'botinfo') {
    await message.reply({
      embeds: [E(brand.BOT_NAME, `Servers **${client.guilds.cache.size}** · Ping **${Math.round(client.ws.ping)}ms** · \`${P}\``)]
    });
    return true;
  }
  if (cmd === 'membercount') {
    await message.reply({ embeds: [E('Members', `**${message.guild.memberCount}**`)] });
    return true;
  }
  if (cmd === 'afk') {
    if (!data.afk) data.afk = {};
    data.afk[message.author.id] = { reason: args.join(' ') || 'AFK', at: Date.now() };
    dataStore.save();
    await message.reply({ embeds: [E('AFK', data.afk[message.author.id].reason, brand.green)] });
    return true;
  }
  if (cmd === 'snipe') {
    if (!needStaff()) return true;
    const sn = data.snipes?.[message.channel.id];
    if (!sn) return message.reply({ embeds: [E('Snipe', 'Nothing')] });
    await message.reply({
      embeds: [E('Snipe', sn.content || '*empty*').setAuthor({ name: sn.tag || '?', iconURL: sn.avatar }).setTimestamp(sn.at)]
    });
    return true;
  }
  if (cmd === 'say') {
    if (!needStaff()) return true;
    const t = args.join(' ');
    if (!t) return message.reply('Need text');
    await message.delete().catch(() => {});
    await message.channel.send({ content: t.slice(0, 2000), allowedMentions: { parse: [] } });
    return true;
  }
  if (cmd === 'embed' || cmd === 'announce') {
    if (!needStaff()) return true;
    const t = args.join(' ');
    if (!t) return message.reply('Title | body');
    const parts = t.split('|').map((s) => s.trim());
    await message.delete().catch(() => {});
    await message.channel.send({ embeds: [E(parts[1] ? parts[0] : null, parts[1] || parts[0])] });
    return true;
  }
  if (cmd === 'poll') {
    if (!needStaff()) return true;
    const q = args.join(' ');
    if (!q) return message.reply('Need question');
    const msg = await message.channel.send({ embeds: [E('Poll', q, brand.blurple)] });
    await msg.react('👍').catch(() => {});
    await msg.react('👎').catch(() => {});
    return true;
  }
  if (cmd === 'steal' || cmd === 'addemoji') {
    if (!needStaff()) return true;
    const match = (args[0] || '').match(/<(a?):([\w]+):(\d+)>/);
    if (!match) return message.reply('`' + P + 'steal <emoji>`');
    const url = `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] === 'a' ? 'gif' : 'png'}?size=128`;
    const name = (args[1] || match[2]).replace(/[^\w]/g, '').slice(0, 32) || 'emoji';
    try {
      const emoji = await message.guild.emojis.create({ attachment: url, name });
      await message.reply({ embeds: [E('Emoji', `Added ${emoji}`, brand.green)] });
    } catch (e) {
      await message.reply({ embeds: [E('Emoji', e.message, brand.red)] });
    }
    return true;
  }

  // ── SETUP ──
  if (cmd === 'protection' || cmd === 'protect' || cmd === 'automod') {
    if (!needStaff()) return true;
    const sub = (args[0] || 'status').toLowerCase();
    const p = data.protection || {};
    if (sub === 'status' || !args[0]) {
      await message.reply({
        embeds: [
          E(
            'Protection',
            `Automod **${p.automod !== false ? 'ON' : 'OFF'}**\nAnti-raid **${p.antiraid !== false ? 'ON' : 'OFF'}**\nAnti-nuke **${p.antinuke !== false ? 'ON' : 'OFF'}**`
          )
        ]
      });
      return true;
    }
    if (['automod', 'antiraid', 'antinuke'].includes(sub)) {
      data.protection = data.protection || {};
      data.protection[sub] = ['on', 'true', '1'].includes((args[1] || '').toLowerCase());
      dataStore.save();
      await message.reply({
        embeds: [E('Protection', `**${sub}** → **${data.protection[sub] ? 'ON' : 'OFF'}**`, brand.green)]
      });
      return true;
    }
  }
  if (cmd === 'setlog' || cmd === 'setai' || cmd === 'setsync') {
    if (!needStaff()) return true;
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('`' + P + cmd + ' #channel`');
    if (cmd === 'setlog') {
      data.settings = data.settings || {};
      data.settings.logChannelId = ch.id;
    } else if (cmd === 'setai') data.aiChannelId = ch.id;
    else data.syncChannelId = ch.id;
    dataStore.save();
    await message.reply({ embeds: [E('Set', `${cmd} → ${ch}`, brand.green)] });
    return true;
  }
  if (cmd === 'export') {
    if (!needStaff()) return true;
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('`' + P + 'export #channel`');
    data.syncChannelId = ch.id;
    dataStore.save();
    await exportToChannel(ch, 'manual');
    await message.reply({ embeds: [E('Export', `Sent to ${ch}`, brand.green)] });
    return true;
  }
  if (cmd === 'import') {
    if (!needStaff()) return true;
    const ch =
      message.mentions.channels.first() ||
      (data.syncChannelId && (await message.guild.channels.fetch(data.syncChannelId).catch(() => null)));
    if (!ch) return message.reply('No sync channel');
    const r = await importFromChannel(ch);
    await message.reply({ embeds: [E('Import', r.ok ? r.at || 'OK' : r.reason, r.ok ? brand.green : brand.red)] });
    return true;
  }
  if (cmd === 'autorole') {
    if (!needStaff()) return true;
    if ((args[0] || '').toLowerCase() === 'off') {
      delete data.autorole[message.guild.id];
      dataStore.save();
      await message.reply({ embeds: [E('Autorole', 'Off', brand.green)] });
      return true;
    }
    const role = message.mentions.roles.first();
    if (!role) return message.reply('`' + P + 'autorole @role`');
    if (!data.autorole) data.autorole = {};
    data.autorole[message.guild.id] = role.id;
    dataStore.save();
    await message.reply({ embeds: [E('Autorole', `${role}`, brand.green)] });
    return true;
  }
  if (cmd === 'autoreact') {
    if (!needStaff()) return true;
    if (!data.autoreact) data.autoreact = {};
    if (!data.autoreact[message.guild.id]) data.autoreact[message.guild.id] = [];
    if ((args[0] || '') === 'add') {
      const trigger = (args[1] || '').toLowerCase();
      const emoji = args[2];
      if (!trigger || !emoji) return message.reply('`' + P + 'autoreact add word 👍`');
      data.autoreact[message.guild.id].push({ trigger, emoji });
      dataStore.save();
      await message.reply({ embeds: [E('Autoreact', `\`${trigger}\` → ${emoji}`, brand.green)] });
      return true;
    }
    if ((args[0] || '') === 'list') {
      await message.reply({
        embeds: [
          E('Autoreact', data.autoreact[message.guild.id].map((r) => `\`${r.trigger}\` → ${r.emoji}`).join('\n') || 'Empty')
        ]
      });
      return true;
    }
    await message.reply('add | list');
    return true;
  }
  if (cmd === 'stock') {
    const keys = Object.keys(data.stocks || {});
    if (!keys.length) return message.reply({ embeds: [E('Stock', 'Empty')] });
    await message.reply({
      embeds: [E('Stock', keys.map((k) => `**${k}** · ${(data.stocks[k] || []).length}`).join('\n'))]
    });
    return true;
  }
  if (cmd === 'stockadd') {
    if (!needStaff()) return true;
    const name = (args[0] || '').toLowerCase();
    const line = args.slice(1).join(' ');
    if (!name || !line) return message.reply('`' + P + 'stockadd name item`');
    if (!data.stocks) data.stocks = {};
    if (!data.stocks[name]) data.stocks[name] = [];
    data.stocks[name].push(line);
    dataStore.save();
    scheduleExport(client, 'stock');
    await message.reply({ embeds: [E('Stock', `**${name}** · ${data.stocks[name].length}`, brand.green)] });
    return true;
  }
  if (cmd === 'dashboard' || cmd === 'panel') {
    if (!needStaff()) return true;
    const ch = message.mentions.channels.first() || message.channel;
    const url = (env.DASHBOARD_URL || '').replace(/\/$/, '') || 'Set DASHBOARD_URL in env';
    await ch.send({
      embeds: [
        E(
          'ᴅᴀꜱʜᴍᴏᴅ · Admin panel',
          `**Dashboard**\n${url}\n\n**Admin password**\n||${env.ADMIN_PASSWORD}||\n\nSign in to manage protection, sync, AI, and stats.`
        )
      ]
    });
    await message.reply({ embeds: [E('Dashboard', `Posted in ${ch}`, brand.green)] });
    return true;
  }
  if (cmd === 'staffroles' || cmd === 'ranks' || cmd === 'hierarchy') {
    const lines = [
      ['Founder', ROLE.FOUNDER],
      ['Owner', ROLE.OWNER],
      ['Co-Owner', ROLE.CO_OWNER],
      ['Manager', ROLE.MANAGER],
      ['Discord Dev', ROLE.DISCORD_DEV],
      ['Head Admin', ROLE.HEAD_ADMIN],
      ['Admin', ROLE.ADMIN],
      ['Stocker', ROLE.STOCKER],
      ['Staff Team', ROLE.STAFF_TEAM],
      ['Trial Staff', ROLE.TRIAL_STAFF],
      ['Member', ROLE.MEMBER],
      ['Bots', ROLE.BOTS]
    ].map(([n, id]) => {
      const role = message.guild.roles.cache.get(id);
      return '**' + stylish(n) + '** · ' + (role ? role.name : '—') + ' · `' + id + '`';
    });
    await message.reply({ embeds: [E(stylish('Staff hierarchy'), lines.join('\n'))] });
    return true;
  }
  if (cmd === 'setstaff') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply({ embeds: [E('Denied', 'Admin only', brand.red)] });
      return true;
    }
    const role = message.mentions.roles.first();
    if (!role) return message.reply('`' + P + 'setstaff @role`');
    data.settings = data.settings || {};
    data.settings.staffRoleId = role.id;
    dataStore.save();
    await message.reply({ embeds: [E('Staff', `${role}`, brand.green)] });
    return true;
  }

  return false;
}

module.exports = { handleCommand };
