/**
 * -exe  — local email:pass cleaner (NO login / Microsoft checks)
 * Filters weak passwords + junk emails, strips noise, adds DashMod header.
 */
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const brand = require('../config/brand');

const CMD = new Set(['exe', 'clean', 'filter']);

// Common trash passwords (exact, lowercased)
const TRASH_PASS = new Set([
  '12345678', '123456789', '1234567890', '0123456789',
  'abcdefgh', 'abcdefghi', 'abcdefghij', 'password', 'password1',
  'qwertyui', 'qwerty123', 'iloveyou', '11111111', '00000000',
  '87654321', 'passw0rd', 'letmein1', 'welcome1', 'admin123',
  'test1234', 'abcd1234', 'aaaabbbb', 'xxxxxxxx'
]);

function isMsMailDomain(domain) {
  const d = domain.toLowerCase();
  return (
    d === 'gmail.com' ||
    d === 'googlemail.com' ||
    d === 'outlook.com' ||
    d === 'hotmail.com' ||
    d === 'live.com' ||
    d === 'msn.com' ||
    d === 'yahoo.com' ||
    d === 'yahoo.co.in' ||
    d === 'icloud.com' ||
    d === 'proton.me' ||
    d === 'protonmail.com' ||
    d.endsWith('.onmicrosoft.com')
  );
}

function looksRandomLocal(local) {
  // hdhdhsjsh / telgend style — long consonant soup or very random
  if (local.length < 3) return true;
  if (local.length >= 14 && !/[aeiou]/i.test(local.slice(0, 10))) return true;
  // high digit ratio in local part
  const digits = (local.match(/\d/g) || []).length;
  if (local.length >= 8 && digits / local.length >= 0.55) return true;
  // repeated same char
  if (/(.)\1{4,}/i.test(local)) return true;
  // keyboard smash-ish: 4+ consonants in a row
  if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(local)) return true;
  return false;
}

function isWeakPassword(pass) {
  if (!pass || pass.length < 8) return true;
  const lower = pass.toLowerCase();
  if (TRASH_PASS.has(lower)) return true;
  // only digits
  if (/^\d+$/.test(pass) && pass.length <= 12) return true;
  // only letters sequential-ish simple
  if (/^[a-z]+$/i.test(pass) && pass.length <= 10) return true;
  // repeated pattern
  if (/^(.)\1+$/.test(pass)) return true;
  if (/^(12|23|34|45|56|67|78|89|90|01){3,}$/.test(pass)) return true;
  if (/^(abc|qwe|asd|zxc){2,}/i.test(pass)) return true;
  return false;
}

function extractCombos(text) {
  const lines = String(text || []).replace(/\r/g, '').split('\n');
  const found = [];
  const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[:|;]\s*(\S+)/g;
  for (const line of lines) {
    // skip pure noise lines
    if (/got from|server name|checked by|=======|legit from/i.test(line) && !line.includes('@')) continue;
    let m;
    const l = line.trim();
    re.lastIndex = 0;
    while ((m = re.exec(l)) !== null) {
      found.push({ email: m[1].trim(), pass: m[2].trim() });
    }
    // also plain email:pass only line
    const simple = l.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[:|;]\s*(\S+)\s*$/);
    if (simple && !found.some((f) => f.email === simple[1] && f.pass === simple[2])) {
      found.push({ email: simple[1], pass: simple[2] });
    }
  }
  // dedupe by email+pass
  const seen = new Set();
  const out = [];
  for (const c of found) {
    const k = c.email.toLowerCase() + ':' + c.pass;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function filterCombos(combos) {
  const kept = [];
  let removedFormat = 0;
  let removedEmail = 0;
  let removedPass = 0;

  for (const c of combos) {
    const email = c.email;
    const pass = c.pass;
    const at = email.lastIndexOf('@');
    if (at < 1) {
      removedFormat++;
      continue;
    }
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);

    if (!domain.includes('.') || local.length < 2) {
      removedFormat++;
      continue;
    }
    if (looksRandomLocal(local)) {
      removedEmail++;
      continue;
    }
    if (isWeakPassword(pass)) {
      removedPass++;
      continue;
    }
    kept.push({ email, pass });
  }
  return { kept, removedFormat, removedEmail, removedPass };
}

