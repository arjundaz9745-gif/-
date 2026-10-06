/**
 * Microsoft account login checker
 * - Lightweight HTTP probe (GetCredentialType + login page errors)
 * - Optional PASS_WORKER_URL /check for full browser check
 */
const brand = require('../config/brand');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function cleanEmail(e) {
  return String(e || '').trim().toLowerCase();
}

async function getCredentialType(email) {
  const url = 'https://login.live.com/GetCredentialType.srf?wa=wsignin1.0';
  const body = {
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
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': UA,
      Accept: 'application/json',
      Origin: 'https://login.live.com',
      Referer: 'https://login.live.com/'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!data) return { ok: false, error: 'No response from Microsoft GetCredentialType' };
  return { ok: true, data };
}

/** Map Microsoft IfExistsResult codes */
function existsMessage(code) {
  // 0 = exists, 1 = no account, 5 = both, 6 = consumer, etc.
  switch (Number(code)) {
    case 0:
      return { exists: true, text: 'Account exists on Microsoft' };
    case 1:
      return { exists: false, text: 'That Microsoft account does not exist' };
    case 2:
      return { exists: true, text: 'Account exists (enterprise / federated)' };
    case 4:
      return { exists: false, text: 'Account does not exist / throttled' };
    case 5:
      return { exists: true, text: 'Account exists (both personal & work)' };
    case 6:
      return { exists: true, text: 'Consumer account exists' };
    default:
      return { exists: null, text: `IfExistsResult code: ${code}` };
  }
}

/**
 * Attempt password stage via login.live.com HTML flow (best-effort).
 * Returns Microsoft error strings when visible.
 */
async function tryPasswordLogin(email, password) {
  // Load login page for PPFT / cookies
  const loginUrl =
    'https://login.live.com/login.srf?wa=wsignin1.0&rpsnv=13&ct=' +
    Math.floor(Date.now() / 1000) +
    '&rver=7.0.6738.0&wp=MBI_SSL&wreply=https%3a%2f%2faccount.microsoft.com%2f&lc=1033&id=292841&mkt=en-US';

  const pageRes = await fetch(loginUrl, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow'
  });
  const html = await pageRes.text();
  const cookies = joinCookies(pageRes.headers.getSetCookie?.() || []);

  // Extract PPFT
  let ppft = '';
  const m1 = html.match(/name="PPFT"[^>]*value="([^"]+)"/);
  const m2 = html.match(/sFTTag:'.*value=\\?"([^"\\]+)\\?"/);
  const m3 = html.match(/"sFT":"([^"]+)"/);
  if (m1) ppft = m1[1];
  else if (m2) ppft = m2[1];
  else if (m3) ppft = m3[1];

  // urlPost
  let urlPost = 'https://login.live.com/ppsecure/post.srf';
  const up = html.match(/urlPost:"([^"]+)"/) || html.match(/urlPost:'([^']+)'/);
  if (up) urlPost = up[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  if (!ppft) {
    return {
      ok: false,
      stage: 'page',
      error: 'Could not load Microsoft login form (blocked or changed). Use PASS_WORKER_URL for full check.'
    };
  }

  const form = new URLSearchParams();
  form.set('login', email);
  form.set('loginfmt', email);
  form.set('passwd', password);
  form.set('PPFT', ppft);
  form.set('type', '11');
  form.set('LoginOptions', '3');
  form.set('NewUser', '1');
  form.set('i13', '0');

  const postRes = await fetch(urlPost, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
      Origin: 'https://login.live.com',
      Referer: loginUrl
    },
    body: form.toString(),
    redirect: 'manual'
  });

  const postHtml = await postRes.text().catch(() => '');
  const loc = postRes.headers.get('location') || '';

  // Success-ish redirects
  if (
    postRes.status >= 300 &&
    postRes.status < 400 &&
    /account\.microsoft|office|live\.com\/oauth|login\.srf.*wa=/i.test(loc)
  ) {
    // Could still be consent / proof — check body too
  }
  if (/sErrorCode|passwordError|errorText|alert-error|identity\/signin/i.test(postHtml) === false) {
    if (postRes.status === 302 || postRes.status === 301) {
      if (/proofs|identity\/confirm|account\.live\.com\/identity/i.test(loc + postHtml)) {
        return {
          ok: false,
          stage: 'password',
          error: 'Login needs extra verification (2FA / identity proof). Password may be correct.',
          raw: loc.slice(0, 200)
        };
      }
      if (/account\.microsoft\.com|onedrive|office\.com/i.test(loc)) {
        return { ok: true, stage: 'password', error: null, message: 'Login appears successful' };
      }
    }
  }

  // Extract visible error from page
  const err =
    extractError(postHtml) ||
    (postRes.status === 200 ? 'Microsoft did not accept this login (see details).' : null);

  if (err) {
    return { ok: false, stage: 'password', error: err };
  }

  // 200 with stay on login = usually wrong password
  if (postRes.status === 200 && /passwd|password/i.test(postHtml)) {
    return {
      ok: false,
      stage: 'password',
      error: extractError(postHtml) || 'Your account or password is incorrect.'
    };
  }

  return {
    ok: false,
    stage: 'password',
    error: extractError(postHtml) || `Unexpected response (HTTP ${postRes.status}). Try worker check.`
  };
}

