const { AttachmentBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const env = require('../config/env');

function buildSyncPayload() {
  const data = dataStore.get();
  return {
    type: 'dashmod-sync',
    v: 1,
    at: new Date().toISOString(),
    invites: data.inviteStats || {},
    messages: data.messages || {},
    stocks: data.stocks || {},
    protection: data.protection || {},
    settings: data.settings || {},
    levels: data.levels || {}
  };
}

function applySync(body) {
  const data = dataStore.get();
  if (body.invites) data.inviteStats = body.invites;
  if (body.messages) data.messages = body.messages;
  if (body.stocks) data.stocks = body.stocks;
  if (body.protection) data.protection = { ...data.protection, ...body.protection };
  if (body.settings) data.settings = { ...data.settings, ...body.settings };
  if (body.levels) data.levels = body.levels;
  dataStore.save();
}

async function exportToChannel(channel, reason = 'manual') {
  if (!channel?.isTextBased?.()) return null;
  const buf = Buffer.from(JSON.stringify(buildSyncPayload(), null, 2), 'utf8');
  return channel.send({
    embeds: [E('Sync export', `Reason: **${reason}**`, brand.blurple)],
    files: [new AttachmentBuilder(buf, { name: `dashmod-sync-${Date.now()}.json` })]
  });
}

async function importFromChannel(channel) {
  if (!channel?.isTextBased?.()) return { ok: false, reason: 'bad channel' };
  const msgs = await channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (!msgs) return { ok: false, reason: 'fetch failed' };
  for (const msg of msgs.values()) {
    const att = msg.attachments.find((a) => /dashmod-sync|\.json$/i.test(a.name || ''));
    if (att) {
      try {
        const body = await (await fetch(att.url)).json();
        if (body?.type && body.v) {
          applySync(body);
          return { ok: true, from: 'attachment', at: body.at };
        }
      } catch (_) {}
    }
  }
  return { ok: false, reason: 'no sync file' };
}

let exportTimer = null;
function scheduleExport(client, reason) {
  const data = dataStore.get();
  const chId = data.syncChannelId || env.SYNC_CHANNEL_ID;
  if (!chId || !client) return;
  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = setTimeout(async () => {
    const ch = await client.channels.fetch(chId).catch(() => null);
    if (ch) await exportToChannel(ch, reason).catch(() => {});
  }, 8000);
}

module.exports = { exportToChannel, importFromChannel, scheduleExport, buildSyncPayload, applySync };
