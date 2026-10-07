const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const dataStore = require('../utils/data');
const { E } = require('../utils/embeds');
const brand = require('../config/brand');
const { isStaff } = require('../utils/staff');
const {
  PRODUCT_KEYS,
  resolveEmoji,
  addStock,
  takeStock,
  countStock,
  announceAdd,
  listPool,
  getData
} = require('./genStock');
const {
  hasRequiredStatus,
  checkAndGrant,
  accessGuideEmbed,
  getCfg
} = require('./statusRole');

function staffOk(member) {
  return isStaff(member) || member?.permissions?.has(PermissionFlagsBits.Administrator);
}

function poolForCmd(cmd) {
  if (cmd === 'fgen' || cmd === 'free') return 'fgen';
  if (cmd === 'bgen' || cmd === 'bosst' || cmd === 'boost') return 'bgen';
  if (cmd === 'pgen' || cmd === 'vip') return 'pgen';
  return null;
}

function resolveItemKey(raw) {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/\s+/g, '_');
  if (PRODUCT_KEYS[k]) return k === 'xboxcode' ? 'xbox_code' : k;
  // alias labels
  const hit = Object.keys(PRODUCT_KEYS).find(
    (x) => PRODUCT_KEYS[x].label.toLowerCase().replace(/\s+/g, '_') === k
  );
  return hit === 'xboxcode' ? 'xbox_code' : hit || null;
}

function stockEmbed(guild, title) {
  const free = listPool(guild, 'fgen');
  const boost = listPool(guild, 'bgen');
  const prem = listPool(guild, 'pgen');
  return new EmbedBuilder()
    .setTitle(title || 'Ultimate Rewards · Gen Stock')
    .setColor(0x001000)
    .setDescription('```Active inventory stock```')
    .addFields(
      { name: 'Freemium Vault', value: free, inline: false },
      { name: 'Booster Vault', value: boost, inline: false },
      { name: 'Premium Vault', value: prem, inline: false }
    )
    .setFooter({ text: 'Use &fgen / &bgen / &pgen <service>' });
}

