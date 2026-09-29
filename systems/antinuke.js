/**
 * Anti-nuke / structure protection
 * Trial Staff, Staff, Stocker, Admin cannot create/delete channels, categories, roles.
 * Violators get timed out; created structure is removed when possible.
 */
const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { ROLE } = require('../config/roles');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const env = require('../config/env');
const { logProtect, getProtection, trackWindow } = require('./protection');

/** Roles allowed to manage channels / roles / categories */
const TRUSTED_ROLE_IDS = [
  ROLE.FOUNDER,
  ROLE.OWNER,
  ROLE.CO_OWNER,
  ROLE.MANAGER,
  ROLE.HEAD_ADMIN
].filter(Boolean);

/** Staff ranks that are blocked from structure changes */
const RESTRICTED_ROLE_IDS = [
  ROLE.TRIAL_STAFF,
  ROLE.STOCKER,
  ROLE.STAFF_TEAM,
  ROLE.ADMIN,
  ROLE.DISCORD_DEV
].filter(Boolean);

const actionWindow = new Map(); // userId -> timestamps
const TIMEOUT_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

function isTrusted(member) {
  if (!member) return false;
  if (member.id === member.guild?.ownerId) return true;
  if (member.user?.bot) return true;
  const cache = member.roles?.cache;
  if (!cache) return false;
  if (TRUSTED_ROLE_IDS.some((id) => cache.has(id))) return true;
  // Protected user IDs always trusted
  const prot = env.PROTECTED_USER_IDS || [];
  if (prot.includes(member.id)) return true;
  return false;
}

function isRestrictedStaff(member) {
  if (!member || isTrusted(member)) return false;
  const cache = member.roles?.cache;
  if (!cache) return false;
  // Has a restricted staff role and is NOT trusted
  if (RESTRICTED_ROLE_IDS.some((id) => cache.has(id))) return true;
  // Anyone with ManageChannels/ManageRoles who isn't trusted gets limited if antinuke on
  // Only punish if they look like staff (restricted roles) — don't timeout random mods with perms
  return false;
}

async function fetchExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const entry = logs.entries.find((e) => {
      if (Date.now() - e.createdTimestamp > 15000) return false;
      if (targetId && e.target?.id && e.target.id !== targetId) return false;
      return true;
    });
    return entry?.executor || null;
  } catch (_) {
    return null;
  }
}

async function punish(guild, client, executor, reason, undo) {
  if (!executor || executor.bot) return;
  let member = guild.members.cache.get(executor.id);
  if (!member) member = await guild.members.fetch(executor.id).catch(() => null);
  if (!member || isTrusted(member)) return;
  if (!isRestrictedStaff(member)) return;

  try {
    if (typeof undo === 'function') await undo().catch(() => {});
  } catch (_) {}

  await member.timeout(TIMEOUT_MS, 'Anti-nuke: ' + reason).catch(() => {});
  await logProtect(
    client,
    guild,
    'Anti-nuke',
    '**' + (executor.tag || executor.username) + '** (`' + executor.id + '`)\nAction: **' + reason + '**\nTimeout: **3 days**'
  ).catch(() => {});

  const n = trackWindow(actionWindow, executor.id, 20000);
  if (n >= 3) {
    await member.roles.set([], 'Anti-nuke mass actions').catch(() => {});
    await logProtect(client, guild, 'Anti-nuke · Mass actions', '**' + (executor.tag || executor.username) + '** stripped roles after **' + n + '** actions').catch(() => {});
  }
}

function registerAntiNuke(client) {
  client.on('channelCreate', async (channel) => {
    try {
      if (!channel.guild) return;
      const prot = getProtection();
      if (prot.antinuke === false) return;

      const executor = await fetchExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
      if (!executor) return;
      let member = channel.guild.members.cache.get(executor.id) || (await channel.guild.members.fetch(executor.id).catch(() => null));
      if (!member || isTrusted(member)) return;
      // Only timeout restricted ranks (trial/admin/staff...) — not random members
      if (!isRestrictedStaff(member)) return;

      const kind = channel.type === 4 ? 'category' : 'channel';
      await punish(channel.guild, client, executor, `Created ${kind} #${channel.name}`, async () => {
        await channel.delete(`Anti-nuke: unauthorized ${kind} create`).catch(() => {});
      });
    } catch (e) {
      console.error('antinuke channelCreate', e.message);
    }
  });

  client.on('channelDelete', async (channel) => {
    try {
      if (!channel.guild) return;
      const prot = getProtection();
      if (prot.antinuke === false) return;

      const executor = await fetchExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
      if (!executor) return;
      let member = channel.guild.members.cache.get(executor.id) || (await channel.guild.members.fetch(executor.id).catch(() => null));
      if (!member || isTrusted(member)) return;
      if (!isRestrictedStaff(member)) return;

      await punish(channel.guild, client, executor, `Deleted channel #${channel.name}`, null);
    } catch (e) {
      console.error('antinuke channelDelete', e.message);
    }
  });

  client.on('roleCreate', async (role) => {
    try {
      const prot = getProtection();
      if (prot.antinuke === false) return;

      const executor = await fetchExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
      if (!executor) return;
      let member = role.guild.members.cache.get(executor.id) || (await role.guild.members.fetch(executor.id).catch(() => null));
      if (!member || isTrusted(member)) return;
      if (!isRestrictedStaff(member)) return;

      await punish(role.guild, client, executor, `Created role @${role.name}`, async () => {
        await role.delete('Anti-nuke: unauthorized role create').catch(() => {});
      });
    } catch (e) {
      console.error('antinuke roleCreate', e.message);
    }
  });

  client.on('roleDelete', async (role) => {
    try {
      const prot = getProtection();
      if (prot.antinuke === false) return;

      const executor = await fetchExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
      if (!executor) return;
      let member = role.guild.members.cache.get(executor.id) || (await role.guild.members.fetch(executor.id).catch(() => null));
      if (!member || isTrusted(member)) return;
      if (!isRestrictedStaff(member)) return;

      await punish(role.guild, client, executor, `Deleted role @${role.name}`, null);
    } catch (e) {
      console.error('antinuke roleDelete', e.message);
    }
  });

  client.on('guildBanAdd', async (ban) => {
    try {
      const prot = getProtection();
      if (prot.antinuke === false) return;

      const executor = await fetchExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      if (!executor) return;
      let member = ban.guild.members.cache.get(executor.id) || (await ban.guild.members.fetch(executor.id).catch(() => null));
      if (!member || isTrusted(member)) return;
      if (!isRestrictedStaff(member)) return;

      // Trial/Admin mass-banning is suspicious
      const n = trackWindow(actionWindow, 'ban:' + executor.id, 30000);
      if (n >= 3) {
        await punish(ban.guild, client, executor, `Mass ban (${n})`, async () => {
          await ban.guild.members.unban(ban.user.id, 'Anti-nuke mass ban').catch(() => {});
        });
      }
    } catch (e) {
      console.error('antinuke ban', e.message);
    }
  });

  console.log('Anti-nuke listeners registered');
}

module.exports = {
  registerAntiNuke,
  isTrusted,
  isRestrictedStaff,
  TRUSTED_ROLE_IDS,
  RESTRICTED_ROLE_IDS
};
