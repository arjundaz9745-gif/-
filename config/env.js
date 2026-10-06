const rawProtected =
  process.env.PROTECTED_USER_IDS ||
  process.env.PROTECTED_USER_ID ||
  '1398979148063571989';

const PROTECTED_USER_IDS = String(rawProtected)
  .split(/[,;\s]+/)
  .map((s) => s.trim())
  .filter((s) => /^\d{15,20}$/.test(s));

module.exports = {
  TOKEN: String(process.env.DISCORD_BOT_TOKEN || '').trim(),
  PORT: process.env.PORT || 10000,
  GUILD_ID: process.env.GUILD_ID || '',
  AI_CHANNEL_ID: process.env.AI_CHANNEL_ID || '',
  SYNC_CHANNEL_ID: process.env.SYNC_CHANNEL_ID || '',
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || '',
  /** @deprecated use PROTECTED_USER_IDS */
  PROTECTED_USER_ID: PROTECTED_USER_IDS[0] || '1398979148063571989',
  PROTECTED_USER_IDS,
  PROTECTED_PING_TIMEOUT_MS: 60 * 60 * 1000,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'ultimaterewards10',
  PANEL_PASSWORD: process.env.PANEL_PASSWORD || 'ultimaterewardspanel1',
  PANEL_ALLOWED_IDS: String(process.env.PANEL_ALLOWED_IDS || '1541659394188509215,1080190046138802306,1457319560146456723,1545107998060449803,1469378097412313216')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean),
  PASS_ONLY_ID: process.env.PASS_ONLY_ID || '1469378097412313216',
  SBAN_STAFF_EXEMPT_ROLE: process.env.SBAN_STAFF_EXEMPT_ROLE || '1548173330794815599',
  DASHBOARD_URL: process.env.DASHBOARD_URL || '',
  OPENAI_API_KEY: String(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim().replace(/^["']|["']$/g, ''),
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL || '').replace(/\/$/, ''),
  OPENAI_MODEL: process.env.OPENAI_MODEL || '',
  PRESENCE_INTENT: process.env.PRESENCE_INTENT !== '0' && process.env.PRESENCE_INTENT !== 'false',
  WEBSITE_URL: (process.env.WEBSITE_URL || '').replace(/\/$/, ''),
  REDEEM_SECRET: process.env.REDEEM_SECRET || 'ultimate-redeem-secret-change-me',
  PURCHASE_NOTIFY_CHANNEL_ID: process.env.PURCHASE_NOTIFY_CHANNEL_ID || '1553617840651771974'
};