function joinCookies(setCookies) {
  if (!Array.isArray(setCookies)) return '';
  return setCookies.map((c) => String(c).split(';')[0]).join('; ');
}

function extractError(html) {
  if (!html) return null;
  const patterns = [
    new RegExp('id="passwordError"[^>]*>([^<]+)<', 'i'),
    new RegExp('id="usernameError"[^>]*>([^<]+)<', 'i'),
    new RegExp('id="error"[^>]*>([^<]+)<', 'i'),
    new RegExp('class="alert-error"[^>]*>([^<]+)<', 'i'),
    new RegExp('"sErrorCode"\\s*:\\s*"([^"]+)"', 'i'),
    new RegExp('"error_description"\\s*:\\s*"([^"]+)"', 'i'),
    new RegExp('<div[^>]*role="alert"[^>]*>([^<]+)<', 'i'),
    new RegExp('data-bind="text: serverError"[^>]*>([^<]+)<', 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] && m[1].trim().length > 2) {
      return decodeHtml(m[1].trim());
    }
  }
  // Common Microsoft strings
  const known = [
    'Your account or password is incorrect',
    'We don\'t recognize this user ID or password',
    'That Microsoft account doesn\'t exist',
    'Too many requests',
    'Help us protect your account',
    'unusual activity',
    'sign in too many times',
    'account has been locked',
    'been suspended',
    'Add a phone number',
    'Verify your identity',
    'Enter the code',
    'password has expired'
  ];
  const lower = html.toLowerCase();
  for (const k of known) {
    if (lower.includes(k.toLowerCase())) return k;
  }
  return null;
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u0027/g, "'");
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
    return { http: res.status, data };
  } catch (e) {
    return { http: 0, data: { error: e.message } };
  }
}

/**
 * Full check pipeline
 * @returns {{ ok: boolean, summary: string, error: string|null, details: object }}
 */
async function checkMicrosoft(email, password) {
  email = cleanEmail(email);
  password = String(password || '');
  const details = {};

  if (!email || !email.includes('@')) {
    return { ok: false, summary: 'Invalid email format', error: 'Invalid email format', details };
  }
  if (!password) {
    return { ok: false, summary: 'Missing password', error: 'Missing password', details };
  }

  // Worker first if configured
  const worker = await tryWorkerCheck(email, password);
  if (worker && worker.data && (worker.data.error || worker.data.message || worker.data.status)) {
    details.worker = worker.data;
    if (worker.data.status === 'success' || worker.data.ok === true) {
      return {
        ok: true,
        summary: 'Login OK (worker)',
        error: null,
        details
      };
    }
    const err = worker.data.error || worker.data.message || 'Login failed (worker)';
    return { ok: false, summary: err, error: err, details };
  }

  // Existence
  try {
    const ct = await getCredentialType(email);
    details.credentialType = ct.data || null;
    if (ct.ok && ct.data) {
      const ex = existsMessage(ct.data.IfExistsResult);
      details.exists = ex;
      if (ex.exists === false) {
        return {
          ok: false,
          summary: ex.text,
          error: ex.text,
          details
        };
      }
      // Federation / other IdP
      if (ct.data.Credentials && ct.data.Credentials.FederationRedirectUrl) {
        return {
          ok: false,
          summary: 'Federated / work account — use work login (not personal Microsoft password flow)',
          error: 'Federated account: ' + (ct.data.Credentials.FederationRedirectUrl || ''),
          details
        };
      }
    }
  } catch (e) {
    details.credentialTypeError = e.message;
  }

  // Password attempt
  try {
    const pw = await tryPasswordLogin(email, password);
    details.password = pw;
    if (pw.ok) {
      return { ok: true, summary: pw.message || 'Login appears successful', error: null, details };
    }
    return {
      ok: false,
      summary: pw.error || 'Login failed',
      error: pw.error || 'Login failed',
      details
    };
  } catch (e) {
    return {
      ok: false,
      summary: 'Check error: ' + e.message,
      error: e.message,
      details: { ...details, exception: e.message }
    };
  }
}

module.exports = { checkMicrosoft, getCredentialType };
