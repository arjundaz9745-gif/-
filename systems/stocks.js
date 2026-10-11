/** Paid / normal stock (not gen) — emoji names must exist on the server */
const STOCK_META = {
  mcfa: { emoji: 'mcfa', label: 'MCFA (Full Access)', fallback: ':mcfa:' },
  mcnfa: { emoji: 'mcnfa', label: 'MCNFA (Non Full Access)', fallback: ':mcnfa:' },
  minecraft: { emoji: 'minecraft', label: 'Minecraft', fallback: ':minecraft:' },
  hypixel: { emoji: 'hypixel', label: 'Hypixel', fallback: ':hypixel:' },
  xbox: { emoji: 'xbox', label: 'Xbox', fallback: ':xbox:' },
  xbox_code: { emoji: 'xbox', label: 'Xbox Code', fallback: ':xbox:' },
  netflix: { emoji: 'netflix', label: 'Netflix', fallback: '📺' },
  crunchyroll: { emoji: 'crunchyroll', label: 'Crunchyroll', fallback: '🍿' },
  spotify: { emoji: 'spotify', label: 'Spotify', fallback: '🎧' },
  nitro: { emoji: 'nitro', label: 'Nitro', fallback: '💎' },
  robux: { emoji: 'robux', label: 'Robux', fallback: '💰' },
  steam: { emoji: 'steam', label: 'Steam', fallback: '🕹️' },
  hotmail: { emoji: 'email', label: 'Hotmail', fallback: '📧' },
  stream: { emoji: 'stream', label: 'Stream', fallback: '📡' },
  donut: { emoji: 'donut', label: 'DonutSMP', fallback: '🍩' },
  fa: { emoji: 'mcfa', label: 'MCFA (Full Access)', fallback: ':mcfa:' }
};

const METHOD_META = {
  mc_redeem: { emoji: 'ticket', label: 'MC Redeem Code Method', fallback: '🎟️' },
  nitro_yearly: { emoji: 'nitro', label: 'Nitro Basic Yearly Method', fallback: '💠' },
  mcfa_email: { emoji: 'email', label: 'MCFA Email Change Method', fallback: '📧' },
  mcfa_pass: { emoji: 'lock', label: 'MCFA Password Change Method', fallback: '🔐' },
  robux_5k: { emoji: 'robux', label: '5,000 Robux Method', fallback: '💎' },
  amazon: { emoji: 'amazon', label: 'Amazon Prime Method', fallback: '👑' },
  xbox_gift: { emoji: 'xbox', label: 'Xbox Gift Card Method', fallback: '🎮' },
  boost: { emoji: 'boost', label: '30× Boost Method', fallback: '🚀' },
  hosting: { emoji: 'host', label: 'Free Website Hosting', fallback: '🌐' }
};

function em(guild, name, fallback) {
  if (!guild?.emojis?.cache) return fallback || `:${name}:`;
  const n = String(name || '').toLowerCase().replace(/^:|:$/g, '');
  // exact name match (animated or static)
  let f = guild.emojis.cache.find((e) => e.name.toLowerCase() === n);
  if (!f) f = guild.emojis.cache.find((e) => e.name.toLowerCase().replace(/_/g, '') === n.replace(/_/g, ''));
  if (f) return f.toString(); // renders animated if animated emoji
  return fallback || `:${n}:`;
}

function brandEmojis(guild) {
  return {
    ur: em(guild, 'ultimate_rewards', '✨'),
    dm: em(guild, 'dashmod', '🛡️'),
    stock: em(guild, 'stock', '📦'),
    verified: em(guild, 'verified', '✅'),
    arrow: em(guild, 'arrow_1', '»')
  };
}

function formatStockList(data, guild) {
  const stocks = data.stocks || {};
  const b = brandEmojis(guild);
  const lines = [`${b.ur} **Ultimate Rewards** · ${b.dm} **DashMod** · Paid stock`, ''];
  for (const [key, meta] of Object.entries(STOCK_META)) {
    const n = (stocks[key] || []).length;
    const icon = em(guild, meta.emoji, meta.fallback);
    lines.push(`${icon} **${meta.label}** (\`-${key}\`) → **${n}**`);
  }
  for (const k of Object.keys(stocks)) {
    if (STOCK_META[k]) continue;
    lines.push(`${b.stock} **${k}** (\`-${k}\`) → **${(stocks[k] || []).length}**`);
  }
  if (lines.length <= 2) lines.push('_Empty — staff: `-stockadd <key> email:pass`_');
  return lines.join('\n');
}

function formatMethodList(data, guild) {
  const methods = data.methods || {};
  const lines = [];
  for (const [key, meta] of Object.entries(METHOD_META)) {
    const text = methods[key];
    const icon = em(guild, meta.emoji, meta.fallback);
    lines.push(`${icon} **${meta.label}** (\`${key}\`) · ${text ? '✅ set' : '— empty'}`);
  }
  for (const k of Object.keys(methods)) {
    if (METHOD_META[k]) continue;
    lines.push(`📝 **${k}** · ${methods[k] ? '✅' : '—'}`);
  }
  return lines.join('\n') || 'Empty';
}

function takePaidStock(data, key) {
  if (!data.stocks) data.stocks = {};
  const list = data.stocks[key];
  if (!list || !list.length) return null;
  return list.shift();
}

module.exports = {
  STOCK_META,
  METHOD_META,
  formatStockList,
  formatMethodList,
  em,
  brandEmojis,
  takePaidStock
};