function buildHeader(username) {
  return [
    '=============================',
    ' 🎉 Officially checked by DashMod',
    ' ⚡ Legit from Ultimate Rewards',
    ` 🌸 Requested by ${username}`,
    '=============================',
    ''
  ].join('\n');
}

function buildBody(kept) {
  return kept.map((c) => `${c.email}:${c.pass}`).join('\n');
}

async function readAttachmentText(attachment) {
  if (!attachment) return null;
  const name = (attachment.name || '').toLowerCase();
  if (attachment.size > 2 * 1024 * 1024) return null; // 2MB cap
  // allow txt/any small file
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function handleExeMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const prefix = brand.PREFIX || '-';
  if (!message.content.startsWith(prefix) && !message.attachments.size) return false;

  const raw = message.content.startsWith(prefix)
    ? message.content.slice(prefix.length).trim()
    : '';
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  if (!CMD.has(cmd)) return false;

  const rest = parts.slice(1).join(' ').trim();
  let sourceText = rest;

  // Attachments
  if (message.attachments.size) {
    const att = message.attachments.find((a) => {
      const n = (a.name || '').toLowerCase();
      return n.endsWith('.txt') || n.endsWith('.csv') || n.endsWith('.log') || !n.includes('.') || a.contentType?.startsWith('text');
    }) || message.attachments.first();
    const attText = await readAttachmentText(att);
    if (attText) sourceText = (sourceText ? sourceText + '\n' : '') + attText;
  }

  if (!sourceText || !sourceText.includes('@')) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.gold || 0xf1c40f)
          .setTitle('🧹 exe · cleaner')
          .setDescription(
            [
              `Usage: \`${prefix}exe email:pass\``,
              `Or: \`${prefix}exe\` + attach a \`.txt\` file`,
              'Multiple `email:pass` lines supported.',
              '',
              '_Local filter only — no login checks._'
            ].join('\n')
          )
          .setFooter({ text: 'Powered by Ultimate Rewards' })
      ]
    }).catch(() => {});
    return true;
  }

  const combos = extractCombos(sourceText);
  const { kept, removedFormat, removedEmail, removedPass } = filterCombos(combos);
  const removedTotal = combos.length - kept.length;
  const username = message.member?.displayName || message.author.username;

  const header = buildHeader(username);
  const body = buildBody(kept);
  const fileContent = header + (body || '(none kept)') + '\n';

  const embed = new EmbedBuilder()
    .setColor(brand.green || 0x2ecc71)
    .setTitle('✨ DashMod · exe clean')
    .setDescription(
      [
        `**📥 Checked** : **${combos.length}**`,
        `**🗑️ Removed** : **${removedTotal}**`,
        `**✅ Kept** : **${kept.length}**`,
        '',
        `• Weak / short pass → **${removedPass}**`,
        `• Junk-looking email → **${removedEmail}**`,
        `• Bad format → **${removedFormat}**`,
        '',
        '_I couldn\'t fetch any proxy so DashWho did manually._'
      ].join('\n')
    )
    .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
    .setTimestamp();

  // File input → return .txt; pure text also attach if many lines
  const useFile = message.attachments.size > 0 || kept.length > 8 || fileContent.length > 1500;

  if (useFile) {
    const file = new AttachmentBuilder(Buffer.from(fileContent, 'utf8'), {
      name: 'dashmod-checked.txt'
    });
    await message.reply({ embeds: [embed], files: [file] }).catch(() => {});
  } else if (kept.length) {
    embed.addFields({
      name: '📋 Result',
      value: '```\n' + body.slice(0, 1000) + (body.length > 1000 ? '\n…' : '') + '\n```'
    });
    await message.reply({ embeds: [embed] }).catch(() => {});
  } else {
    embed.setColor(brand.red || 0xe74c3c);
    await message.reply({ embeds: [embed] }).catch(() => {});
  }

  return true;
}

module.exports = { handleExeMessage };
