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
  DASHBOARD_URL: process.env.DASHBOARD_URL || '',
  OPENAI_API_KEY: String(process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim().replace(/^["']|["']$/g, ''),
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL || '').replace(/\/$/, ''),
  OPENAI_MODEL: process.env.OPENAI_MODEL || '',
  PRESENCE_INTENT: process.env.PRESENCE_INTENT !== 'false'
};
