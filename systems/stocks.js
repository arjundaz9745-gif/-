/** Default product keys with display emoji */
const STOCK_META = {
  mcfa: { emoji: '⚔️', label: 'MCFA' },
  minecraft: { emoji: '⛏️', label: 'Minecraft' },
  hypixel: { emoji: '🎮', label: 'Hypixel Unbanned' },
  xbox: { emoji: '🎯', label: 'Xbox Code' },
  netflix: { emoji: '📺', label: 'Netflix Premium' },
  crunchyroll: { emoji: '🍿', label: 'Crunchyroll' },
  spotify: { emoji: '🎧', label: 'Spotify' },
  nitro: { emoji: '💎', label: 'Nitro' },
  robux: { emoji: '💰', label: 'Robux' },
  steam: { emoji: '🕹️', label: 'Steam' },
  hotmail: { emoji: '📧', label: 'Hotmail' },
  stream: { emoji: '📡', label: 'Stream Accounts' }
};

const METHOD_META = {
  mc_redeem: { emoji: '🎟️', label: 'MC Redeem Code Method' },
  nitro_yearly: { emoji: '💠', label: 'Nitro Basic Yearly Method' },
  mcfa_email: { emoji: '📧', label: 'MCFA Email Change Method' },
  mcfa_pass: { emoji: '🔐', label: 'MCFA Password Change Method' },
  robux_5k: { emoji: '💎', label: '5,000 Robux Method' },
  amazon: { emoji: '👑', label: 'Amazon Prime Method' },
  xbox_gift: { emoji: '🎮', label: 'Xbox Gift Card Method' },
  boost: { emoji: '🚀', label: '30× Boost Method' },
  hosting: { emoji: '🌐', label: 'Free Website Hosting' }
};

function formatStockList(data) {
  const stocks = data.stocks || {};
  const lines = [];
  for (const [key, meta] of Object.entries(STOCK_META)) {
    const n = (stocks[key] || []).length;
    lines.push(`${meta.emoji} **${meta.label}** (\`${key}\`) · **${n}**`);
  }
  // extra custom keys still shown but discouraged
  for (const k of Object.keys(stocks)) {
    if (STOCK_META[k]) continue;
    lines.push(`📦 **${k}** · **${(stocks[k] || []).length}**`);
  }
  return lines.join('\n') || 'Empty';
}

function formatMethodList(data) {
  const methods = data.methods || {};
  const lines = [];
  for (const [key, meta] of Object.entries(METHOD_META)) {
    const text = methods[key];
    lines.push(`${meta.emoji} **${meta.label}** (\`${key}\`) · ${text ? '✅ set' : '— empty'}`);
  }
  for (const k of Object.keys(methods)) {
    if (METHOD_META[k]) continue;
    lines.push(`📝 **${k}** · ${methods[k] ? '✅' : '—'}`);
  }
  return lines.join('\n') || 'Empty';
}

module.exports = { STOCK_META, METHOD_META, formatStockList, formatMethodList };
