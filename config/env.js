module.exports = {
  TOKEN: String(process.env.DISCORD_BOT_TOKEN || '').trim(),
  PORT: process.env.PORT || 10000,
  GUILD_ID: process.env.GUILD_ID || '',
  AI_CHANNEL_ID: process.env.AI_CHANNEL_ID || '',
  SYNC_CHANNEL_ID: process.env.SYNC_CHANNEL_ID || '',
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || '',
  PROTECTED_USER_ID: process.env.PROTECTED_USER_ID || '1398979148063571989',
  PROTECTED_PING_TIMEOUT_MS: 60 * 60 * 1000,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'ultimaterewards10',
  DASHBOARD_URL: process.env.DASHBOARD_URL || '',
  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim(),
  OPENAI_BASE_URL: (process.env.OPENAI_BASE_URL || '').replace(/\/$/, ''),
  OPENAI_MODEL: process.env.OPENAI_MODEL || '',
  PRESENCE_INTENT: process.env.PRESENCE_INTENT !== 'false'
};
