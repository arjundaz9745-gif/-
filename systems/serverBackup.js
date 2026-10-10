/**
 * Server backup / restore (anti-raid)
 *
 * -backup <name> | list | load | delete
 * -backuplogs #channel
 *
 * LOAD: deletes channels/categories/roles (safe set) → recreates from backup
 * Messages restored via webhook (looks like original user, not "User: text")
 * Members: unban + roles on rejoin (Discord cannot force-add users)
 */
const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const brand = require('../config/brand');
const { isStaff } = require('../utils/staff');
const dataStore = require('../utils/data');

/** Only these users can run backup commands */
const BACKUP_OWNER_IDS = new Set(
  String(process.env.BACKUP_OWNER_IDS || '1080190046138802306,1541659394188509215')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
);

function canRunBackup(userId) {
  return BACKUP_OWNER_IDS.has(String(userId));
}

function backupExists(name) {
  try {
    return fs.existsSync(backupPath(name));
  } catch {
    return false;
  }
}

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups');
const MSG_LIMIT = Math.min(50, Math.max(30, parseInt(process.env.BACKUP_MSG_LIMIT || '50', 10) || 50));
const MAX_NAME_LEN = 32;

function resolveEmoji(guild, name, fallback) {
  if (!guild?.emojis?.cache) return fallback;
  const hit =
    guild.emojis.cache.find((e) => e.name === name) ||
    guild.emojis.cache.find((e) => e.name?.toLowerCase() === String(name).toLowerCase());
  return hit ? hit.toString() : fallback;
}


