/**
 * Ultimate Rewards — Ticket + Paid Purchase system
 * NEW FILE ONLY — drop into systems/tickets.js
 * Then wire it in index.js (see INSTALL.txt)
 *
 * Features:
 * - Ticket panel (support / claim / purchase paid / help)
 * - Category: 1553617799975403673
 * - On channel create / rename starting with "purchase" → priority embed
 * - Reply "@bot I am here..." → generate 15-digit one-time redeem code
 * - Close button with confirm → deletes channel exactly on confirm
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const fs = require('fs');
const path = require('path');

// ── Config (override with env) ──
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID || '1553617799975403673';
const PURCHASE_NOTIFY_CHANNEL = process.env.PURCHASE_NOTIFY_CHANNEL || '1553617843046842388';
const PRIORITY_USER_ID = process.env.PRIORITY_USER_ID || '1080190046138802306';
const PRIORITY_ROLE_ID = process.env.PRIORITY_ROLE_ID || '1547183159794204675';
const TICKET_SUPPORT_ROLE_ID = process.env.TICKET_SUPPORT_ROLE_ID || PRIORITY_ROLE_ID || '1547183159794204675';
const REDEEM_BASE_URL = process.env.REDEEM_BASE_URL || process.env.ULTIMATE_WEB || 'https://ultimate-rewards.onrender.com';
const REDEEM_SECRET = process.env.REDEEM_SECRET || 'ultimate-redeem-secret-change-me';
const REDEEM_CODES_FILE = path.join(__dirname, '..', 'data', 'redeem-codes.json');

// Ensure data dir
const dataDir = path.dirname(REDEEM_CODES_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadCodes() {
  try {
    if (fs.existsSync(REDEEM_CODES_FILE)) return JSON.parse(fs.readFileSync(REDEEM_CODES_FILE, 'utf8'));
  } catch {}
  return { codes: {} };
}
function saveCodes(data) {
  fs.writeFileSync(REDEEM_CODES_FILE, JSON.stringify(data, null, 2));
}

// Format like: ZH26637FDHHS5638 (16 chars, A-Z + 0-9)
function randomCode(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/** Register code on the website so redeem works across separate Render services */
async function registerCodeOnWebsite(code, staffId, channelId) {
  const base = (REDEEM_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    console.warn('[tickets] REDEEM_BASE_URL not set — website will not know this code');
    return false;
  }
  try {
    const res = await fetch(base + '/api/redeem/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-redeem-secret': REDEEM_SECRET
      },
      body: JSON.stringify({
        code,
        createdBy: staffId,
        channelId,
        secret: REDEEM_SECRET
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[tickets] register code failed', res.status, t);
      return false;
    }
    console.log('[tickets] code registered on website', code);
    return true;
  } catch (e) {
    console.error('[tickets] register code error', e.message);
    return false;
  }
}

async function makeCode(staffId, channelId) {
  const data = loadCodes();
  let code;
  do { code = randomCode(16); } while (data.codes[code]);
  data.codes[code] = {
    code,
    createdBy: staffId,
    channelId,
    createdAt: new Date().toISOString(),
    used: false,
    usedBy: null,
    usedAt: null,
    type: null
  };
  saveCodes(data);
  // Push to website (required — bot & site don't share disk)
  await registerCodeOnWebsite(code, staffId, channelId);
  return code;
}

/** Public: check + mark used (called from website /api/redeem) */
function useCode(code, userId, type) {
  const data = loadCodes();
  const entry = data.codes[code];
  if (!entry) return { ok: false, error: 'Invalid code' };
  if (entry.used) return { ok: false, error: 'Code already used' };
  entry.used = true;
  entry.usedBy = userId;
  entry.usedAt = new Date().toISOString();
  entry.type = type || null;
  saveCodes(data);
  return { ok: true, entry };
}

function isPurchaseChannel(name) {
  return /^purchase/i.test((name || '').trim());
}

// ── Ticket Panel ──
async function sendTicketPanel(channel, imageUrl, customDesc) {
  const defaultDesc = [
    '**OPEN A TICKET · GET HELP · WE\'RE HERE**',
    '',
    'Choose a category below. Only **you** and support staff can see the ticket.',
    '',
    '🛡 **False Moderation** — unfair mute / ban / timeout',
    '🎧 **Help** — general support',
    '💬 **Discord Account Issues** — login / account problems'
  ].join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎫 ULTIMATE REWARDS · TICKETS')
    .setDescription(customDesc || defaultDesc)
    .setFooter({ text: 'Ultimate Rewards · Staff Ticket System' });

  if (imageUrl) embed.setImage(imageUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_false_mod').setLabel('False Moderation').setStyle(ButtonStyle.Danger).setEmoji('🛡️'),
    new ButtonBuilder().setCustomId('ticket_help').setLabel('Help').setStyle(ButtonStyle.Primary).setEmoji('🎧'),
    new ButtonBuilder().setCustomId('ticket_discord').setLabel('Discord Account Issues').setStyle(ButtonStyle.Secondary).setEmoji('💬')
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function createTicketChannel(guild, user, type) {
  const typeLabels = {
    false_mod: 'false-mod',
    help: 'help',
    discord: 'discord-issues',
    // legacy
    support: 'support',
    claim: 'claim',
    purchase: 'purchase-paid'
  };
  const label = typeLabels[type] || 'ticket';
  const name = `${label}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    }
  ];

  // Support role only (or above via Discord hierarchy for manage)
  if (TICKET_SUPPORT_ROLE_ID && guild.roles.cache.has(TICKET_SUPPORT_ROLE_ID)) {
    overwrites.push({
      id: TICKET_SUPPORT_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  // Bot needs access
  if (guild.members.me) {
    overwrites.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    });
  }

  // Resolve category (invalid ID is a common fail)
  let parentId = undefined;
  if (TICKET_CATEGORY_ID) {
    try {
      const parent = await guild.channels.fetch(TICKET_CATEGORY_ID).catch(() => null);
      if (parent && parent.type === ChannelType.GuildCategory) {
        parentId = parent.id;
      } else {
        console.warn('[tickets] TICKET_CATEGORY_ID is not a category or missing:', TICKET_CATEGORY_ID);
      }
    } catch (e) {
      console.warn('[tickets] category fetch', e.message);
    }
  }

  let ch;
  const topic = `Ticket for ${user.username || user.tag || user.id} (${user.id}) · type:${type}`;
  const createOpts = {
    name: name || `ticket-${user.id}`.slice(0, 90),
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
    topic
  };

  try {
    ch = await guild.channels.create({ ...createOpts, parent: parentId });
  } catch (e1) {
    console.error('[tickets] create with parent failed:', e1.message);
    // Retry without category
    try {
      ch = await guild.channels.create(createOpts);
      console.warn('[tickets] created ticket without category');
    } catch (e2) {
      console.error('[tickets] create without parent failed:', e2.message);
      throw new Error(e2.message || e1.message || 'channel create failed');
    }
  }

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );

  const welcome = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`Ticket · ${label}`)
    .setDescription(
      `Hello <@${user.id}>!\n\nSupport staff will help you soon.\n\nType: **${label}**\n\nOnly you + support can see this channel.`
    )
    .setFooter({ text: 'Click Close Ticket when finished' });

  await ch.send({
    content: `<@${user.id}>${TICKET_SUPPORT_ROLE_ID ? ` · <@&${TICKET_SUPPORT_ROLE_ID}>` : ''}`,
    embeds: [welcome],
    components: [closeRow]
  });

  if (type === 'purchase') {
    await notifyPurchase(ch, user);
  }

  return ch;
}

async function notifyPurchase(channel, user) {
  const onlinePriority = PRIORITY_ROLE_ID ? `<@&${PRIORITY_ROLE_ID}>` : '';
  const priorityUser = PRIORITY_USER_ID ? `<@${PRIORITY_USER_ID}>` : '';

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('💳 Paid Purchase Ticket')
    .setDescription(
      `Sir ${onlinePriority} ${priorityUser}\n\n` +
      `<@${user.id}> needs a **paid purchase**.\n\n` +
      `Channel: ${channel}\n` +
      `Reply in this ticket with:\n\`@${channel.client.user.username} I am here...\`\n` +
      `to generate a one-time 15-digit redeem code.`
    )
    .setTimestamp();

  // Prefer the dedicated notify channel, else post in the ticket
  try {
    const notifyCh = await channel.client.channels.fetch(PURCHASE_NOTIFY_CHANNEL).catch(() => null);
    if (notifyCh) {
      await notifyCh.send({ content: `${onlinePriority} ${priorityUser}`, embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch {
    await channel.send({ embeds: [embed] });
  }
}

// ── Event handlers to register ──
function registerTicketSystem(client) {
  // Channel create / update (rename)
  client.on('channelCreate', async (channel) => {
    if (!channel.guild || channel.type !== ChannelType.GuildText) return;
    if (isPurchaseChannel(channel.name)) {
      // Try to find the user from topic or first mention later
      setTimeout(async () => {
        try {
          const topic = channel.topic || '';
          const match = topic.match(/\((\d{15,20})\)/);
          const userId = match ? match[1] : null;
          const user = userId ? await client.users.fetch(userId).catch(() => null) : null;
          if (user) await notifyPurchase(channel, user);
          else {
            // Generic notify
            const onlinePriority = PRIORITY_ROLE_ID ? `<@&${PRIORITY_ROLE_ID}>` : '';
            const priorityUser = PRIORITY_USER_ID ? `<@${PRIORITY_USER_ID}>` : '';
            const embed = new EmbedBuilder()
              .setColor(0xe74c3c)
              .setTitle('💳 Paid Purchase Ticket (detected)')
              .setDescription(`Sir ${onlinePriority} ${priorityUser}\n\nA channel named **${channel.name}** was created.\nSomeone needs a paid purchase.`);
            const notifyCh = await client.channels.fetch(PURCHASE_NOTIFY_CHANNEL).catch(() => null);
            if (notifyCh) await notifyCh.send({ content: `${onlinePriority} ${priorityUser}`, embeds: [embed] });
          }
        } catch (e) {
          console.error('[tickets] channelCreate', e.message);
        }
      }, 1500);
    }
  });

  client.on('channelUpdate', async (oldCh, newCh) => {
    if (!newCh.guild || newCh.type !== ChannelType.GuildText) return;
    if (!isPurchaseChannel(oldCh.name) && isPurchaseChannel(newCh.name)) {
      // Renamed TO purchase*
      try {
        const topic = newCh.topic || '';
        const match = topic.match(/\((\d{15,20})\)/);
        const userId = match ? match[1] : null;
        const user = userId ? await client.users.fetch(userId).catch(() => null) : { id: '0', tag: 'Unknown' };
        await notifyPurchase(newCh, user);
      } catch (e) {
        console.error('[tickets] channelUpdate', e.message);
      }
    }
  });

  // Buttons + message for "I am here"
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // Create ticket buttons
    if (interaction.isButton() && interaction.customId.startsWith('ticket_')) {
      const type = interaction.customId.replace('ticket_', '');
      if (['false_mod', 'help', 'discord', 'support', 'claim', 'purchase'].includes(type)) {
        await interaction.deferReply({ ephemeral: true });
        try {
          // Prevent duplicate open tickets of same type
          const existing = interaction.guild.channels.cache.find(
            c => c.topic && c.topic.includes(interaction.user.id) && c.topic.includes(`type:${type}`)
          );
          if (existing) {
            return interaction.editReply({ content: `You already have an open ticket: ${existing}` });
          }
          const ch = await createTicketChannel(interaction.guild, interaction.user, type);
          await interaction.editReply({ content: `Ticket created: ${ch}` });
        } catch (e) {
          console.error(e);
          await interaction.editReply({
            content:
              'Failed to create ticket: `' + (e.message || 'unknown') + '`\n' +
              'Need **Manage Channels**. Set `TICKET_CATEGORY_ID` to a valid **category** ID (or leave empty).'
          });
        }
        return;
      }

      // Close button
      if (interaction.customId === 'ticket_close') {
        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_close_confirm').setLabel('Yes, delete channel').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket_close_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({
          content: '⚠️ **Confirm close** — this will **delete** the channel permanently.',
          components: [confirmRow],
          ephemeral: true
        });
        return;
      }

      if (interaction.customId === 'ticket_close_cancel') {
        await interaction.update({ content: 'Close cancelled.', components: [] });
        return;
      }

      if (interaction.customId === 'ticket_close_confirm') {
        await interaction.update({ content: 'Closing & deleting channel…', components: [] });
        try {
          await interaction.channel.delete('Ticket closed by user/staff');
        } catch (e) {
          await interaction.followUp({ content: 'Could not delete channel (missing permission).', ephemeral: true });
        }
        return;
      }
    }
  });

  // Message: "@bot I am here..."
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.mentions.has(client.user)) return;
    const content = message.content.toLowerCase();
    if (!content.includes('i am here') && !content.includes("i'm here") && !content.includes('im here')) return;

    // Must be in a ticket-like channel
    const n = (message.channel.name || '').toLowerCase();
    const isTicket =
      n.includes('purchase') ||
      n.includes('help') ||
      n.includes('claim') ||
      n.includes('false-mod') ||
      n.includes('discord-issues') ||
      n.includes('support') ||
      (message.channel.topic && /ticket/i.test(message.channel.topic));
    if (!isTicket) return;

    // Optional: staff only
    try {
      const { isStaff } = require('../utils/staff');
      if (!isStaff(message.member)) {
        return message.reply({ content: 'Only staff can generate redeem codes.' });
      }
    } catch {}

    const code = await makeCode(message.author.id, message.channel.id);
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('🔑 One-time Redeem Code Generated')
      .setDescription(
        [
          `**Your redeem code:** ***${code}***`,
          `**Redeem on:** ***Web***`,
          `${REDEEM_BASE_URL}`,
          '',
          'Sir, thank you for using our services.',
          '• One-time · website only'
        ].join('\n')
      )
      .setFooter({ text: 'Ultimate Rewards · Paid Purchase' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  });
}

// Prefix command helper:
// -ticketpanel
// -ticketpanel https://image.url
// -ticketpanel (with image attached)
// -ticketpanel optional description text (with or without image)
async function handleTicketPanelCommand(message, args) {
  // 1) Image from attachment (Discord upload)
  let image = null;
  if (message.attachments && message.attachments.size > 0) {
    const att = message.attachments.find(a => a.contentType && a.contentType.startsWith('image/'))
             || message.attachments.first();
    if (att) image = att.url;
  }

  // 2) Image from URL argument
  if (!image) {
    const urlArg = args.find(a => a.startsWith('http'));
    if (urlArg) image = urlArg;
  }

  // Optional description (everything that is not a URL)
  const descParts = args.filter(a => !a.startsWith('http'));
  const customDesc = descParts.length ? descParts.join(' ') : null;

  await sendTicketPanel(message.channel, image, customDesc);
  await message.reply({ content: 'Ticket panel posted.' }).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
}



/**
 * -paid <item name>
 * Staff only — one-time website redeem code (no  path).
 */
async function handlePaidCommand(message, args) {
  try {
    const { isStaff } = require('../utils/staff');
    if (!isStaff(message.member)) {
      return message.reply({ content: 'Staff only.' });
    }
  } catch {
    if (!message.member?.permissions?.has?.('Administrator')) {
      return message.reply({ content: 'Staff only.' });
    }
  }

  const item = (args || []).join(' ').trim();
  if (!item) {
    return message.reply({ content: '`-paid <item name>`\nExample: `-paid Minecraft MCFA`' });
  }

  const code = await makeCode(message.author.id, message.channel.id);
  const site = (REDEEM_BASE_URL || '').replace(/\/$/, '') || 'our website';

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`# ${item.toUpperCase()}`)
    .setDescription(
      [
        `**Your redeem code:** ***${code}***`,
        `**Redeem on:** ***Web***`,
        site,
        '',
        'Sir, thank you for using our services.'
      ].join('\n')
    )
    .setFooter({ text: 'Ultimate Rewards · Paid' })
    .setTimestamp();

  await message.channel.send({ embeds: [embed] });
}

/** Staff: list open ticket-like channels */
async function handleTicketManageCommand(message) {
  try {
    const { isStaff } = require('../utils/staff');
    if (!isStaff(message.member)) return message.reply({ content: 'Staff only.' });
  } catch {
    if (!message.member?.permissions?.has?.('Administrator')) {
      return message.reply({ content: 'Staff only.' });
    }
  }

  const catId = TICKET_CATEGORY_ID;
  const channels = message.guild.channels.cache.filter(
    (c) =>
      c.type === ChannelType.GuildText &&
      (c.parentId === catId ||
        /help|claim|purchase|false-mod|discord|support|ticket/i.test(c.name || ''))
  );

  const list = [...channels.values()]
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    .slice(0, 25)
    .map((c, i) => `\`${i + 1}.\` ${c} — \`${c.name}\``)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle('🎫 Staff · Ticket management')
    .setDescription(list || '_No open ticket-like channels found._')
    .setFooter({ text: 'Close tickets with the Close button inside the channel' })
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

module.exports = {
  registerTicketSystem,
  sendTicketPanel,
  handleTicketPanelCommand,
  handlePaidCommand,
  handleTicketManageCommand,
  useCode,
  makeCode,
  loadCodes
};
