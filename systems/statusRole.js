const { ActivityType, EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');

function getCfg() {
  const d = dataStore.get();
  if (!d.genConfig) {
    d.genConfig = {
      freeRoleId: process.env.FREE_GEN_ROLE_ID || '1555427829800239175',
      premiumRoleId: process.env.PREMIUM_GEN_ROLE_ID || '1556280665140363274',
      freeChannelId: process.env.FREE_GEN_CHANNEL_ID || '1555793184250929325',
      boosterChannelId: process.env.BOOSTER_GEN_CHANNEL_ID || '1555793184250929325',
      premiumChannelId: process.env.PREMIUM_GEN_CHANNEL_ID || '1555793184250929325',
      cmdChannelId: process.env.CMD_CHANNEL_ID || '1553617826814890085',
      vouchUserId: process.env.VOUCH_USER_ID || '1556221818325696512',
      premiumSellerId: process.env.PREMIUM_SELLER_ID || '1398979148063571989',
      premiumPrice: process.env.PREMIUM_PRICE || '$5',
      freeStatusText: process.env.FREE_STATUS_TEXT || 'Free G3n at discord.gg/TcU29KHkAt',
      statusInvite: process.env.STATUS_INVITE || 'TcU29KHkAt'
    };
  }
  return d.genConfig;
}

function memberStatusText(member) {
  const presence = member?.presence;
  if (!presence?.activities?.length) return '';
  const parts = [];
  for (const a of presence.activities) {
    if (a.state) parts.push(a.state);
    if (a.name && a.type === ActivityType.Custom) parts.push(a.name);
    if (a.details) parts.push(a.details);
  }
  return parts.join(' ').toLowerCase();
}

function hasRequiredStatus(member) {
  const cfg = getCfg();
  const text = memberStatusText(member);
  const needle = (cfg.freeStatusText || '').toLowerCase();
  const inv = (cfg.statusInvite || '').toLowerCase();
  if (needle && text.includes(needle)) return true;
  if (inv && text.includes(inv)) return true;
  if (text.includes('free g3n') && (text.includes('.gg/') || text.includes('discord.gg'))) return true;
  return false;
}

async function checkAndGrant(member) {
  if (!member || member.user.bot) return { ok: false };
  const cfg = getCfg();
  const ok = hasRequiredStatus(member);
  if (ok && cfg.freeRoleId) {
    if (!member.roles.cache.has(cfg.freeRoleId)) {
      await member.roles.add(cfg.freeRoleId, 'Status unlock free gen').catch(() => {});
      return { ok: true, granted: true };
    }
    return { ok: true, granted: false };
  }
  return { ok: false };
}

/** Full access guide (staff posts with &access) */
function accessGuideEmbed(guild) {
  const cfg = getCfg();
  const freeCh = cfg.freeChannelId ? `<#${cfg.freeChannelId}>` : '#free';
  const boostCh = cfg.boosterChannelId ? `<#${cfg.boosterChannelId}>` : '#booster';
  const premCh = cfg.premiumChannelId ? `<#${cfg.premiumChannelId}>` : '#premium';
  const cmdCh = cfg.cmdChannelId ? `<#${cfg.cmdChannelId}>` : '#cmd';
  const seller = cfg.premiumSellerId ? `<@${cfg.premiumSellerId}>` : 'owner';
  const STATUS = cfg.freeStatusText || 'Free G3n at discord.gg/TcU29KHkAt';

  // resolve optional emoji names
  const em = (names, fb) => {
    if (!guild?.emojis?.cache) return fb;
    for (const n of names) {
      const f = guild.emojis.cache.find((e) => e.name.toLowerCase() === n.toLowerCase());
      if (f) return f.toString();
    }
    return fb;
  };
  const hashtag = em(['hashtag'], '#');
  const verified = em(['verified'], '✅');
  const arrow = em(['arrow_1'], '»');

  const body = [
    `${arrow} **FREE G3N**`,
    `${verified} Put this in your Discord **custom status**:`,
    '',
    '```',
    STATUS,
    '```',
    '',
    `${arrow} Then go to ${cmdCh} and run:`,
    '',
    '```',
    '&cstatus',
    '```',
    '',
    `${verified} Once verified you get free-gen access.`,
    `${verified} Keep the status on or access can be removed.`,
    '',
    `${arrow} **How to use Free G3n**`,
    `${verified} Open ${freeCh}`,
    `${verified} Run \`&fgen <service>\` (example: \`&fgen mcnfa\`)`,
    `${verified} Check stock: \`&stock\``,
    '',
    '────────────────────',
    '',
    `${arrow} **BOOSTER G3N**`,
    `${verified} Boost the server to unlock booster gen.`,
    `${verified} Channel: ${boostCh}`,
    `${verified} Command: \`&bgen <service>\``,
    '',
    '────────────────────',
    '',
    `${arrow} **PREMIUM G3N**`,
    `${verified} Price: **${cfg.premiumPrice || '$5'}**`,
    `${verified} DM ${seller} to buy access.`,
    `${verified} Channel: ${premCh} · Command: \`&pgen <service>\``,
    '',
    '────────────────────',
    '',
    `${hashtag} **CHANNELS**`,
    `${arrow} Free: ${freeCh}`,
    `${arrow} Booster: ${boostCh}`,
    `${arrow} Premium: ${premCh}`,
    '',
    `${hashtag} **COMMANDS**`,
    `${arrow} \`&fgen <service>\` · \`&bgen <service>\` · \`&pgen <service>\``,
    `${arrow} \`&stock\` · \`&cstatus\``,
    '',
    `${verified} Vouch after gen when asked. Use the right channel.`
  ].join('\n');

  return new EmbedBuilder()
    .setTitle(`${hashtag} ACCESS GUIDE`)
    .setDescription(body)
    .setColor(0x0d1117)
    .setFooter({ text: 'Ultimate Rewards · Access Guide' });
}

function tutorialEmbed(key) {
  // old free/premium/booster tutorials → single access guide
  return accessGuideEmbed(null);
}

module.exports = {
  getCfg,
  hasRequiredStatus,
  checkAndGrant,
  tutorialEmbed,
  accessGuideEmbed,
  memberStatusText
};
