const { PermissionFlagsBits } = require('discord.js');
const { STAFF_ROLE_IDS, RANK_ORDER, ROLE } = require('../config/roles');
const dataStore = require('./data');

function isStaff(member) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ModerateMembers)) return true;
  const cache = member.roles?.cache;
  if (!cache) return false;
  if (STAFF_ROLE_IDS.some((id) => cache.has(id))) return true;
  const extra = dataStore.get().settings?.staffRoleId;
  if (extra && cache.has(extra)) return true;
  return false;
}

function staffRankLabel(member) {
  if (!member?.roles?.cache) return null;
  for (const [id, label] of RANK_ORDER) {
    if (id && member.roles.cache.has(id)) return label;
  }
  return null;
}

module.exports = { isStaff, staffRankLabel, ROLE };