async function handleGenMessage(message, client) {
  if (!message.guild || message.author.bot) return false;
  const raw = message.content.trim();
  if (!raw) return false;

  // Gen prefix: & (also . for staff add)
  let prefix = null;
  if (raw.startsWith('&')) prefix = '&';
  else if (raw.startsWith('.')) prefix = '.';
  else if (raw.startsWith(brand.PREFIX)) prefix = brand.PREFIX;
  else return false;

  const body = raw.slice(prefix.length).trim();
  const args = body.split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  if (!cmd) return false;

  const data = getData();
  const cfg = getCfg();

  // Staff: post access guide
  if (cmd === 'access' || cmd === 'genhelp' || cmd === 'guide') {
    if (!staffOk(message.member) && prefix !== '&') return true;
    // allow anyone to see guide via &access
    await message.channel.send({ embeds: [accessGuideEmbed(message.guild)] }).catch(() => {});
    return true;
  }

  // Status check
  if (cmd === 'cstatus' || cmd === 'statuscheck') {
    const ok = hasRequiredStatus(message.member);
    if (ok) {
      const r = await checkAndGrant(message.member);
      await message.reply({
        embeds: [
          E(
            'Status',
            r.granted
              ? 'Status OK — **Free gen role** given.'
              : 'Status OK — you already have access.',
            brand.green
          )
        ]
      });
    } else {
      await message.reply({
        embeds: [
          E(
            'Status',
            'Required status not found.\nSet custom status to:\n```\n' +
              (cfg.freeStatusText || 'Free G3n/Toolz at .gg/G4uywBjmgU') +
              '\n```\nThen run `&cstatus` again.',
            brand.red
          )
        ]
      });
    }
    return true;
  }

  // Unified stock
  if (cmd === 'stock' || cmd === 'fstock' || cmd === 'pstock' || cmd === 'bstock') {
    await message.reply({ embeds: [stockEmbed(message.guild)] });
    return true;
  }

  // fgen / bgen / pgen
  const pool = poolForCmd(cmd);
  if (pool) {
    // staff add
    if ((args[0] || '').toLowerCase() === 'add') {
      if (!staffOk(message.member)) {
        await message.reply('Staff only.');
        return true;
      }
      const key = resolveItemKey(args[1]);
      const rest = args.slice(2);
      if (!key || !rest.length) {
        await message.reply(
          `\`${prefix}${cmd} add <item> email:pass\`\nItems: ` +
            Object.keys(PRODUCT_KEYS)
              .filter((k) => k !== 'xboxcode' && PRODUCT_KEYS[k].vault === pool)
              .map((k) => k)
              .join(', ')
        );
        return true;
      }
      let lines = rest.map((s) => s.trim()).filter((s) => s.includes(':'));
      if (!lines.length) {
        const after = body.slice(body.toLowerCase().indexOf(args[1]) + args[1].length).trim();
        lines = after.split(/\s+/).filter((s) => s.includes(':'));
      }
      let added = 0;
      for (const line of lines) {
        const r = addStock(pool, key, line);
        if (r.ok) added++;
      }
      await announceAdd(client, pool, key, message.author.tag, added);
      await message.reply(
        `Added **${added}** to **${PRODUCT_KEYS[key]?.label || key}** (${pool}). Total: **${countStock(pool, key)}**`
      );
      return true;
    }

    // user claim
    const key = resolveItemKey(args[0]);
    if (!key) {
      await message.reply(
        `Usage: \`${prefix}${cmd} <service>\`\nCheck \`&stock\` for services.`
      );
      return true;
    }
    if (PRODUCT_KEYS[key]?.vault && PRODUCT_KEYS[key].vault !== pool) {
      await message.reply(`**${PRODUCT_KEYS[key].label}** is not in this vault. Use the correct command.`);
      return true;
    }

    // all gen tiers share one channel
    const genCh = cfg.freeChannelId || cfg.boosterChannelId || cfg.premiumChannelId;
    if (genCh && message.channel.id !== genCh) {
      await message.reply(`Use <#${genCh}> for gen commands.`);
      return true;
    }

    // roles
    if (pool === 'fgen' && cfg.freeRoleId && !message.member.roles.cache.has(cfg.freeRoleId) && !staffOk(message.member)) {
      await message.reply('No free-gen access. Set the status and run `&cstatus`.');
      return true;
    }
    if (pool === 'pgen' && cfg.premiumRoleId && !message.member.roles.cache.has(cfg.premiumRoleId) && !staffOk(message.member)) {
      await message.reply(`Premium only. DM <@${cfg.premiumSellerId}> (${cfg.premiumPrice || '$5'}).`);
      return true;
    }
    // booster: has boost or booster role
    if (pool === 'bgen' && !staffOk(message.member)) {
      const boosted = message.member.premiumSince != null;
      const hasRole = cfg.boosterRoleId && message.member.roles.cache.has(cfg.boosterRoleId);
      if (!boosted && !hasRole) {
        await message.reply('Booster gen requires a **server boost**.');
        return true;
      }
    }

    const line = takeStock(pool, key);
    if (!line) {
      await message.reply(`**${PRODUCT_KEYS[key]?.label || key}** is out of stock.`);
      return true;
    }

    const em = resolveEmoji(message.guild, key);
    const parts = line.split(':');
    const email = parts[0] || line;
    const pass = parts.slice(1).join(':') || '—';
    const vouchId = cfg.vouchUserId || '1556221818325696512';
    const vouchCh = cfg.vouchChannelId ? `<#${cfg.vouchChannelId}>` : 'vouch channel';

    const dm = new EmbedBuilder()
      .setColor(0x001000)
      .setTitle(`${em} Your account`)
      .addFields(
        { name: 'Email', value: `||\`\`${email}\`\`||`, inline: true },
        { name: 'Password', value: `||\`\`${pass}\`\`||`, inline: true },
        { name: 'Combo', value: `||\`\`\`${email}:${pass}\`\`\`||` },
        {
          name: 'Vouch',
          value: `Please vouch: \`Legit got ${PRODUCT_KEYS[key]?.label || key} by <@${vouchId}>\` in ${vouchCh}`
        }
      )
      .setFooter({ text: 'Ultimate Rewards Gen' });

    try {
      await message.author.send({ embeds: [dm] });
      await message.reply({
        embeds: [
          E(
            'Account sent',
            `${em} **${PRODUCT_KEYS[key]?.label || key}** sent to your DMs.\nVouch in ${vouchCh} or you may be blocked.`,
            brand.green
          )
        ]
      });
    } catch {
      // put back
      addStock(pool, key, line);
      await message.reply('Could not DM you. Open DMs and try again. Account was **not** taken.');
    }
    return true;
  }

  return false;
}

module.exports = { handleGenMessage };
