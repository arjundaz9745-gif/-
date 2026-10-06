/**
 * Soft ban: block giveaways + optional timeout
 * Timeout skips users with SBAN_STAFF_EXEMPT_ROLE
 * Giveaway ban applies to everyone listed
 */
const dataStore = require('../utils/data');
const env = require('../config/env');
const { PermissionFlagsBits } = require('discord.js');

function getSbans() {
  const d = dataStore.get();
  if (!d.sbans) d.sbans = {}; // userId -> { until, by, reason, at }
  return d.sbans;
}

function isSbanActive(userId) {
  const s = getSbans()[userId];
  if (!s) return false;
  if (s.until && Date.now() > s.until) {
    delete getSbans()[userId];
    dataStore.save();
    return false;
  }
  return true;
}

function addSban(userId, days, by, reason) {
  const ms = Math.max(1, days) * 24 * 60 * 60 * 1000;
  const until = Date.now() + ms;
  getSbans()[userId] = {
    until,
    by,
    reason: reason || 'sban',
    at: Date.now(),
    days
  };
  dataStore.save();
  return getSbans()[userId];
}

function removeSban(userId) {
  if (getSbans()[userId]) {
    delete getSbans()[userId];
    dataStore.save();
    return true;
  }
  return false;
}

function isTimeoutExempt(member) {
  const rid = env.SBAN_STAFF_EXEMPT_ROLE || '1548173330794815599';
  return !!(member?.roles?.cache?.has(rid) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}

module.exports = { isSbanActive, addSban, removeSban, isTimeoutExempt, getSbans };
