/**
 * Server backup / restore (anti-raid)
 *
 * -backup <name>              Save cats, channels, roles, members, messages
 * -backup list | load | delete
 * -backuplogs #channel        Auto-post backup JSON here after save
 *
 * Discord cannot force-add members. Load unbans + reapplies roles on rejoin.
 */
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder
} = require('discord.js');
const brand = require('../config/brand');
const { isStaff } = require('../utils/staff');
const dataStore = require('../utils/data');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
const MSG_LIMIT = Math.min(50, Math.max(30, parseInt(process.env.BACKUP_MSG_LIMIT || '50', 10) || 50));
const MAX_NAME_LEN = 32;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function safeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, MAX_NAME_LEN);
}

function backupPath(name) {
  return path.join(BACKUP_DIR, `${safeName(name)}.json`);
}

function getBackupLogsChannelId() {
  const d = dataStore.get();
  return d.backupLogsChannelId || process.env.BACKUP_LOGS_CHANNEL || null;
}

function setBackupLogsChannelId(id) {
  const d = dataStore.get();
  d.backupLogsChannelId = id;
  dataStore.save();
}

function getPendingMembers() {
  const d = dataStore.get();
  if (!d.backupPendingMembers) d.backupPendingMembers = {};
  return d.backupPendingMembers;
}

function listBackups() {
  ensureDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
        return {
          name: j.name || f.replace(/\.json$/, ''),
          at: j.createdAt,
          channels: (j.channels || []).length,
          categories: (j.categories || []).length,
          roles: (j.roles || []).length,
          members: (j.members || []).length
        };
      } catch {
        return { name: f.replace(/\.json$/, ''), at: null, channels: 0, categories: 0, roles: 0, members: 0 };
      }
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

async function fetchRecentMessages(channel, limit) {
  if (!channel?.isTextBased?.()) return [];
  try {
    const col = await channel.messages.fetch({ limit: Math.min(limit, 100) });
    return [...col.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => ({
        authorTag: m.author?.tag || 'unknown',
        authorId: m.author?.id,
        content: (m.content || '').slice(0, 1900),
        attachments: [...(m.attachments?.values?.() || [])].map((a) => ({ name: a.name, url: a.url })),
        createdAt: m.createdAt?.toISOString?.() || null
      }));
  } catch {
    return [];
  }
}

async function createBackup(guild, name) {
  ensureDir();
  const key = safeName(name);
  if (!key) throw new Error('Invalid backup name');

  const categories = [];
  const channels = [];
  const sorted = [...guild.channels.cache.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const ch of sorted) {
    if (ch.type === ChannelType.GuildCategory) {
      categories.push({ id: ch.id, name: ch.name, position: ch.position ?? 0 });
      continue;
    }
    if (
      ch.type === ChannelType.PublicThread ||
      ch.type === ChannelType.PrivateThread ||
      ch.type === ChannelType.AnnouncementThread
    ) continue;

    const base = {
      id: ch.id,
      name: ch.name,
      type: ch.type,
      parentId: ch.parentId || null,
      parentName: ch.parent?.name || null,
      topic: ch.topic || null,
      nsfw: !!ch.nsfw,
      rateLimitPerUser: ch.rateLimitPerUser || 0,
      position: ch.position ?? 0,
      isAnnouncement: ch.type === ChannelType.GuildAnnouncement || ch.type === 5,
      messages: []
    };
    if (ch.isTextBased?.()) base.messages = await fetchRecentMessages(ch, MSG_LIMIT);
    channels.push(base);
  }

  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(),
      position: r.position
    }));

  let members = [];
  try {
    await guild.members.fetch();
  } catch (_) {}
  members = [...guild.members.cache.values()]
    .filter((m) => !m.user.bot)
    .map((m) => ({
      id: m.id,
      tag: m.user.tag,
      roleNames: m.roles.cache.filter((r) => r.id !== guild.id && !r.managed).map((r) => r.name)
    }));

  const data = {
    name: key,
    guildId: guild.id,
    guildName: guild.name,
    createdAt: new Date().toISOString(),
    msgLimit: MSG_LIMIT,
    categories,
    channels,
    roles,
    members
  };
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(backupPath(key), json);
  return { data, json };
}

