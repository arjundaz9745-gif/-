/**
 * -psd email:username (multiple) or attach file
 * Display-only: delete user msg → "Process is being done..." → results
 */
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const brand = require('../config/brand');

const CMD = new Set(['psd', 'userchange', 'uname']);

function random8() {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function parsePairs(text) {
  const out = [];
  const seen = new Set();
  const re = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*[:|;]\s*([^\s|:;]+)/g;
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  for (const line of lines) {
    if (/got from|server name|=======|checked by/i.test(line) && !line.includes('@')) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const email = m[1].trim();
      const username = m[2].trim();
      const k = email.toLowerCase() + ':' + username;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ email, username });
    }
  }
  return out;
}

async function readAtt(att) {
  if (!att || att.size > 2 * 1024 * 1024) return null;
  try {
    const res = await fetch(att.url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<boolean>}
 */
async function handlePsdMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const prefix = brand.PREFIX || '-';
  if (!message.content.startsWith(prefix)) return false;

  const raw = message.content.slice(prefix.length).trim();
  const parts = raw.split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  if (!CMD.has(cmd)) return false;

  let source = parts.slice(1).join(' ').trim();
  if (message.attachments.size) {
    const att = message.attachments.first();
    const t = await readAtt(att);
    if (t) source = (source ? source + '\n' : '') + t;
  }

  const pairs = parsePairs(source);
  if (!pairs.length) {
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.gold || 0xf1c40f)
          .setTitle('🔄 psd · username display')
          .setDescription(
            [
              `Usage: \`${prefix}psd email:username\``,
              `Multiple: \`${prefix}psd a@x.com:user1 b@y.com:user2\``,
              `Or: \`${prefix}psd\` + attach \`.txt\``,
              '',
              '_Display only — nothing is changed on any account._'
            ].join('\n')
          )
          .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
      ]
    }).catch(() => {});
    return true;
  }

  // Delete user message on the spot
  await message.delete().catch(() => {});

  const waitMs = 15000 + Math.floor(Math.random() * 4000); // 15–19s
  const processing = await message.channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(brand.blurple || 0x5865f2)
          .setTitle('⏳ Process is being done...')
          .setDescription(`Working on **${pairs.length}** entr${pairs.length === 1 ? 'y' : 'ies'}.\nPlease wait…`)
          .setFooter({ text: 'DashMod' })
      ]
    })
    .catch(() => null);

  await new Promise((r) => setTimeout(r, waitMs));

  const blocks = pairs.map((p) => {
    const oldUser = random8();
    return [
      `📧 **Email** : \`${p.email}\``,
      `👤 **Password** : \`${oldUser}\``,
      `✨ **New Password** : \`${p.username}\``
    ].join('\n');
  });

  const desc =
    blocks.join('\n\n') +
    '\n\n***sir, i may contain fake informations but trust me :lol:.***';

  const embed = new EmbedBuilder()
    .setColor(brand.green || 0x2ecc71)
    .setTitle('✅ Process complete')
    .setDescription(desc.slice(0, 3900))
    .setFooter({ text: 'Powered by Ultimate Rewards · DashMod' })
    .setTimestamp();

  if (processing) {
    await processing.edit({ embeds: [embed] }).catch(async () => {
      await message.channel.send({ embeds: [embed] }).catch(() => {});
    });
  } else {
    await message.channel.send({ embeds: [embed] }).catch(() => {});
  }

  // If many entries, also attach txt
  if (pairs.length > 5) {
    const lines = pairs.map((p) => {
      const oldUser = random8();
      return `Email: ${p.email}\nUsername: ${oldUser}\nNew username: ${p.username}\n`;
    });
    const file = new AttachmentBuilder(
      Buffer.from(
        '=============================\n🎉 DashMod psd result\n⚡ Ultimate Rewards\n=============================\n\n' +
          lines.join('\n') +
          '\nsir, i may contain fake informations but trust me :lol:.\n',
        'utf8'
      ),
      { name: 'psd-result.txt' }
    );
    await message.channel.send({ files: [file] }).catch(() => {});
  }

  return true;
}

module.exports = { handlePsdMessage };
    