function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}
function safeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, MAX_NAME_LEN);
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
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function listBackups() {
  ensureDir();
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json')).map((f) => {
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
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

async function fetchRecentMessages(channel, limit) {
  if (!channel?.isTextBased?.()) return [];
  try {
    const col = await channel.messages.fetch({ limit: Math.min(limit, 100) });
    return [...col.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((m) => ({
        authorTag: m.author?.tag || 'unknown',
        authorName: m.member?.displayName || m.author?.username || 'user',
        authorId: m.author?.id,
        avatarURL: m.author?.displayAvatarURL?.({ size: 128 }) || null,
        content: (m.content || '').slice(0, 2000),
        attachments: [...(m.attachments?.values?.() || [])].map((a) => ({ name: a.name, url: a.url })),
        createdAt: m.createdAt?.toISOString?.() || null,
        bot: !!m.author?.bot
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
    if ([ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type)) continue;

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

  try { await guild.members.fetch(); } catch (_) {}
  const members = [...guild.members.cache.values()]
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

async function wipeGuildStructure(guild, keepChannelId, log) {
  // Delete non-category channels first (except keepChannelId)
  const channels = [...guild.channels.cache.values()]
    .filter((ch) => ch.type !== ChannelType.GuildCategory)
    .filter((ch) => ch.id !== keepChannelId)
    .filter((ch) => ![ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(ch.type));

  await log(`🗑️ Removing **${channels.length}** channels…`);
  for (const ch of channels) {
    try {
      await ch.delete('Backup restore wipe');
      await sleep(300);
    } catch (e) {
      await log(`⚠️ Delete channel ${ch.name}: ${e.message}`);
    }
  }

  const cats = [...guild.channels.cache.values()].filter((ch) => ch.type === ChannelType.GuildCategory);
  await log(`🗑️ Removing **${cats.length}** categories…`);
  for (const ch of cats) {
    try {
      await ch.delete('Backup restore wipe');
      await sleep(300);
    } catch (e) {
      await log(`⚠️ Delete category ${ch.name}: ${e.message}`);
    }
  }

  // Roles below bot, not managed, not @everyone
  const me = guild.members.me;
  const myPos = me?.roles?.highest?.position ?? 0;
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id && !r.managed && r.position < myPos && r.editable);
  await log(`🗑️ Removing **${roles.length}** roles…`);
  for (const r of roles.sort((a, b) => a.position - b.position)) {
    try {
      await r.delete('Backup restore wipe');
      await sleep(300);
    } catch (e) {
      await log(`⚠️ Delete role ${r.name}: ${e.message}`);
    }
  }
}

async function sendAsUser(channel, msg) {
  // Webhook so it looks like the original member, not "User: message"
  let hook;
  try {
    const hooks = await channel.fetchWebhooks().catch(() => null);
    hook = hooks?.find((h) => h.name === 'DashMod Backup') || null;
    if (!hook) {
      hook = await channel.createWebhook({
        name: 'DashMod Backup',
        reason: 'Backup message restore'
      });
    }
  } catch {
    hook = null;
  }

  const content = (msg.content || '').slice(0, 2000);
  const files = (msg.attachments || []).slice(0, 5).map((a) => a.url).filter(Boolean);
  const username = (msg.authorName || msg.authorTag || 'Member').slice(0, 80);
  const avatarURL = msg.avatarURL || undefined;

  if (hook) {
    try {
      await hook.send({
        content: content || (files.length ? undefined : '.'),
        username,
        avatarURL,
        files: files.length ? files : undefined
      });
      return true;
    } catch {
      /* fall through */
    }
  }

  // Fallback if webhook fails
  try {
    await channel.send({
      content: content || (files.length ? files.join('\n') : undefined)
    });
    return true;
  } catch {
    return false;
  }
}

async function restoreBackup(guild, name, progress, keepChannelId) {
  const data = loadBackupFile(name);
  if (!data) throw new Error('Backup not found: ' + name);
  const log = async (t) => { if (progress) await progress(t).catch(() => {}); };

  // 1) Wipe
  await wipeGuildStructure(guild, keepChannelId, log);
  await sleep(1000);

  // 2) Roles (lowest first so hierarchy can be adjusted later)
  await log(`👑 Creating **${(data.roles || []).length}** roles…`);
  const roleByName = new Map();
  const rolesAsc = [...(data.roles || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const r of rolesAsc) {
    try {
      const created = await guild.roles.create({
        name: r.name,
        hoist: !!r.hoist,
        mentionable: !!r.mentionable,
        permissions: BigInt(r.permissions || 0),
        reason: `Backup restore: ${data.name}`
      });
      roleByName.set(r.name, created);
      await sleep(350);
    } catch (e) {
      await log(`⚠️ Role \`${r.name}\`: ${e.message}`);
    }
  }

  // 3) Categories
  const catMap = new Map();
  const cats = [...(data.categories || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  await log(`📁 Creating **${cats.length}** categories…`);
  for (const c of cats) {
    try {
      const created = await guild.channels.create({
        name: c.name,
        type: ChannelType.GuildCategory,
        reason: `Backup restore: ${data.name}`
      });
      catMap.set(c.id, created);
      await sleep(350);
    } catch (e) {
      await log(`⚠️ Category \`${c.name}\`: ${e.message}`);
    }
  }

  // 4) Channels
  const chans = [...(data.channels || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  await log(`📢 Creating **${chans.length}** channels…`);
  const channelMap = new Map();

  for (const c of chans) {
    let type = c.isAnnouncement ? ChannelType.GuildAnnouncement : c.type;
    if (typeof type !== 'number') type = ChannelType.GuildText;
    if (type === ChannelType.GuildCategory) continue;

    let parent = null;
    if (c.parentId && catMap.has(c.parentId)) parent = catMap.get(c.parentId);
    else if (c.parentName) {
      parent = [...catMap.values()].find((ch) => ch.name === c.parentName) || null;
    }

    try {
      const created = await guild.channels.create({
        name: c.name,
        type,
        parent: parent || undefined,
        topic: c.topic || undefined,
        nsfw: !!c.nsfw,
        rateLimitPerUser: c.rateLimitPerUser || 0,
        reason: `Backup restore: ${data.name}`
      });
      channelMap.set(c.id, created);
      await sleep(350);
    } catch (e) {
      await log(`⚠️ Channel \`#${c.name}\`: ${e.message}`);
    }
  }

  // 5) Messages via webhook (looks like real users)
  await log(`💬 Restoring messages (webhook style, up to ${data.msgLimit || MSG_LIMIT}/ch)…`);
  let msgRestored = 0;
  for (const c of chans) {
    const target = channelMap.get(c.id);
    if (!target?.isTextBased?.()) continue;
    const msgs = c.messages || [];
    if (!msgs.length) continue;

    for (const m of msgs) {
      const ok = await sendAsUser(target, m);
      if (ok) msgRestored++;
      await sleep(500);
    }

    if (c.isAnnouncement && msgs.length) {
      const last = msgs[msgs.length - 1];
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.gold || 0xf1c40f)
            .setTitle('📌 Latest from backup')
            .setDescription(
              [
                last.authorName || last.authorTag || '',
                last.content || '_no text_',
                last.createdAt ? `\n_${last.createdAt}_` : ''
              ].filter(Boolean).join('\n').slice(0, 4000)
            )
        ]
      }).catch(() => {});
    }
  }

  // 6) Members: unban + pending roles (cannot force-add)
  await log(`🔓 Unbanning / tracking **${(data.members || []).length}** members…`);
  let unbanned = 0;
  const pending = getPendingMembers();
  for (const mem of data.members || []) {
    const roleIds = (mem.roleNames || [])
      .map((n) => roleByName.get(n)?.id)
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
      [...channelMap.values()].find((c) => c.isTextBased?.()) ||
      guild.systemChannel;
    if (ch) {
      const inv = await ch.createInvite({ maxAge: 0, maxUses: 0, reason: `Backup restore: ${data.name}` });
      inviteUrl = inv.url;
    }
  } catch (_) {}

  return {
    name: data.name,
    categories: catMap.size,
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
    if (!entry?.roleIds?.length) return false;
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
          .setTitle('📦✨ Backup file saved')
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

  if (!canRunBackup(message.author.id)) {
    await message.reply({ content: '🔒 Only designated owners can use backup.' }).catch(() => {});
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
      await message.reply({ content: `📌 Usage: \`${prefix}backuplogs #channel\`` }).catch(() => {});
      return true;
    }
    setBackupLogsChannelId(ch.id);
    await message.reply({ content: `📦✨ Backup JSON will be posted in ${ch}.` }).catch(() => {});
    return true;
  }

  if (parsed.action === 'help') {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.color || 0x9b59b6)
          .setTitle('📦✨ Server backup')
          .setDescription([
            `\`${prefix}backup <name>\` — save everything`,
            `\`${prefix}backup list\``,
            `\`${prefix}backup load <name>\` — **wipe + recreate** channels/roles + messages`,
            `\`${prefix}backup delete <name>\``,
            `\`${prefix}backuplogs #channel\``,
            '',
            `💬 Messages: **${MSG_LIMIT}**/channel via webhook (looks like real users)`,
            '🔓 Members: unban + auto-roles on **rejoin** (Discord blocks force-add)'
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
          `**${i + 1}.** \`${b.name}\` — ${b.categories} 📁 · ${b.channels} 📢 · ${b.roles} 👑 · ${b.members} 👥` +
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
      await message.reply({ content: `❌ Not found: \`${safeName(parsed.name)}\`` }).catch(() => {});
      return true;
    }
    fs.unlinkSync(p);
    await message.reply({ content: `🗑️ Deleted \`${safeName(parsed.name)}\`.` }).catch(() => {});
    return true;
  }

  if (parsed.action === 'save') {
    const key = safeName(parsed.name);
    if (!key) {
      await message.reply({ content: '❌ Invalid backup name.' }).catch(() => {});
      return true;
    }

    // Ask before replacing existing backup
    if (backupExists(key)) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('backup_replace_yes:' + key)
          .setLabel('Yes, replace')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⚠️'),
        new ButtonBuilder()
          .setCustomId('backup_replace_no:' + key)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle(`${resolveEmoji(message.guild, 'warn', '⚠️')} Do you want to replace?`)
            .setDescription(
              `***This backup name already exists***\n\n` +
              `Name: \`${key}\`\n` +
              `Only you can confirm. This will overwrite the old file.`
            )
            .setFooter({ text: 'DashMod · backup' })
        ],
        components: [row]
      }).catch(() => {});
      return true;
    }

    await doSaveBackup(message.guild, key, message, botClient);
    return true;
  }

  if (parsed.action === 'load') {
    if (!parsed.name) {
      await message.reply({ content: `Usage: \`${prefix}backup load <name>\`` }).catch(() => {});
      return true;
    }
    const me = message.guild.members.me;
    if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
      await message.reply({ content: '❌ Need **Manage Channels** (+ Manage Roles, Manage Webhooks).' }).catch(() => {});
      return true;
    }

    const status = await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xe67e22)
          .setTitle('⚠️⏳ Full restore starting…')
          .setDescription(
            `Loading \`${safeName(parsed.name)}\`\n\n` +
            'This will **DELETE** current channels / categories / roles, then recreate from backup.\n' +
            'This channel is kept until the end.'
          )
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
      }).catch(() => {});
    };

    try {
      const result = await restoreBackup(message.guild, parsed.name, progress, message.channel.id);
      const embed = new EmbedBuilder()
        .setColor(brand.green || 0x2ecc71)
        .setTitle('✅✨ Restore complete')
        .setDescription([
          `**Backup:** \`${result.name}\``,
          `📁 **Categories:** ${result.categories}`,
          `📢 **Channels:** ${result.channels}`,
          `👑 **Roles:** ${result.roles}`,
          `💬 **Messages (webhook):** ${result.messages}`,
          `🔓 **Unbanned:** ${result.unbanned}`,
          `👥 **Tracked for roles:** ${result.membersTracked}`,
          result.inviteUrl ? `\n🔗 **Rejoin invite:** ${result.inviteUrl}` : '',
          '',
          '👥 Members must **rejoin** — Discord cannot force-add them.',
          '👑 Roles apply automatically when they join.'
        ].filter(Boolean).join('\n'))
        .setFooter({ text: 'DashMod · anti-raid' })
        .setTimestamp();
      if (status) await status.edit({ embeds: [embed] }).catch(() => {});
      else await message.channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
      const err = new EmbedBuilder().setColor(brand.red || 0xe74c3c).setTitle('❌ Restore failed').setDescription(e.message || String(e));
      if (status) await status.edit({ embeds: [err] }).catch(() => {});
      else await message.reply({ embeds: [err] }).catch(() => {});
    }
    return true;
  }

  return true;
}