function loadBackupFile(name) {
  const p = backupPath(name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function restoreBackup(guild, name, progress) {
  const data = loadBackupFile(name);
  if (!data) throw new Error('Backup not found: ' + name);
  const log = async (t) => { if (progress) await progress(t).catch(() => {}); };

  await log(`👑 Restoring **${(data.roles || []).length}** roles…`);
  const roleByName = new Map();
  for (const r of data.roles || []) {
    let existing = guild.roles.cache.find((x) => x.name === r.name && !x.managed);
    if (!existing) {
      try {
        existing = await guild.roles.create({
          name: r.name,
          hoist: !!r.hoist,
          mentionable: !!r.mentionable,
          permissions: BigInt(r.permissions || 0),
          reason: `Backup restore: ${data.name}`
        });
      } catch (e) {
        await log(`⚠️ Role \`${r.name}\`: ${e.message}`);
        continue;
      }
    }
    roleByName.set(r.name, existing);
  }

  const catMap = new Map();
  const cats = [...(data.categories || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  await log(`📁 Restoring **${cats.length}** categories…`);
  for (const c of cats) {
    let existing = guild.channels.cache.find((ch) => ch.type === ChannelType.GuildCategory && ch.name === c.name);
    if (!existing) {
      existing = await guild.channels.create({
        name: c.name,
        type: ChannelType.GuildCategory,
        reason: `Backup restore: ${data.name}`
      });
    }
    catMap.set(c.id, existing);
  }

  const chans = [...(data.channels || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  await log(`📢 Restoring **${chans.length}** channels…`);
  const channelMap = new Map();

  for (const c of chans) {
    let type = c.isAnnouncement ? ChannelType.GuildAnnouncement : c.type;
    if (typeof type !== 'number') type = ChannelType.GuildText;
    if (type === ChannelType.GuildCategory) continue;

    let parent = null;
    if (c.parentId && catMap.has(c.parentId)) parent = catMap.get(c.parentId);
    else if (c.parentName) {
      parent = guild.channels.cache.find((ch) => ch.type === ChannelType.GuildCategory && ch.name === c.parentName) || null;
    }

    let existing = guild.channels.cache.find((ch) => ch.name === c.name && ch.type === type);
    if (!existing) {
      try {
        existing = await guild.channels.create({
          name: c.name,
          type,
          parent: parent || undefined,
          topic: c.topic || undefined,
          nsfw: !!c.nsfw,
          rateLimitPerUser: c.rateLimitPerUser || 0,
          reason: `Backup restore: ${data.name}`
        });
      } catch (e) {
        await log(`⚠️ Channel \`#${c.name}\`: ${e.message}`);
        continue;
      }
    }
    channelMap.set(c.id, existing);
  }

  await log(`💬 Restoring messages (up to ${data.msgLimit || MSG_LIMIT}/channel)…`);
  let msgRestored = 0;
  for (const c of chans) {
    const target = channelMap.get(c.id);
    if (!target?.isTextBased?.()) continue;
    const msgs = c.messages || [];
    if (!msgs.length) continue;
    try {
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.color || 0x9b59b6)
            .setTitle('📦 Backup restore')
            .setDescription(`History for **#${c.name}** — ${msgs.length} messages.`)
            .setFooter({ text: `Backup: ${data.name}` })
        ]
      }).catch(() => {});

      for (const m of msgs) {
        const bits = [];
        if (m.authorTag) bits.push(`**${m.authorTag}:**`);
        if (m.content) bits.push(m.content);
        let content = bits.join(' ').slice(0, 2000);
        if (!content && m.attachments?.length) content = m.attachments.map((a) => a.url).join('\n').slice(0, 2000);
        if (!content) continue;
        try {
          await target.send({ content });
          msgRestored++;
          if (msgRestored % 5 === 0) await new Promise((r) => setTimeout(r, 1200));
        } catch (_) {}
      }

      if (c.isAnnouncement && msgs.length) {
        const last = msgs[msgs.length - 1];
        await target.send({
          embeds: [
            new EmbedBuilder()
              .setColor(brand.gold || 0xf1c40f)
              .setTitle('📌 Latest from backup')
              .setDescription(
                [last.authorTag ? `**${last.authorTag}**` : '', last.content || '_no text_', last.createdAt ? `\n_${last.createdAt}_` : '']
                  .filter(Boolean).join('\n').slice(0, 4000)
              )
          ]
        }).catch(() => {});
      }
    } catch (e) {
      await log(`⚠️ Messages #${c.name}: ${e.message}`);
    }
  }

  await log(`🔓 Unbanning / tracking **${(data.members || []).length}** members…`);
  let unbanned = 0;
  const pending = getPendingMembers();
  for (const mem of data.members || []) {
    const roleIds = (mem.roleNames || [])
      .map((n) => roleByName.get(n)?.id || guild.roles.cache.find((r) => r.name === n)?.id)
      .filter(Boolean);
    pending[mem.id] = { roleIds, tag: mem.tag, backup: data.name, at: new Date().toISOString() };
    try {
      await guild.members.unban(mem.id, `Backup restore: ${data.name}`);
      unbanned++;
    } catch (_) {}
  }
  dataStore.save();

  let inviteUrl = null;
  try {
    const ch =
      guild.systemChannel ||
      guild.channels.cache.find(
        (c) => c.isTextBased?.() && c.permissionsFor?.(guild.members.me)?.has?.(PermissionFlagsBits.CreateInstantInvite)
      );
    if (ch) {
      const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, reason: `Backup restore: ${data.name}` });
      inviteUrl = inv.url;
    }
  } catch (_) {}

  return {
    name: data.name,
    categories: cats.length,
    channels: channelMap.size,
    roles: roleByName.size,
    messages: msgRestored,
    unbanned,
    membersTracked: (data.members || []).length,
    inviteUrl
  };
}

