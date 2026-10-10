/**
 * -psd email:username (multiple) or attach file
 * Deletes user message → processing → result
 * Old username derived from email local-part + letters/digits
 */
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const brand = require('../config/brand');

const CMD = new Set(['psd', 'userchange', 'uname']);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function randomLetters(n) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Old username based on email, e.g. name@outlook.com → name846273 or name846273x */
function oldUsernameFromEmail(email) {
  const local = String(email || '').split('@')[0] || 'user';
  // keep letters/numbers only from local part
  let base = local.replace(/[^a-zA-Z0-9]/g, '');
  if (!base) base = 'user';
  // mix digits + at least one letter suffix sometimes
  const digits = randomDigits(5 + Math.floor(Math.random() * 3)); // 5-7 digits
  const letterBit = Math.random() < 0.55 ? randomLetters(1 + Math.floor(Math.random() * 2)) : '';
  // styles: name846273 | name846273x | name846273-ab
  const styles = [
    () => base + digits,
    () => base + digits + letterBit,
    () => base + digits + (letterBit ? '-' + letterBit : randomLetters(2))
  ];
  return styles[Math.floor(Math.random() * styles.length)]().slice(0, 32);
}

function parsePairs(text) {
  const out = [];
  const seen = new Set();
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const rePair = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[:|;]\s*([^\s|:;]+)/g;
  const reEmail = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

  for (const line of lines) {
    if (/got from|server name|=======|checked by/i.test(line) && !line.includes('@')) continue;
    let matched = false;
    rePair.lastIndex = 0;
    let m;
    while ((m = rePair.exec(line)) !== null) {
      matched = true;
      const email = m[1].trim();
      const username = m[2].trim();
      const k = email.toLowerCase() + ':' + username;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ email, username });
    }
    if (!matched) {
      reEmail.lastIndex = 0;
      while ((m = reEmail.exec(line)) !== null) {
        const email = m[1].trim();
        const local = email.split('@')[0] || randomDigits(8);
        const k = email.toLowerCase() + ':' + local;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ email, username: local });
      }
    }
  }
  return out;
}

async function readAtt(att) {
  if (!att) return { error: 'no_file' };
  if (att.size > MAX_FILE_BYTES) return { error: 'too_big', size: att.size };
  try {
    const res = await fetch(att.url);
    if (!res.ok) return { error: 'fetch_fail' };
    return { text: await res.text() };
  } catch {
    return { error: 'fetch_fail' };
  }
}

async function handlePsdMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const prefix = brand.PREFIX || '-';
  if (!message.content.startsWith(prefix)) return false;

  const raw = message.content.slice(prefix.length).trim();
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  if (!CMD.has(cmd)) return false;

  let source = parts.slice(1).join(' ').trim();
  let fileError = null;

  if (message.attachments.size) {
    const att = message.attachments.first();
    const r = await readAtt(att);
    if (r.text) source = (source ? source + '\n' : '') + r.text;
    else fileError = r.error === 'too_big' ? 'too_big:' + r.size : r.error;
  }

  if (fileError && !source.includes('@')) {
    const mb = fileError.startsWith('too_big:')
      ? (Number(fileError.split(':')[1]) / (1024 * 1024)).toFixed(1)
      : null;
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.red || 0xe74c3c)
            .setTitle('🔄 psd · file error')
            .setDescription(
              mb
                ? `File is **${mb} MB**. Max is **15 MB**.`
                : 'Could not read the attachment.'
            )
            .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
        ]
      })
      .catch(() => {});
    return true;
  }

  const pairs = parsePairs(source);
  if (!pairs.length) {
    await message
      .reply({
        embeds: [
          new EmbedBuilder()
            .setColor(brand.gold || 0xf1c40f)
            .setTitle('🔄 psd · username display')
            .setDescription(
              [
                `Usage: \`${prefix}psd email:username\``,
                `Or email only: \`${prefix}psd name@outlook.com\``,
                `Multiple: \`${prefix}psd a@x.com:user1 b@y.com:user2\``,
                `Or: \`${prefix}psd\` + attach \`.txt\``
              ].join('\n')
            )
            .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
        ]
      })
      .catch(() => {});
    return true;
  }

  // Delete user command message immediately
  await message.delete().catch(() => {});

  const waitMs = 15000 + Math.floor(Math.random() * 4000);
  const processing = await message.channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.blurple || 0x5865f2)
          .setTitle('⏳ Process is being done...')
          .setDescription(
            `Working on **${pairs.length}** entr${pairs.length === 1 ? 'y' : 'ies'}.\nPlease wait…`
          )
          .setFooter({ text: 'DashMod' })
      ]
    })
    .catch(() => null);

  await new Promise((r) => setTimeout(r, waitMs));

  const blocks = pairs.map((p) => {
    const oldUser = oldUsernameFromEmail(p.email);
    return [
      `📧 **Email** : \`${p.email}\``,
      `👤 **Password** : \`${oldUser}\``,
      `✨ ***New password*** : \`${p.username}\``
    ].join('\n');
  });

  const cry = (() => {
    const g = message.guild;
    if (!g?.emojis?.cache) return '😢';
    const hit =
      g.emojis.cache.find((e) => e.name === 'cry') ||
      g.emojis.cache.find((e) => e.name?.toLowerCase() === 'cry');
    return hit ? hit.toString() : '😢';
  })();

  const embed = new EmbedBuilder()
    .setColor(brand.green || 0x2ecc71)
    .setTitle('✅ Process complete')
    .setDescription(
      (blocks.join('\n\n') + '\n\n***' + cry + ' maybe... I fill fake information***').slice(0, 3900)
    )
    .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
    .setTimestamp();

  if (processing) {
    await processing.edit({ embeds: [embed] }).catch(async () => {
      await message.channel.send({ embeds: [embed] }).catch(() => {});
    });
  } else {
    await message.channel.send({ embeds: [embed] }).catch(() => {});
  }

  if (pairs.length > 5) {
    const lines = pairs.map((p) => {
      const oldUser = oldUsernameFromEmail(p.email);
      return `Email: ${p.email}\nUsername: ${oldUser}\nNew username: ${p.username}\n`;
    });
    const file = new AttachmentBuilder(
      Buffer.from(
        '=============================\n🎉 DashMod psd result\n⚡ Ultimate Rewards\n=============================\n\n' +
          lines.join('\n'),
        'utf8'
      ),
      { name: 'psd-result.txt' }
    );
    await message.channel.send({ files: [file] }).catch(() => {});
  }

  return true;
}

module.exports = { handlePsdMessage, oldUsernameFromEmail };
  
