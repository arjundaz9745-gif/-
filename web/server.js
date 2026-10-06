const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const brand = require('../config/brand');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const { inviteBreakdown } = require('../systems/invites');
const { exportToChannel, importFromChannel } = require('../systems/sync');
const runtimeLog = require('../systems/runtimeLog');
const { ActivityType } = require('discord.js');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const adminSessions = new Map();

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 2e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (_) {
        resolve({});
      }
    });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function requireAdmin(req) {
  const tok = req.headers['x-admin-token'] || '';
  const sess = adminSessions.get(tok);
  if (!tok || !sess) return false;
  const exp = typeof sess === 'number' ? sess : sess.exp;
  return !!(exp && exp > Date.now());
}
function getSession(req) {
  const tok = req.headers['x-admin-token'] || '';
  return adminSessions.get(tok) || null;
}
function serveStatic(req, res, urlPath) {
  let rel = urlPath.replace(/^\/public\/?/, '') || 'index.html';
  if (urlPath === '/' || urlPath === '/dashboard' || urlPath === '/panel') rel = 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
  });
  fs.createReadStream(file).pipe(res);
}

function startWebServer(client) {
  http
    .createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const p = url.pathname;

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
        });
        return res.end();
      }

      if (p === '/api/status') {
        return json(res, 200, { online: !!client.user, tag: client.user?.tag, bot: brand.BOT_NAME });
      }

      if (p === '/api/admin/login' && req.method === 'POST') {
        const body = await readBody(req);
        const pw = String(body.password || body.pass || body.adminPassword || '').trim();
        const panelPw = String(env.PANEL_PASSWORD || 'ultimaterewardspanel1').trim();
        const adminPw = String(env.ADMIN_PASSWORD || 'ultimaterewards10').trim();
        // Always also accept the default panel password (so Render env mismatches still work)
        const ok =
          pw &&
          (pw === panelPw ||
            pw === adminPw ||
            pw === 'ultimaterewardspanel1' ||
            pw === 'ultimaterewards10');
        if (!ok) {
          return json(res, 401, { error: 'Invalid password' });
        }
        const token = crypto.randomBytes(24).toString('hex');
        adminSessions.set(token, { exp: Date.now() + 12 * 60 * 60 * 1000, passOnly: false });
        runtimeLog.info('Panel login OK');
        return json(res, 200, { ok: true, token, bot: brand.BOT_NAME, scopes: ['full'] });
      }

      if (p.startsWith('/api/admin/')) {
        if (p !== '/api/admin/login' && !requireAdmin(req)) return json(res, 401, { error: 'Unauthorized' });
        const data = dataStore.get();

        if (p === '/api/admin/status' && req.method === 'GET') {
          const up = Math.floor(process.uptime());
          const uptime = `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
          const topInvites = [];
          for (const [gid, users] of Object.entries(data.inviteStats || {})) {
            for (const [uid] of Object.entries(users || {})) {
              const b = inviteBreakdown(gid, uid);
              if (b.total > 0) topInvites.push({ id: uid, total: b.total });
            }
          }
          topInvites.sort((a, b) => b.total - a.total);
          const topI = [];
          for (const row of topInvites.slice(0, 10)) {
            let name = row.id;
            try {
              name = (await client.users.fetch(row.id)).username;
            } catch (_) {}
            topI.push({ name, total: row.total });
          }
          const topMessages = [];
          for (const [, users] of Object.entries(data.messages || {})) {
            for (const [uid, n] of Object.entries(users || {})) {
              if (n > 0) topMessages.push({ id: uid, count: n });
            }
          }
          topMessages.sort((a, b) => b.count - a.count);
          const topM = [];
          for (const row of topMessages.slice(0, 10)) {
            let name = row.id;
            try {
              name = (await client.users.fetch(row.id)).username;
            } catch (_) {}
            topM.push({ name, count: row.count });
          }
          return json(res, 200, {
            online: !!client.user,
            tag: client.user?.tag,
            guilds: client.guilds?.cache?.size || 0,
            ping: Math.round(client.ws?.ping || 0),
            uptime,
            protection: data.protection || {},
            syncChannelId: data.syncChannelId || env.SYNC_CHANNEL_ID || '',
            aiChannelId: data.aiChannelId || env.AI_CHANNEL_ID || '',
            logChannelId: data.settings?.logChannelId || env.LOG_CHANNEL_ID || '',
            dashboardUrl: env.DASHBOARD_URL || '',
            topInvites: topI,
            topMessages: topM
          });
        }

        if (p === '/api/admin/protection' && req.method === 'POST') {
          const body = await readBody(req);
          data.protection = data.protection || {};
          if (typeof body.automod === 'boolean') data.protection.automod = body.automod;
          if (typeof body.antiraid === 'boolean') data.protection.antiraid = body.antiraid;
          if (typeof body.antinuke === 'boolean') data.protection.antinuke = body.antinuke;
          dataStore.save();
          return json(res, 200, { ok: true });
        }
        if (p === '/api/admin/settings' && req.method === 'POST') {
          const body = await readBody(req);
          if (body.syncChannelId != null) data.syncChannelId = String(body.syncChannelId || '') || null;
          if (body.aiChannelId != null) data.aiChannelId = String(body.aiChannelId || '') || null;
          if (body.logChannelId != null) {
            data.settings = data.settings || {};
            data.settings.logChannelId = String(body.logChannelId || '') || null;
          }
          dataStore.save();
          return json(res, 200, { ok: true });
        }
        if (p === '/api/admin/export' && req.method === 'POST') {
          const chId = data.syncChannelId || env.SYNC_CHANNEL_ID;
          if (!chId) return json(res, 400, { error: 'No sync channel' });
          const ch = await client.channels.fetch(chId).catch(() => null);
          if (!ch) return json(res, 400, { error: 'Channel not found' });
          await exportToChannel(ch, 'dashboard');
          return json(res, 200, { ok: true });
        }
        if (p === '/api/admin/import' && req.method === 'POST') {
          const chId = data.syncChannelId || env.SYNC_CHANNEL_ID;
          if (!chId) return json(res, 400, { error: 'No sync channel' });
          const ch = await client.channels.fetch(chId).catch(() => null);
          if (!ch) return json(res, 400, { error: 'Channel not found' });
          return json(res, 200, await importFromChannel(ch));
        }

        if (p === '/api/admin/bot' && req.method === 'GET') {
          const upMs = Date.now() - (runtimeLog.getStartedAt?.() || Date.now() - process.uptime() * 1000);
          const upSec = Math.floor(process.uptime());
          const fmt = (s) => {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            return h + 'h ' + m + 'm ' + sec + 's';
          };
          const presence = data.botPresence || { status: 'online', activity: '' };
          return json(res, 200, {
            name: client.user?.username || null,
            tag: client.user?.tag || null,
            id: client.user?.id || null,
            online: !!client.user && !data.botPaused,
            paused: !!data.botPaused,
            status: data.botPaused ? 'offline' : (presence.status || 'online'),
            activity: presence.activity || '',
            uptime: upSec,
            uptimeText: fmt(upSec),
            guilds: client.guilds?.cache?.size || 0,
            ping: client.ws?.ping ?? null
          });
        }
        if (p === '/api/admin/bot/logs' && req.method === 'GET') {
          return json(res, 200, { lines: runtimeLog.getLines(250) });
        }
        if (p === '/api/admin/bot/presence' && req.method === 'POST') {
          const body = await readBody(req);
          let status = String(body.status || 'online').toLowerCase();
          if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) status = 'online';
          const activity = String(body.activity || body.text || '').slice(0, 128);
          data.botPresence = { status, activity };
          dataStore.save();
          try {
            const opts = { status };
            if (activity) {
              opts.activities = [{ name: activity, type: ActivityType.Custom, state: activity }];
              // Custom may need type Watching as fallback on some clients
              opts.activities = [{ name: activity, type: ActivityType.Watching }];
            } else {
              opts.activities = [];
            }
            await client.user.setPresence(opts);
            runtimeLog.info('Presence set: ' + status + (activity ? ' | ' + activity : ''));
          } catch (e) {
            runtimeLog.error('Presence failed: ' + e.message);
            return json(res, 500, { error: e.message });
          }
          return json(res, 200, { ok: true, status, activity });
        }
        if (p === '/api/admin/bot/stop' && req.method === 'POST') {
          data.botPaused = true;
          dataStore.save();
          runtimeLog.warn('Panel: STOP — commands paused');
          return json(res, 200, { ok: true, paused: true });
        }
        if (p === '/api/admin/bot/start' && req.method === 'POST') {
          data.botPaused = false;
          dataStore.save();
          runtimeLog.info('Panel: START — bot accepting commands');
          return json(res, 200, { ok: true, paused: false });
        }
        if (p === '/api/admin/bot/restart' && req.method === 'POST') {
          data.botPaused = false;
          dataStore.save();
          runtimeLog.warn('Panel: RESTART requested');
          setTimeout(() => process.exit(0), 800);
          return json(res, 200, { ok: true, restarting: true });
        }
        if (p === '/api/admin/gen' && req.method === 'GET') {
          const fgen = data.fgen || {};
          const bgen = data.bgen || {};
          const pgen = data.pgen || {};
          const sum = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, (v || []).length]));
          return json(res, 200, { fgen: sum(fgen), bgen: sum(bgen), pgen: sum(pgen), config: data.genConfig || {} });
        }
        if (p === '/api/admin/pass' && req.method === 'GET') {
          const pc = data.passChanger || { queue: [], history: [], stats: {} };
          return json(res, 200, {
            enabled: pc.enabled !== false,
            queue: (pc.queue || []).slice(-50),
            history: (pc.history || []).slice(-30),
            stats: pc.stats || {}
          });
        }

        if (p === '/api/admin/announce' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.channelId) return json(res, 400, { error: 'channelId required' });
          const ch = await client.channels.fetch(body.channelId).catch(() => null);
          if (!ch?.isTextBased?.()) return json(res, 400, { error: 'Invalid channel' });
          const url = (body.dashboardUrl || env.DASHBOARD_URL || '').replace(/\/$/, '') || 'https://YOUR-RENDER-URL';
          const emb = E(
            'ᴅᴀꜱʜᴍᴏᴅ · Admin panel',
            `**Dashboard**\n${url}\n\n` +
              (body.showPassword
                ? `**Admin password**\n||${env.ADMIN_PASSWORD}||\n\n`
                : 'Ask DashWho for the admin password.\n\n') +
              `*Coded by DashWho · Enhanced by DakshBro*`
          );
          await ch.send({ embeds: [emb] });
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: 'Not found' });
      }

      if (p === '/' || p === '/dashboard' || p === '/panel' || p.startsWith('/public/')) {
        return serveStatic(req, res, p.startsWith('/public/') ? p : '/');
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${brand.BOT_NAME} online · panel at /`);
    })
    .listen(env.PORT, '0.0.0.0', () => console.log('HTTP', env.PORT, '· dashboard /'));
}

module.exports = { startWebServer };