async function applyPendingMemberRoles(member) {
  try {
    const pending = getPendingMembers();
    const entry = pending[member.id];
    if (!entry || !entry.roleIds?.length) return false;
    const roles = entry.roleIds.filter((id) => member.guild.roles.cache.has(id));
    if (roles.length) await member.roles.add(roles, 'Backup restore: roles from snapshot').catch(() => {});
    delete pending[member.id];
    dataStore.save();
    return true;
  } catch {
    return false;
  }
}

async function postBackupFile(client, name, json) {
  const chId = getBackupLogsChannelId();
  if (!chId) return false;
  try {
    const ch = await client.channels.fetch(chId).catch(() => null);
    if (!ch?.isTextBased?.()) return false;
    const file = new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `backup-${safeName(name)}.json` });
    await ch.send({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.green || 0x2ecc71)
          .setTitle('📦 Backup file saved')
          .setDescription(`**\`${safeName(name)}\`**\nLoad: \`${brand.PREFIX || '-'}backup load ${safeName(name)}\``)
          .setTimestamp()
      ],
      files: [file]
    });
    return true;
  } catch {
    return false;
  }
}

function parseBackupCommand(message) {
  const prefix = brand.PREFIX || '-';
  if (!message.content.startsWith(prefix)) return null;
  const parts = message.content.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  const cmd = (parts[0] || '').toLowerCase();

  if (cmd === 'backuplogs' || cmd === 'backuplog') {
    return { action: 'setlogs', channel: message.mentions.channels.first() || null, raw: parts[1] };
  }
  if (cmd !== 'backup' && cmd !== 'bak') return null;

  const sub = (parts[1] || '').toLowerCase();
  if (['list', 'ls'].includes(sub)) return { action: 'list' };
  if (['load', 'restore'].includes(sub)) return { action: 'load', name: parts.slice(2).join(' ').trim() };
  if (['delete', 'remove', 'rm'].includes(sub)) return { action: 'delete', name: parts.slice(2).join(' ').trim() };
  const name = parts.slice(1).join(' ').trim();
  if (!name) return { action: 'help' };
  return { action: 'save', name };
}

