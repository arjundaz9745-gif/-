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
const PRIORITY_ROLE_ID = process.env.PRIORITY_ROLE_ID || '1547183159794204675'; // OWNER role from your roles.js
const REDEEM_BASE_URL = process.env.REDEEM_BASE_URL || process.env.ULTIMATE_WEB || 'https://ultimate-rewards.onrender.com';
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

function random15() {
  let s = '';
  for (let i = 0; i < 15; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function makeCode(staffId, channelId) {
  const data = loadCodes();
  let code;
  do { code = random15(); } while (data.codes[code]);
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
async function sendTicketPanel(channel, imageUrl) {
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle('🎫 Ultimate Rewards · Support Tickets')
    .setDescription(
      [
        'Select a category below to open a private ticket.',
        '',
        '**Categories**',
        '• **Support** — general help',
        '• **Claim** — claim a free / giveaway reward',
        '• **Purchase Paid** — you already paid (staff will give redeem code)',
        '• **Help** — account / delivery questions',
        '',
        'Staff will respond as soon as possible.'
      ].join('\n')
    )
    .setFooter({ text: 'Ultimate Rewards Ticket System' });

  if (imageUrl) embed.setImage(imageUrl);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_support').setLabel('Support').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Success).setEmoji('🎁'),
    new ButtonBuilder().setCustomId('ticket_purchase').setLabel('Purchase Paid').setStyle(ButtonStyle.Danger).setEmoji('💳'),
    new ButtonBuilder().setCustomId('ticket_help').setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji('❓')
  );

  await channel.send({ embeds: [embed], components: [row] });
}

async function createTicketChannel(guild, user, type) {
  const typeLabels = {
    support: 'support',
    claim: 'claim',
    purchase: 'purchase-paid',
    help: 'help'
  };
  const label = typeLabels[type] || 'ticket';
  const name = `${label}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90);

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }
  ];
  // Give staff roles access if present
  try {
    const { STAFF_ROLE_IDS } = require('../config/roles');
    for (const rid of STAFF_ROLE_IDS) {
      if (guild.roles.cache.has(rid)) {
        overwrites.push({
          id: rid,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
        });
      }
    }
  } catch {}

  const ch = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID || undefined,
    permissionOverwrites: overwrites,
    topic: `Ticket for ${user.tag} (${user.id}) · type:${type}`
  });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
  );

  const welcome = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle(`Ticket · ${label}`)
    .setDescription(`Hello <@${user.id}>!\n\nStaff will be with you shortly.\n\nType: **${label}**`)
    .setFooter({ text: 'Click Close Ticket when finished' });

  await ch.send({ content: `<@${user.id}>`, embeds: [welcome], components: [closeRow] });

  // If purchase type → also fire the priority notification
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
      if (['support', 'claim', 'purchase', 'help'].includes(type)) {
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
          await interaction.editReply({ content: 'Failed to create ticket. Check bot permissions + category ID.' });
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
    const isTicket = message.channel.name.includes('purchase') ||
      (message.channel.topic && message.channel.topic.includes('Ticket'));
    if (!isTicket) return;

    // Optional: staff only
    try {
      const { isStaff } = require('../utils/staff');
      if (!isStaff(message.member)) {
        return message.reply({ content: 'Only staff can generate redeem codes.' });
      }
    } catch {}

    const code = makeCode(message.author.id, message.channel.id);
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('🔑 One-time Redeem Code Generated')
      .setDescription(
        [
          `**Redeem here:** ${REDEEM_BASE_URL}/#redeem  (or open Redeem section on website)`,
          '',
          `**Redeem code:** \`${code}\``,
          '',
          '• Valid **only** on our website',
          '• **One-time** use only',
          '• Customer selects: NFA · MCFA · Netflix · Spotify · Crunchyroll · Minecraft',
          '• Then enters this code → ticket is created & Discord ticket can be closed'
        ].join('\n')
      )
      .setFooter({ text: 'Ultimate Rewards · Paid Purchase' })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  });
}

// Prefix command helper: -ticketpanel [image url]
async function handleTicketPanelCommand(message, args) {
  const image = args[0] && args[0].startsWith('http') ? args[0] : null;
  await sendTicketPanel(message.channel, image);
  await message.reply({ content: 'Ticket panel posted.' }).then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
}

module.exports = {
  registerTicketSystem,
  sendTicketPanel,
  handleTicketPanelCommand,
  useCode,
  makeCode,
  loadCodes
};