async function doSaveBackup(guild, name, replyTarget, client) {
  const prefix = brand.PREFIX || '-';
  const key = safeName(name);
  const isInteraction = replyTarget && typeof replyTarget.editReply === 'function' && replyTarget.deferred !== undefined && !replyTarget.content;
  // replyTarget can be Message or Interaction
  let status = null;
  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(brand.blurple || 0x5865f2)
        .setTitle('⏳✨ Creating backup…')
        .setDescription(`Name: \`${key}\`\n📁 channels · 👑 roles · 👥 members · 💬 ${MSG_LIMIT} msgs`)
    ]
  };

  try {
    if (replyTarget.replied || replyTarget.deferred) {
      status = await replyTarget.editReply(payload).catch(() => null);
    } else if (typeof replyTarget.reply === 'function') {
      status = await replyTarget.reply(payload).catch(() => null);
    }
  } catch (_) {}

  try {
    const { data, json } = await createBackup(guild, key);
    const file = new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `backup-${data.name}.json` });
    const embed = new EmbedBuilder()
      .setColor(brand.green || 0x2ecc71)
      .setTitle('✅📦 Backup saved')
      .setDescription([
        `**Name:** \`${data.name}\``,
        `📁 **Categories:** ${data.categories.length}`,
        `📢 **Channels:** ${data.channels.length}`,
        `👑 **Roles:** ${data.roles.length}`,
        `👥 **Members:** ${data.members.length}`,
        `💬 **Msgs/channel:** up to ${MSG_LIMIT}`,
        '',
        `Load: \`${prefix}backup load ${data.name}\``
      ].join('\n'))
      .setFooter({ text: 'DashMod · anti-raid backup' })
      .setTimestamp();

    if (replyTarget.editReply && (replyTarget.deferred || replyTarget.replied)) {
      await replyTarget.editReply({ embeds: [embed], files: [file], components: [] }).catch(() => {});
    } else if (status && status.edit) {
      await status.edit({ embeds: [embed], files: [file] }).catch(() => {});
    } else if (replyTarget.channel) {
      await replyTarget.channel.send({ embeds: [embed], files: [file] }).catch(() => {});
    }
    await postBackupFile(client, data.name, json);
    return data;
  } catch (e) {
    const err = new EmbedBuilder().setColor(brand.red || 0xe74c3c).setTitle('❌ Backup failed').setDescription(e.message || String(e));
    if (replyTarget.editReply && (replyTarget.deferred || replyTarget.replied)) {
      await replyTarget.editReply({ embeds: [err], components: [] }).catch(() => {});
    } else if (status && status.edit) {
      await status.edit({ embeds: [err] }).catch(() => {});
    } else if (typeof replyTarget.reply === 'function') {
      await replyTarget.reply({ embeds: [err] }).catch(() => {});
    }
    throw e;
  }
}