async function handleBackupMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const parsed = parseBackupCommand(message);
  if (!parsed) return false;

  if (!isStaff(message.member)) {
    await message.reply({ content: 'Staff only.' }).catch(() => {});
    return true;
  }

  const prefix = brand.PREFIX || '-';
  const botClient = client || message.client;

  if (parsed.action === 'setlogs') {
    let ch = parsed.channel;
    if (!ch && parsed.raw) {
      const id = String(parsed.raw).replace(/[<#>]/g, '');
      ch = message.guild.channels.cache.get(id);
    }
    if (!ch?.isTextBased?.()) {
      await message.reply({ content: `Usage: \`${prefix}backuplogs #channel\`` }).catch(() => {});
      return true;
    }
    setBackupLogsChannelId(ch.id);
    await message.reply({ content: `📦 Backup JSON files will be posted in ${ch}.` }).catch(() => {});
    return true;
  }

  if (parsed.action === 'help') {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.color || 0x9b59b6)
          .setTitle('📦 Server backup')
          .setDescription([
            `\`${prefix}backup <name>\` — save channels, roles, members, messages`,
            `\`${prefix}backup list\``,
            `\`${prefix}backup load <name>\` — restore + unban + roles on rejoin`,
            `\`${prefix}backup delete <name>\``,
            `\`${prefix}backuplogs #channel\` — auto-send backup file here`,
            '',
            `Messages: **${MSG_LIMIT}** per channel (30–50).`,
            '',
            '⚠️ Discord **cannot force-add** members. Load **unbans** them; roles apply when they **rejoin**.'
          ].join('\n'))
          .setFooter({ text: 'DashMod · anti-raid' })
      ]
    }).catch(() => {});
    return true;
  }

  if (parsed.action === 'list') {
    const list = listBackups();
    const desc = list.length
      ? list.map((b, i) =>
          `**${i + 1}.** \`${b.name}\` — ${b.categories} cats · ${b.channels} ch · ${b.roles} roles · ${b.members} members` +
          (b.at ? `\n└ ${b.at}` : '')
        ).join('\n')
      : '_No backups yet._';
    await message.reply({
      embeds: [new EmbedBuilder().setColor(brand.color || 0x9b59b6).setTitle('📦 Backups').setDescription(desc.slice(0, 4000))]
    }).catch(() => {});
    return true;
  }

  if (parsed.action === 'delete') {
    if (!parsed.name) {
      await message.reply({ content: `Usage: \`${prefix}backup delete <name>\`` }).catch(() => {});
      return true;
    }
    const p = backupPath(parsed.name);
    if (!fs.existsSync(p)) {
      await message.reply({ content: `Not found: \`${safeName(parsed.name)}\`` }).catch(() => {});
      return true;
    }
    fs.unlinkSync(p);
    await message.reply({ content: `🗑️ Deleted \`${safeName(parsed.name)}\`.` }).catch(() => {});
    return true;
  }

  if (parsed.action === 'save') {
    const status = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.blurple || 0x5865f2)
          .setTitle('⏳ Creating backup…')
          .setDescription(`Name: \`${safeName(parsed.name)}\`\nChannels · roles · members · **${MSG_LIMIT}** msgs/channel`)
      ]
    }).catch(() => null);

    try {
      const { data, json } = await createBackup(message.guild, parsed.name);
      const file = new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `backup-${data.name}.json` });
      const embed = new EmbedBuilder()
        .setColor(brand.green || 0x2ecc71)
        .setTitle('✅ Backup saved')
        .setDescription([
          `**Name:** \`${data.name}\``,
          `**Categories:** ${data.categories.length}`,
          `**Channels:** ${data.channels.length}`,
          `**Roles:** ${data.roles.length}`,
          `**Members:** ${data.members.length}`,
          `**Msgs/channel:** up to ${MSG_LIMIT}`,
          '',
          `Load: \`${prefix}backup load ${data.name}\``
        ].join('\n'))
        .setFooter({ text: 'DashMod · anti-raid backup' })
        .setTimestamp();

      if (status) await status.edit({ embeds: [embed], files: [file] }).catch(() => {});
      else await message.channel.send({ embeds: [embed], files: [file] }).catch(() => {});
      await postBackupFile(botClient, data.name, json);
    } catch (e) {
      const err = new EmbedBuilder().setColor(brand.red || 0xe74c3c).setTitle('Backup failed').setDescription(e.message || String(e));
      if (status) await status.edit({ embeds: [err] }).catch(() => {});
      else await message.reply({ embeds: [err] }).catch(() => {});
    }
    return true;
  }

  if (parsed.action === 'load') {
    if (!parsed.name) {
      await message.reply({ content: `Usage: \`${prefix}backup load <name>\`` }).catch(() => {});
      return true;
    }
    const me = message.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply({ content: 'Need **Manage Channels**.' }).catch(() => {});
      return true;
    }

    const status = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.blurple || 0x5865f2)
          .setTitle('⏳ Restoring backup…')
          .setDescription(`Loading \`${safeName(parsed.name)}\`…`)
      ]
    }).catch(() => null);

    const progress = async (text) => {
      if (!status) return;
      await status.edit({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.blurple || 0x5865f2)
            .setTitle('⏳ Restoring…')
            .setDescription(String(text).slice(0, 4000))
        ]
      });
    };

    try {
      const result = await restoreBackup(message.guild, parsed.name, progress);
      const embed = new EmbedBuilder()
        .setColor(brand.green || 0x2ecc71)
        .setTitle('✅ Restore complete')
        .setDescription([
          `**Backup:** \`${result.name}\``,
          `**Categories:** ${result.categories}`,
          `**Channels:** ${result.channels}`,
          `**Roles:** ${result.roles}`,
          `**Messages restored:** ${result.messages}`,
          `**Unbanned:** ${result.unbanned}`,
          `**Members tracked:** ${result.membersTracked}`,
          result.inviteUrl ? `\n**Rejoin invite:** ${result.inviteUrl}` : '',
          '',
          'Members must **rejoin**. Roles apply automatically on join.'
        ].filter(Boolean).join('\n'))
        .setFooter({ text: 'DashMod · anti-raid' })
        .setTimestamp();
      if (status) await status.edit({ embeds: [embed] }).catch(() => {});
      else await message.channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
      const err = new EmbedBuilder().setColor(brand.red || 0xe74c3c).setTitle('Restore failed').setDescription(e.message || String(e));
      if (status) await status.edit({ embeds: [err] }).catch(() => {});
      else await message.reply({ embeds: [err] }).catch(() => {});
    }
    return true;
  }

  return true;
}

module.exports = {
  handleBackupMessage,
  applyPendingMemberRoles,
  createBackup,
  restoreBackup,
  listBackups
};
