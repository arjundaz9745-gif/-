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
const { addMapping, removeMapping, listForMessage } = require('../systems/reactionRoles');

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
        E(brand.BOT_NAME + ' · Commands', [
          '**Invites & stats**',
          '`' + P + 'i` / `' + P + 'invites` [@user] — invite log',
          '`' + P + 'addinvite` @user [n] — staff add invites',
          '`' + P + 'rmi` [@user] [n] — remove invites',
          '`' + P + 'm` / `' + P + 'messages` [@user]',
          '`' + P + 'lb i` · `' + P + 'lb m` — leaderboards',
          '`' + P + 'rank` / `' + P + 'level` [@user] — XP level',
          '',
          '**Moderation**',
          '`' + P + 'ban` `' + P + 'kick` `' + P + 'timeout`/`' + P + 'mute` [duration]',
          '`' + P + 'untimeout` `' + P + 'warn` `' + P + 'warnings` `' + P + 'softban` `' + P + 'unban`',
          '`' + P + 'purge`/`' + P + 'clear` <1-100>',
          '`' + P + 'lock` `' + P + 'unlock` `' + P + 'slowmode` `' + P + 'hide` `' + P + 'show`',
          '`' + P + 'nick` `' + P + 'role add|remove` @user @role',
          '',
          '**Giveaways**',
          '`' + P + 'gstart` <time> <winners> <prize> · `' + P + 'gend` <msgId>',
          '',
          '**Utility**',
          '`' + P + 'si` `' + P + 'userinfo` `' + P + 'avatar` `' + P + 'banner`',
          '`' + P + 'ping` `' + P + 'uptime` `' + P + 'botinfo` `' + P + 'membercount`',
          '`' + P + 'afk` `' + P + 'snipe` `' + P + 'say` `' + P + 'embed` `' + P + 'poll` `' + P + 'steal`',
          '',
          '**Protection & setup** (staff)',
          '`' + P + 'protection` [automod|antiraid on/off]',
          '`' + P + 'setlog` `' + P + 'setai` `' + P + 'setsync` #channel',
          '`' + P + 'export` `' + P + 'import` · `' + P + 'autorole` `' + P + 'autoreact`',
          '`' + P + 'stock` `' + P + 'stockadd` · `' + P + 'staffroles`',
          '',
          '**Owner**',
          '`' + P + 'dashboard` [#channel|@user] — panel link (owners only)',
          '',
          '**Slash** `/help` `/invites` `/giveaway` `/purge` `/ban` `/kick` `/timeout` `/serverinfo` …',
          '',
          '*Coded by DashWho · Enhanced by DakshBro*'
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
    // prize = rest, optional last arg or attachment = image
    let rest = args.slice(2);
    let image = null;
    if (message.attachments.size) {
      const img = message.attachments.find((a) => /\.(png|jpe?g|gif|webp)$/i.test(a.name || '') || (a.contentType || '').startsWith('image/'));
      if (img) image = img.url;
    }
    if (rest.length && /^https?:\/\//i.test(rest[rest.length - 1])) {
      image = rest.pop();
    }
    const prize = rest.join(' ');
    if (!timeRaw || !prize) {
      return message.reply('`' + P + 'gstart 1h 1 Nitro`\nOptional image: attach a picture or put image URL at the end\n`' + P + 'gstart 1h 1 Nitro https://i.imgur.com/xxx.png`');
    }
    const ms = parseDuration(timeRaw);
    if (!ms || ms < 10000) return message.reply('Bad time (e.g. 10m, 1h, 1d)');
    const ends = Date.now() + ms;
    const g = {
      prize,
      winners: Math.min(Math.max(winners, 1), 20),
      ends,
      hostId: message.author.id,
      channelId: message.channel.id,
      entries: [],
      ended: false,
      image: image || null
    };
    const msg = await message.channel.send({ embeds: [giveawayEmbed(g)], components: [giveawayRow()] });
    if (!data.giveaways) data.giveaways = {};
    data.giveaways[msg.id] = g;
    dataStore.save();
    await message.reply({ embeds: [E('Giveaway', 'Started' + (image ? ' · with image' : ''), brand.green)] });
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

  // ── REACTION ROLES ──
  if (cmd === 'rr' || cmd === 'reactionrole' || cmd === 'reactionroles') {
    if (!needStaff()) return true;
    const sub = (args[0] || 'help').toLowerCase();

    if (sub === 'help' || sub === '') {
      await message.reply({
        embeds: [E('Reaction roles', [
          '`' + P + 'rr setup 🎉 @Events 📢 @Announce` — post react-to-get-role message',
          '`' + P + 'rr panel` — empty panel,',
          '`' + P + 'rr add <messageId> <emoji> @role` — bind emoji → role',
          '`' + P + 'rr remove <messageId> <emoji>` — unbind',
          '`' + P + 'rr list <messageId>` — list bindings',
          '',
          'Example:',
          '1. `' + P + 'rr panel`',
          '2. `' + P + 'rr add MESSAGE_ID 🎉 @Events Ping`',
          '3. Bot reacts; members click emoji to get the role'
        ].join('\n'))]
      });
      return true;
    }

    if (sub === 'panel') {
      const title = args.slice(1).join(' ') || 'Self roles';
      const emb = E(title, 'React below to get roles.\nStaff: use `' + P + 'rr setup` or `' + P + 'rr add <msgId> <emoji> @role`.');
      const panel = await message.channel.send({ embeds: [emb] });
      await message.reply({ embeds: [E('Panel', 'Message ID: `' + panel.id + '`', brand.green)] });
      return true;
    }

    // -rr setup 🎉 @Role1 📢 @Role2
    if (sub === 'setup' || sub === 'create') {
      const rest = message.content.slice(message.content.toLowerCase().indexOf(sub) + sub.length).trim();
      if (!rest || !message.mentions.roles.size) {
        await message.reply(
          '`' + P + 'rr setup 🎉 @Events Ping 📢 @Announcements`\n' +
            'Order: emoji then @role, repeat for each role.'
        );
        return true;
      }
      // Parse tokens: emoji, role mention pairs
      const tokens = rest.split(/\s+/).filter(Boolean);
      const pairs = [];
      let i = 0;
      while (i < tokens.length) {
        const tok = tokens[i];
        if (/^<@&(\d+)>$/.test(tok)) {
          i++;
          continue;
        }
        // emoji token (unicode or custom)
        const emojiTok = tok;
        // find next role mention after this emoji
        let roleId = null;
        let j = i + 1;
        while (j < tokens.length) {
          const mRole = tokens[j].match(/^<@&(\d+)>$/);
          if (mRole) {
            roleId = mRole[1];
            i = j + 1;
            break;
          }
          j++;
        }
        if (!roleId) {
          i++;
          continue;
        }
        const role = message.guild.roles.cache.get(roleId);
        if (!role) continue;
        pairs.push({ emoji: emojiTok, role });
      }
      if (!pairs.length) {
        await message.reply('Could not parse pairs. Example: `' + P + 'rr setup 🎉 @Events 🔔 @Ping`');
        return true;
      }
      const lines = pairs.map((p) => `React with ${p.emoji} to get **${p.role.name}**`);
      const emb = E(
        '📌 Self roles',
        lines.join('\n') + '\n\n*Click a reaction below to get or remove the role.*'
      );
      const panel = await message.channel.send({ embeds: [emb] });
      for (const p of pairs) {
        addMapping(message.guild.id, panel.id, p.emoji, p.role.id);
        await panel.react(p.emoji).catch(() => {});
      }
      await message.reply({
        embeds: [E('Reaction roles', 'Posted **' + pairs.length + '** roles on `' + panel.id + '`', brand.green)]
      });
      return true;
    }

    if (sub === 'add') {
      const messageId = args[1];
      const emojiRaw = args[2];
      const role = message.mentions.roles.first();
      if (!messageId || !emojiRaw || !role) {
        await message.reply('`' + P + 'rr add <messageId> <emoji> @role`');
        return true;
      }
      const r = addMapping(message.guild.id, messageId, emojiRaw, role.id);
      if (!r.ok) {
        await message.reply({ embeds: [E('RR', 'Failed to bind.', brand.red)] });
        return true;
      }
      // try react on target message
      try {
        const target = await message.channel.messages.fetch(messageId).catch(() => null)
          || await message.guild.channels.cache
            .filter((c) => c.isTextBased?.())
            .reduce(async (acc, ch) => {
              const a = await acc;
              if (a) return a;
              return ch.messages.fetch(messageId).catch(() => null);
            }, Promise.resolve(null));
        if (target) await target.react(emojiRaw).catch(() => {});
      } catch (_) {}
      await message.reply({
        embeds: [E('Reaction role', '**' + emojiRaw + '** → **' + role.name + '**\non `' + messageId + '`', brand.green)]
      });
      return true;
    }

    if (sub === 'remove') {
      const messageId = args[1];
      const emojiRaw = args[2];
      if (!messageId || !emojiRaw) {
        await message.reply('`' + P + 'rr remove <messageId> <emoji>`');
        return true;
      }
      removeMapping(message.guild.id, messageId, emojiRaw);
      await message.reply({ embeds: [E('Reaction role', 'Removed **' + emojiRaw + '** from `' + messageId + '`', brand.green)] });
      return true;
    }

    if (sub === 'list') {
      const messageId = args[1];
      if (!messageId) {
        await message.reply('`' + P + 'rr list <messageId>`');
        return true;
      }
      const list = listForMessage(message.guild.id, messageId);
      if (!list.length) {
        await message.reply({ embeds: [E('Reaction roles', 'None on that message.')] });
        return true;
      }
      const lines = list.map((r) => {
        const role = message.guild.roles.cache.get(r.roleId);
        return (r.emoji.length > 12 ? '<:e:' + r.emoji + '>' : r.emoji) + ' → **' + (role ? role.name : r.roleId) + '**';
      });
      await message.reply({ embeds: [E('Reaction roles', lines.join('\n'))] });
      return true;
    }

    await message.reply('`' + P + 'rr help`');
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
    const ownerIds = [ROLE.OWNER, ROLE.CO_OWNER, ROLE.FOUNDER].filter(Boolean);
    const isOwner =
      message.member.permissions.has(PermissionFlagsBits.Administrator) ||
      ownerIds.some((id) => message.member.roles.cache.has(id)) ||
      message.author.id === env.PROTECTED_USER_ID ||
      (env.PROTECTED_USER_IDS || []).includes(message.author.id);
    if (!isOwner) {
      await message.reply({ embeds: [E('Denied', 'Owner / Co-Owner / Founder only.', brand.red)] });
      return true;
    }
    const url = (env.DASHBOARD_URL || '').replace(/\/$/, '') || 'Set DASHBOARD_URL in env';
    const emb = E(
      'ᴅᴀꜱʜᴍᴏᴅ · Admin panel',
      '**Dashboard**\n' + url + '\n\n**Admin password**\n||' + env.ADMIN_PASSWORD + '||\n\n' +
        'Sign in to manage protection, giveaways, sync, AI, and stats.\n\n*Coded by DashWho · Enhanced by DakshBro*'
    );
    const targetUser = message.mentions.users.first();
    if (targetUser) {
      try {
        await targetUser.send({ embeds: [emb] });
        await message.reply({ embeds: [E('Dashboard', 'Sent to **' + targetUser.username + '** DM', brand.green)] });
      } catch (_) {
        await message.reply({ embeds: [E('Dashboard', 'Could not DM that user (DMs closed).', brand.red)] });
      }
      return true;
    }
    const ch = message.mentions.channels.first() || message.channel;
    await ch.send({ embeds: [emb] });
    await message.reply({ embeds: [E('Dashboard', 'Posted in ' + String(ch), brand.green)] });
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

  if (cmd === 'respect') {
    if (!needStaff()) return true;
    const user = message.mentions.users.first();
    if (!user) return message.reply('`' + P + 'respect @user` + attach sticker/gif or paste gif URL');
    if (!data.respect) data.respect = {};
    let entry = null;
    if (message.stickers?.size) {
      const st = message.stickers.first();
      entry = { type: 'sticker', id: st.id, url: st.url || null };
    } else if (message.attachments.size) {
      const a = message.attachments.first();
      entry = { type: 'gif', url: a.url };
    } else {
      const url = args.find((a) => /^https?:\/\//i.test(a));
      if (url) entry = { type: 'gif', url };
    }
    if (!entry) return message.reply('Attach a sticker/gif or paste a gif URL.');
    data.respect[user.id] = entry;
    dataStore.save();
    await message.reply({ embeds: [E('Respect', `When someone pings **${user.username}**, the bot sends that media.`, brand.green)] });
    return true;
  }

  if (cmd === 'game' || cmd === 'tictactoe' || cmd === 'ttt') {
    const user = message.mentions.users.first();
    if (!user || user.bot || user.id === message.author.id) {
      return message.reply('`' + P + 'game @user` — Tic Tac Toe challenge');
    }
    const ttt = require('../systems/tictactoe');
    await ttt.startGame(message.channel, message.author, user);
    return true;
  }

  return false;
}

module.exports = { handleCommand };

