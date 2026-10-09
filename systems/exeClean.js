/**
 * -exe  — local email:pass cleaner (NO login checks)
 * Filters weak passwords + junk emails, strips noise, adds DashMod header.
 */
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const brand = require('../config/brand');

const CMD = new Set(['exe', 'clean', 'filter']);
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

const TRASH_PASS = new Set([
  '12345678', '123456789', '1234567890', '0123456789',
  'abcdefgh', 'abcdefghi', 'abcdefghij', 'password', 'password1',
  'qwertyui', 'qwerty123', 'iloveyou', '11111111', '00000000',
  '87654321', 'passw0rd', 'letmein1', 'welcome1', 'admin123',
  'test1234', 'abcd1234', 'aaaabbbb', 'xxxxxxxx'
]);

function looksRandomLocal(local) {
  if (local.length < 3) return true;
  if (local.length >= 14 && !/[aeiou]/i.test(local.slice(0, 10))) return true;
  const digits = (local.match(/\d/g) || []).length;
  if (local.length >= 8 && digits / local.length >= 0.55) return true;
  if (/(.)\1{4,}/i.test(local)) return true;
  if (/[bcdfghjklmnpqrstvwxyz]{6,}/i.test(local)) return true;
  return false;
}

function isWeakPassword(pass) {
  if (!pass || pass.length < 8) return true;
  const lower = pass.toLowerCase();
  if (TRASH_PASS.has(lower)) return true;
  if (/^\d+$/.test(pass) && pass.length <= 12) return true;
  if (/^[a-z]+$/i.test(pass) && pass.length <= 10) return true;
  if (/^(.)\1+$/.test(pass)) return true;
  if (/^(12|23|34|45|56|67|78|89|90|01){3,}$/.test(pass)) return true;
  if (/^(abc|qwe|asd|zxc){2,}/i.test(pass)) return true;
  return false;
}

function extractCombos(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const found = [];
  const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[:|;]\s*(\S+)/g;
  for (const line of lines) {
    if (/got from|server name|checked by|=======|legit from/i.test(line) && !line.includes('@')) continue;
    let m;
    const l = line.trim();
    re.lastIndex = 0;
    while ((m = re.exec(l)) !== null) {
      found.push({ email: m[1].trim(), pass: m[2].trim() });
    }
    const simple = l.match(/^([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[:|;]\s*(\S+)\s*$/);
    if (simple && !found.some((f) => f.email === simple[1] && f.pass === simple[2])) {
      found.push({ email: simple[1], pass: simple[2] });
    }
  }
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
  if (!attachment) return { error: 'no_file' };
  if (attachment.size > MAX_FILE_BYTES) {
    return { error: 'too_big', size: attachment.size };
  }
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return { error: 'fetch_fail' };
    const text = await res.text();
    return { text };
  } catch {
    return { error: 'fetch_fail' };
  }
}

async function handleExeMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const prefix = brand.PREFIX || '-';
  if (!message.content.startsWith(prefix)) return false;

  const raw = message.content.slice(prefix.length).trim();
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  if (!CMD.has(cmd)) return false;

  const rest = parts.slice(1).join(' ').trim();
  let sourceText = rest;
  let fileError = null;

  if (message.attachments.size) {
    const att =
      message.attachments.find((a) => {
        const n = (a.name || '').toLowerCase();
        return (
          n.endsWith('.txt') ||
          n.endsWith('.csv') ||
          n.endsWith('.log') ||
          !n.includes('.') ||
          (a.contentType && a.contentType.startsWith('text'))
        );
      }) || message.attachments.first();

    const result = await readAttachmentText(att);
    if (result.text) {
      sourceText = (sourceText ? sourceText + '\n' : '') + result.text;
    } else {
      fileError = result.error;
      if (result.size) fileError = 'too_big:' + result.size;
    }
  }

  if (fileError && !sourceText.includes('@')) {
    const mb = fileError.startsWith('too_big:')
      ? (Number(fileError.split(':')[1]) / (1024 * 1024)).toFixed(1)
      : null;
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.red || 0xe74c3c)
            .setTitle('🧹 exe · file error')
            .setDescription(
              mb
                ? `File is **${mb} MB**. Max is **15 MB**.\nSplit the file and try again.`
                : 'Could not read the attachment. Use a `.txt` file.'
            )
            .setFooter({ text: 'Powered by Ultimate Rewards' })
        ]
      })
      .catch(() => {});
    return true;
  }

  if (!sourceText || !sourceText.includes('@')) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.gold || 0xf1c40f)
            .setTitle('🧹 exe · cleaner')
            .setDescription(
              [
                `Usage: \`${prefix}exe email:pass\``,
                `Or: \`${prefix}exe\` + attach a \`.txt\` file`,
                'Multiple `email:pass` lines supported.'
              ].join('\n')
            )
            .setFooter({ text: 'Powered by Ultimate Rewards' })
        ]
      })
      .catch(() => {});
    return true;
  }

  // Big files: show processing
  let statusMsg = null;
  if (sourceText.length > 200000) {
    statusMsg = await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.blurple || 0x5865f2)
            .setTitle('⏳ Processing...')
            .setDescription('Large file detected. Cleaning now, please wait…')
        ]
      })
      .catch(() => null);
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
        `• Bad format → **${removedFormat}**`
      ].join('\n')
    )
    .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
    .setTimestamp();

  const useFile =
    message.attachments.size > 0 || kept.length > 8 || fileContent.length > 1500;

  if (useFile) {
    const file = new AttachmentBuilder(Buffer.from(fileContent, 'utf8'), {
      name: 'dashmod-checked.txt'
    });
    if (statusMsg) {
      await statusMsg.edit({ embeds: [embed], files: [file] }).catch(async () => {
        await message.channel.send({ embeds: [embed], files: [file] }).catch(() => {});
      });
    } else {
      await message.reply({ embeds: [embed], files: [file] }).catch(() => {});
    }
  } else if (kept.length) {
    embed.addFields({
      name: '📋 Result',
      value:
        '```\n' +
        body.slice(0, 1000) +
        (body.length > 1000 ? '\n…' : '') +
        '\n```'
    });
    if (statusMsg) await statusMsg.edit({ embeds: [embed] }).catch(() => {});
    else await message.reply({ embeds: [embed] }).catch(() => {});
  } else {
    embed.setColor(brand.red || 0xe74c3c);
    if (statusMsg) await statusMsg.edit({ embeds: [embed] }).catch(() => {});
    else await message.reply({ embeds: [embed] }).catch(() => {});
  }

  return true;
}

module.exports = { handleExeMessage };