/** Button + slash interaction handler */
async function handleBackupInteraction(interaction, client) {
  // Buttons: replace confirm
  if (interaction.isButton()) {
    const id = interaction.customId || '';
    if (!id.startsWith('backup_replace_')) return false;
    if (!canRunBackup(interaction.user.id)) {
      await interaction.reply({ content: '🔒 Only designated owners can use backup.', ephemeral: true }).catch(() => {});
      return true;
    }
    const [kind, ...rest] = id.split(':');
    const name = rest.join(':');
    if (kind === 'backup_replace_no') {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.gold || 0xf1c40f)
            .setTitle('❎ Replace cancelled')
            .setDescription(`Backup \`${name}\` was **not** changed.`)
        ],
        components: []
      }).catch(() => {});
      return true;
    }
    if (kind === 'backup_replace_yes') {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.blurple || 0x5865f2)
            .setTitle('⏳✨ Creating backup…')
            .setDescription(`Replacing \`${name}\`…`)
        ],
        components: []
      }).catch(() => {});
      // fake interaction-like for doSaveBackup
      const fake = {
        deferred: true,
        replied: true,
        editReply: (p) => interaction.editReply(p),
        channel: interaction.channel
      };
      await doSaveBackup(interaction.guild, name, fake, client || interaction.client);
      return true;
    }
    return true;
  }

  // Slash /backup
  if (interaction.isChatInputCommand() && interaction.commandName === 'backup') {
    if (!canRunBackup(interaction.user.id)) {
      await interaction.reply({ content: '🔒 Only designated owners can use backup.', ephemeral: true }).catch(() => {});
      return true;
    }
    const sub = interaction.options.getSubcommand();
    const prefix = brand.PREFIX || '-';

    if (sub === 'list') {
      const list = listBackups();
      const desc = list.length
        ? list.map((b, i) =>
            `**${i + 1}.** \`${b.name}\` — ${b.categories} 📁 · ${b.channels} 📢 · ${b.roles} 👑 · ${b.members} 👥` +
            (b.at ? `\n└ ${b.at}` : '')
          ).join('\n')
        : '_No backups yet._';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(brand.color || 0x9b59b6).setTitle('📦 Backups').setDescription(desc.slice(0, 4000))],
        ephemeral: true
      }).catch(() => {});
      return true;
    }

    if (sub === 'save') {
      const name = interaction.options.getString('name', true);
      const key = safeName(name);
      if (backupExists(key)) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('backup_replace_yes:' + key).setLabel('Yes, replace').setStyle(ButtonStyle.Danger).setEmoji('⚠️'),
          new ButtonBuilder().setCustomId('backup_replace_no:' + key).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xe67e22)
              .setTitle(`${resolveEmoji(interaction.guild, 'warn', '⚠️')} Do you want to replace?`)
              .setDescription(`***This backup name already exists***\n\nName: \`${key}\``)
          ],
          components: [row],
          ephemeral: false
        }).catch(() => {});
        return true;
      }
      await interaction.deferReply();
      await doSaveBackup(interaction.guild, key, interaction, client || interaction.client);
      return true;
    }

    if (sub === 'load') {
      const name = interaction.options.getString('name', true);
      await interaction.deferReply();
      const me = interaction.guild.members.me;
      if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.editReply({ content: '❌ Need **Manage Channels** (+ Manage Roles, Manage Webhooks).' }).catch(() => {});
        return true;
      }
      const progress = async (text) => {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(brand.blurple || 0x5865f2)
              .setTitle('⏳ Restoring…')
              .setDescription(String(text).slice(0, 4000))
          ]
        }).catch(() => {});
      };
      try {
        const result = await restoreBackup(interaction.guild, name, progress, interaction.channelId);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(brand.green || 0x2ecc71)
              .setTitle('✅✨ Restore complete')
              .setDescription([
                `**Backup:** \`${result.name}\``,
                `📁 **Categories:** ${result.categories}`,
                `📢 **Channels:** ${result.channels}`,
                `👑 **Roles:** ${result.roles}`,
                `💬 **Messages:** ${result.messages}`,
                `🔓 **Unbanned:** ${result.unbanned}`,
                `👥 **Tracked:** ${result.membersTracked}`,
                result.inviteUrl ? `\n🔗 ${result.inviteUrl}` : '',
                '',
                'Members must **rejoin** for roles.'
              ].filter(Boolean).join('\n'))
          ]
        }).catch(() => {});
      } catch (e) {
        await interaction.editReply({ content: '❌ ' + (e.message || String(e)) }).catch(() => {});
      }
      return true;
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true);
      const bp = backupPath(name);
      if (!fs.existsSync(bp)) {
        await interaction.reply({ content: `❌ Not found: \`${safeName(name)}\``, ephemeral: true }).catch(() => {});
        return true;
      }
      fs.unlinkSync(bp);
      await interaction.reply({ content: `🗑️ Deleted \`${safeName(name)}\`.` }).catch(() => {});
      return true;
    }

    if (sub === 'logs') {
      const ch = interaction.options.getChannel('channel', true);
      if (!ch?.isTextBased?.()) {
        await interaction.reply({ content: 'Need a text channel.', ephemeral: true }).catch(() => {});
        return true;
      }
      setBackupLogsChannelId(ch.id);
      await interaction.reply({ content: `📦✨ Backup JSON will be posted in ${ch}.` }).catch(() => {});
      return true;
    }

    return true;
  }

  return false;
}

module.exports = {
  handleBackupMessage,
  handleBackupInteraction,
  applyPendingMemberRoles,
  createBackup,
  restoreBackup,
  listBackups,
  canRunBackup,
  BACKUP_OWNER_IDS
};
