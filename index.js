/**
 * ᴅᴀꜱʜᴍᴏᴅ | ᴘɪɴɢ = ᴍᴜᴛᴇ
 * Multi-module protection bot + admin panel
 * Coded by DashWho · Enhanced by DakshBro
 */
require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes
} = require('discord.js');

const env = require('./config/env');
const brand = require('./config/brand');
const dataStore = require('./utils/data');
const { isStaff } = require('./utils/staff');
const { E } = require('./utils/embeds');
const { parseDuration } = require('./utils/duration');
const { addMessageCount, ensureInviteStats, buildInviteEmbed, buildMessagesEmbed, tryReplaceFalconInvite } = require('./systems/invites');
const { trackWindow, spamTracker, joinTracker, getProtection, logProtect } = require('./systems/protection');
const { handleMentions } = require('./systems/pingProtect');
// web dashboard can resolve users
global.__dashmodClient = null;
const promoteSys = require('./systems/promote');
const spinSys = require('./systems/spin');
const { askAI } = require('./systems/ai');
const { handleIAmHere } = require('./systems/redeem');
const { handleGenMessage } = require('./systems/genCommands');
const { handleBackupMessage, handleBackupInteraction, applyPendingMemberRoles } = require('./systems/serverBackup');
const { importFromChannel, scheduleExport } = require('./systems/sync');
const { giveawayEmbed, giveawayRow, endGiveaway, startGiveawayChecker } = require('./systems/giveaways');
const { isSbanActive, addSban, removeSban, isTimeoutExempt } = require('./systems/sban');
const runtimeLog = require('./systems/runtimeLog');
const { handleCommand } = require('./commands/router');
const { handleHitsMessage, resumeHitsPoster } = require('./systems/hits');
const levels = require('./systems/levels');
const eventsSys = require('./systems/events');
const stockVault = require('./systems/stockVault');
const { startWebServer } = require('./web/server');
const { registerAntiNuke } = require('./systems/antinuke');
const { registerReactionRoles } = require('./systems/reactionRoles');
const ttt = require('./systems/tictactoe');
const { registerTicketSystem, handleTicketPanelCommand, handlePaidCommand, handleTicketManageCommand } = require('./systems/tickets');

if (!env.TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN');
  process.exit(1);
}

dataStore.load();

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessages
];
if (env.PRESENCE_INTENT) intents.push(GatewayIntentBits.GuildPresences);

const client = new Client({ intents, partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember] });

client.once('clientReady', onReady);

async function onReady() {
  try { runtimeLog.markStart(); runtimeLog.info('Bot ready as ' + (client.user && client.user.tag)); } catch (_) {}
  console.log(`${brand.BOT_NAME} online as ${client.user.tag}`);
  try { resumeHitsPoster(client); } catch (_) {}
  try { startGiveawayChecker(client); } catch (_) {}
  setInterval(() => { try { eventsSys.tickEvents(client); } catch (_) {} }, 30000);
  try {
    const cmds = [
      new SlashCommandBuilder().setName('help').setDescription('Show bot commands'),
      new SlashCommandBuilder()
        .setName('invites')
        .setDescription('Invite stats')
        .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(false)),
      new SlashCommandBuilder()
        .setName('messages')
        .setDescription('Message count')
        .addUserOption((o) => o.setName('user').setDescription('User to check').setRequired(false)),
      new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('time').setDescription('Duration e.g. 1h 30m').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1).setMaxValue(20))
        .addStringOption((o) => o.setName('prize').setDescription('Prize name').setRequired(true)),
      new SlashCommandBuilder()
        .setName('export')
        .setDescription('Export sync data to a channel')
        .addChannelOption((o) => o.setName('channel').setDescription('Target channel').setRequired(true)),
      new SlashCommandBuilder().setName('protection').setDescription('Show protection status'),
      new SlashCommandBuilder().setName('serverinfo').setDescription('Server information'),
      new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('User information')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(false)),
      new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete recent messages')
        .addIntegerOption((o) =>
          o.setName('amount').setDescription('How many messages (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)
        ),
      new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member')
        .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),
      new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member')
        .addUserOption((o) => o.setName('user').setDescription('User to kick').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),
      new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout a member')
        .addUserOption((o) => o.setName('user').setDescription('User to timeout').setRequired(true))
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m 1h 1d').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(false)),
      new SlashCommandBuilder().setName('ping').setDescription('Bot latency'),
      new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show avatar')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(false)),
      new SlashCommandBuilder()
        .setName('game')
        .setDescription('Play Tic Tac Toe')
        .addUserOption((o) => o.setName('user').setDescription('Opponent').setRequired(true)),
      new SlashCommandBuilder().setName('stock').setDescription('View free + premium vault stock'),
      new SlashCommandBuilder().setName('payouts').setDescription('Payout / legit stats'),
      new SlashCommandBuilder()
        .setName('event')
        .setDescription('Create an event')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add event — next message is the body')
            .addStringOption((o) => o.setName('name').setDescription('Event name').setRequired(true))
            .addStringOption((o) => o.setName('time').setDescription('e.g. 1h 30m (optional = forever)'))
        )
        .addSubcommand((s) => s.setName('list').setDescription('List active events')),
      new SlashCommandBuilder()
        .setName('level')
        .setDescription('Show message level')
        .addUserOption((o) => o.setName('user').setDescription('User')),
      new SlashCommandBuilder()
        .setName('free')
        .setDescription('Take from free vault (staff)')
        .addStringOption((o) => o.setName('service').setDescription('mcfa / mcnfa / donut / hypixel').setRequired(true)),
      
      new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a staff member one rank')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      new SlashCommandBuilder()
        .setName('demote')
        .setDescription('Demote a staff member one rank')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
      new SlashCommandBuilder()
        .setName('spin')
        .setDescription('Spin wheel')
        .addStringOption((o) =>
          o.setName('players').setDescription('Names or @mentions separated by space').setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('premium')
        .setDescription('Premium vault')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add stock email:pass:username')
            .addStringOption((o) => o.setName('combo').setDescription('email:pass or email:pass:name').setRequired(true))
            .addStringOption((o) => o.setName('service').setDescription('mcfa/donut/hypixel/...').setRequired(false))
        )
        .addSubcommand((s) =>
          s
            .setName('take')
            .setDescription('Take from premium vault')
            .addStringOption((o) => o.setName('service').setDescription('Service').setRequired(true))
        ),

      new SlashCommandBuilder()
        .setName('hit')
        .setDescription('Hits poster')
        .addSubcommand((s) => s.setName('stock').setDescription('Hit queue counts'))
        .addSubcommand((s) => s.setName('start').setDescription('Start posting'))
        .addSubcommand((s) => s.setName('stop').setDescription('Stop posting')),
      new SlashCommandBuilder().setName('access').setDescription('Gen access guide'),
      new SlashCommandBuilder()
        .setName('backup')
        .setDescription('Server backup (owners only)')
        .addSubcommand((s) =>
          s
            .setName('save')
            .setDescription('Save a backup')
            .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(true))
        )
        .addSubcommand((s) => s.setName('list').setDescription('List backups'))
        .addSubcommand((s) =>
          s
            .setName('load')
            .setDescription('Load/restore a backup (wipes structure)')
            .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('delete')
            .setDescription('Delete a backup')
            .addStringOption((o) => o.setName('name').setDescription('Backup name').setRequired(true))
        )
        .addSubcommand((s) =>
          s
            .setName('logs')
            .setDescription('Set channel for auto backup files')
            .addChannelOption((o) => o.setName('channel').setDescription('Text channel').setRequired(true))
        )
    ].map((c) => c.toJSON());
    const rest = new REST({ version: '10' }).setToken(env.TOKEN);
    const names = cmds.map((c) => c.name).join(', ');
    let registered = false;

    // Prefer guild (instant). Fall back to global if guild fails (Missing Access / wrong GUILD_ID).
    if (env.GUILD_ID) {
      try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, env.GUILD_ID), { body: cmds });
        console.log('Slash commands (guild ' + env.GUILD_ID + '):', names);
        registered = true;
      } catch (ge) {
        console.error('Guild slash failed (' + ge.message + '). Falling back to GLOBAL…');
        console.error('Fix: set correct GUILD_ID + re-invite bot with scope applications.commands');
      }
    }

    if (!registered) {
      await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
      console.log('Slash commands (GLOBAL — may take up to 1 hour):', names);
    }
  } catch (e) {
    console.error('Slash register failed:', e.message);
    try { runtimeLog.error('Slash register: ' + e.message); } catch (_) {}
    console.error(
      'Invite URL needs scopes: bot applications.commands\n' +
        'https://discord.com/api/oauth2/authorize?client_id=' +
        (client.user && client.user.id) +
        '&permissions=8&scope=bot%20applications.commands'
    );
  }

  setInterval(async () => {
    const data = dataStore.get();
    const chId = data.syncChannelId || env.SYNC_CHANNEL_ID;
    if (!chId) return;
    const ch = await client.channels.fetch(chId).catch(() => null);
    if (ch) {
      const r = await importFromChannel(ch);
      if (r.ok) console.log('Auto-import', r.at);
    }
  }, 5 * 60 * 1000);

  setInterval(() => {
    const data = dataStore.get();
    for (const [id, g] of Object.entries(data.giveaways || {})) {
      if (!g.ended && g.ends <= Date.now()) endGiveaway(client, id).catch(() => {});
    }
  }, 15000);

  setInterval(() => dataStore.save(), 60000);
}

client.on('guildMemberAdd', async (member) => {
  try { runtimeLog.info(`JOIN ${member.user.tag} → ${member.guild.name}`); } catch (_) {}
  try { await applyPendingMemberRoles(member); } catch (_) {}
  const data = dataStore.get();
  try {
    if (data.autorole?.[member.guild.id]) await member.roles.add(data.autorole[member.guild.id]).catch(() => {});
  } catch (_) {}
  try {
    const prot = getProtection();
    if (prot.antiraid !== false) {
      const n = trackWindow(joinTracker, member.guild.id, prot.joinWindowMs || 10000);
      if (n >= (prot.joinLimit || 8)) {
        await logProtect(client, member.guild, 'Anti-raid', `**${n}** joins · ${member.user.tag}`);
        if (Date.now() - member.user.createdTimestamp < 3 * 86400000) await member.kick('Anti-raid').catch(() => {});
      }
    }
  } catch (_) {}
  try {
    const invites = await member.guild.invites.fetch().catch(() => null);
    if (!invites) return;
    if (!data.inviteUses) data.inviteUses = {};
    const prev = data.inviteUses[member.guild.id] || {};
    let used = null;
    invites.forEach((inv) => {
      if ((inv.uses || 0) > (prev[inv.code]?.uses || 0)) used = inv;
    });
    data.inviteUses[member.guild.id] = {};
    invites.forEach((inv) => {
      data.inviteUses[member.guild.id][inv.code] = { uses: inv.uses || 0, inviterId: inv.inviter?.id || null };
    });
    if (used?.inviter) {
      ensureInviteStats(member.guild.id, used.inviter.id).joins++;
      if (!data.invitedBy) data.invitedBy = {};
      if (!data.invitedBy[member.guild.id]) data.invitedBy[member.guild.id] = {};
      data.invitedBy[member.guild.id][member.id] = used.inviter.id;
      dataStore.save();
      scheduleExport(client, 'join');
    }
  } catch (e) {
    console.error('join', e.message);
  }
});

client.on('guildMemberRemove', async (member) => {
  try { runtimeLog.info(`LEAVE ${member.user?.tag || member.id} ← ${member.guild.name}`); } catch (_) {}
  try {
    const data = dataStore.get();
    const inviterId = data.invitedBy?.[member.guild.id]?.[member.id];
    if (!inviterId) return;
    ensureInviteStats(member.guild.id, inviterId).leaves++;
    delete data.invitedBy[member.guild.id][member.id];
    dataStore.save();
    scheduleExport(client, 'leave');
  } catch (_) {}
});

client.on('messageDelete', async (message) => {
  try {
    if (!message.guild || message.author?.bot) return;
    const data = dataStore.get();
    if (!data.snipes) data.snipes = {};
    data.snipes[message.channel.id] = {
      content: message.content || '',
      tag: message.author?.tag,
      avatar: message.author?.displayAvatarURL?.({ size: 64 }),
      at: Date.now()
    };
  } catch (_) {}
});

client.on('messageCreate', async (message) => {
  // Replace Falcon (and similar) invite embeds with DashMod style
  if (message.author?.bot) {
    try {
      if (await tryReplaceFalconInvite(message, client)) return;
    } catch (_) {}
  }

  // Anti-commands channel: members cannot use bot-style commands
  try {
    const antiCh = process.env.ANTI_CMD_CHANNEL_ID || '1557389786652741672';
    if (message.channel.id === antiCh && message.guild && !message.author.bot) {
      const { isStaff } = require('./utils/staff');
      const txt = (message.content || '').trim();
      const looksCmd = /^[\/!$%.&?\-]/.test(txt) || /^(ban|kick|mute|warn|purge|clear|help|stock|invites)\b/i.test(txt);
      if (looksCmd && !isStaff(message.member)) {
        await message.delete().catch(() => {});
        const w = await message.channel.send({ content: `<@${message.author.id}> Commands are disabled here.` }).catch(() => null);
        if (w) setTimeout(() => w.delete().catch(() => {}), 4000);
        return;
      }
    }
  } catch (_) {}

  if (!message.guild || message.author.bot) return;
  const data = dataStore.get();
  addMessageCount(message.guild.id, message.author.id);

  // levels handled later via systems/levels

  if (data.afk?.[message.author.id]) {
    delete data.afk[message.author.id];
    dataStore.save();
    message.reply({ embeds: [E('AFK', 'Welcome back.', brand.green)] }).catch(() => {});
  }
  for (const [uid] of message.mentions.users) {
    if (data.afk?.[uid]) {
      message.channel
        .send({ embeds: [E('AFK', `<@${uid}> is AFK: ${data.afk[uid].reason || 'AFK'}`, brand.gold)] })
        .then((m) => setTimeout(() => m.delete().catch(() => {}), 6000))
        .catch(() => {});
    }
  }
  try {
    const rules = data.autoreact?.[message.guild.id];
    if (rules?.length) {
      const lower = message.content.toLowerCase();
      for (const r of rules) if (r.trigger && lower.includes(r.trigger)) await message.react(r.emoji).catch(() => {});
    }
  } catch (_) {}

  try {
    const prot = getProtection();
    if (prot.automod !== false && !isStaff(message.member)) {
      const n = trackWindow(spamTracker, message.author.id + message.channel.id, prot.spamWindowMs || 5000);
      if (n >= (prot.spamLimit || 6)) {
        await message.member.timeout(10 * 60 * 1000, 'Spam').catch(() => {});
        await message.reply({ embeds: [E('Automod', 'Timeout **10m** for spam.', brand.red)] }).catch(() => {});
      }
    }
  } catch (_) {}

  await handleMentions(message).catch((e) => console.error('ping', e.message));
  if (!message.author.bot && message.guild) {
    try {
      runtimeLog.info(`MSG #${message.channel?.name || message.channelId} | ${message.author.tag}: ${String(message.content || '').slice(0, 120)}`);
    } catch (_) {}
  }
  const _d = dataStore.get();
  if (_d.botPaused && !message.member?.permissions?.has?.('Administrator')) {
    // bot stopped from panel — ignore non-admin
    return;
  }
  try {
    if (await stockVault.handleLegitReply(message)) return;
    if (await stockVault.handleVouchMessage(message)) return;
    if (await stockVault.handleStockCommands(message)) return;
  } catch (e) { console.error('stock', e.message); }

  if (await handleGenMessage(message, client).catch((e) => { console.error('gen', e.message); return false; })) return;
  if (await handleBackupMessage(message, client).catch((e) => { console.error('backup', e.message); return false; })) return;
  if (await handleIAmHere(message).catch(() => false)) return;

  const aiCh = data.aiChannelId || env.AI_CHANNEL_ID;
  if (aiCh && message.channel.id === aiCh && !message.content.startsWith(brand.PREFIX)) {
    if (!env.OPENAI_API_KEY) {
      await message.reply({ content: 'AI is offline — set `OPENAI_API_KEY` (or Groq `gsk_…`) in env.' }).catch(() => {});
      return;
    }
    await message.channel.sendTyping().catch(() => {});
    const reply = await askAI(message.content, message.channel.id, message.author.id, message.member?.displayName || message.author.username);
    if (reply && reply.text) {
      await message.reply({ content: reply.text, allowedMentions: { parse: [] } }).catch(() => {});
    } else {
      const err = (reply && reply.error) ? reply.error : ('bad reply: ' + typeof reply);
      await message.reply({
        content: 'AI error: ' + err + '\nTip: env OPENAI_API_KEY=gsk_… and OPENAI_MODEL=llama-3.3-70b-versatile then redeploy.'
      }).catch(() => {});
    }
    return;
  }

  // Ticket panel command
  if (message.content.startsWith(brand.PREFIX)) {
    const args = message.content.slice(brand.PREFIX.length).trim().split(/\s+/);
    const cmd = (args.shift() || '').toLowerCase();
    if (cmd === 'ticketpanel' || cmd === 'ticket') {
      await handleTicketPanelCommand(message, args);
      return;
    }
    if (cmd === 'paid') {
      await handlePaidCommand(message, args);
      return;
    }
    if (cmd === 'tickets' || cmd === 'ticketmanage' || cmd === 'tm') {
      await handleTicketManageCommand(message);
      return;
    }
  }

  // levels
  try {
    if (message.guild && !message.author.bot) {
      const prev = (dataStore.get().levels?.[message.guild.id]?.[message.author.id]) || 0;
      const xp = levels.addMessageXp(message.guild.id, message.author.id);
      levels.handleLevelUp(message, prev, xp);
    }
  } catch (_) {}

  // event create follow-up
  try {
    const pendEv = eventsSys.getPending(message.author.id);
    if (pendEv && !message.content.startsWith(brand.PREFIX)) {
      const ev = eventsSys.createEvent({
        guildId: message.guild.id,
        channelId: message.channel.id,
        name: pendEv.name,
        body: message.content,
        endsAt: pendEv.endsAt,
        createdBy: message.author.id
      });
      eventsSys.clearPending(message.author.id);
      await message.reply({
        embeds: [E('Event', `**${ev.name}** live` + (ev.endsAt ? ` · ends <t:${Math.floor(ev.endsAt/1000)}:R>` : ' · ♾️'), brand.green)]
      });
      await message.channel.send({
        embeds: [E(ev.name, ev.body, brand.gold)]
      });
      return;
    }
  } catch (e) { console.error('event', e.message); }

  const hitHandled = await handleHitsMessage(message, client).catch((e) => {
    console.error('hits', e.message);
    return false;
  });
  if (hitHandled) return;

  await handleCommand(message, client);
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Backup buttons + /backup slash
    if (
      (interaction.isButton() && String(interaction.customId || '').startsWith('backup_')) ||
      (interaction.isChatInputCommand() && interaction.commandName === 'backup')
    ) {
      const handled = await handleBackupInteraction(interaction, client).catch((e) => {
        console.error('backup ix', e.message);
        return false;
      });
      if (handled) return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('ttt:')) {
      await ttt.handleButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === 'gw_enter') {
      const data = dataStore.get();
      const g = data.giveaways?.[interaction.message.id];
      if (!g || g.ended) return interaction.reply({ content: 'Ended.', ephemeral: true });
      if (isSbanActive(interaction.user.id)) return interaction.reply({ content: 'You are giveaway-banned (sban).', ephemeral: true });
      if (!g.entries) g.entries = [];
      if (g.entries.includes(interaction.user.id)) return interaction.reply({ content: 'Already in.', ephemeral: true });
      g.entries.push(interaction.user.id);
      dataStore.save();
      await interaction.message.edit({ embeds: [giveawayEmbed(g)], components: [giveawayRow()] }).catch(() => {});
      return interaction.reply({ content: 'Entered!', ephemeral: true });
    }
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;
    const reply = (x) => interaction.reply(typeof x === 'string' ? { content: x, ephemeral: true } : x);
    const data = dataStore.get();

    
    if (name === 'payouts') {
      const list = Object.values(eventsSys.ensure());
      let total = 0;
      const staffs = new Set();
      for (const e of list) {
        for (const [sid, n] of Object.entries(e.payoutStaff || {})) {
          total += n;
          staffs.add(sid);
        }
      }
      return reply({ embeds: [E('Payouts', `Recorded **${total}** legits by **${staffs.size}** staff.`, brand.color)] });
    }
    if (name === 'level') {
      const u = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(u.id).catch(() => null) || interaction.member;
      const xp = (data.levels?.[interaction.guildId]?.[u.id]) || 0;
      await interaction.deferReply({ ephemeral: true });
      await levels.sendLevelCard(interaction.channel, member, xp);
      return interaction.editReply({ content: 'Level card sent.' }).catch(() => {});
    }
    if (name === 'stock') {
      const free = stockVault.counts('free');
      const prem = stockVault.counts('premium');
      const fl = Object.entries(free).map(([s, n]) => `• **${s}** → \`${n}\``).join('\n') || '_empty_';
      const pl = Object.entries(prem).map(([s, n]) => `• **${s}** → \`${n}\``).join('\n') || '_empty_';
      return reply({ embeds: [E('📦 Stock', `**FREE**\n${fl}\n\n**PREMIUM**\n${pl}`, brand.color)] });
    }
    if (name === 'event') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'list') {
        const list = eventsSys.listActive(interaction.guildId);
        return reply({ embeds: [E('Events', list.length ? list.map((e) => `• **${e.name}**`).join('\n') : 'None', brand.color)] });
      }
      if (sub === 'add') {
        const { isStaff } = require('./utils/staff');
        if (!isStaff(interaction.member)) return reply({ content: 'Staff only.', ephemeral: true });
        const ename = interaction.options.getString('name', true);
        const timeRaw = interaction.options.getString('time');
        let endsAt = null;
        if (timeRaw) {
          const ms = parseDuration(timeRaw);
          if (ms) endsAt = Date.now() + ms;
        }
        eventsSys.setPending(interaction.user.id, { name: ename, endsAt });
        return reply({ content: 'Send the **event body** as your next message (e.g. `2 invites = mcfa`).', ephemeral: true });
      }
    }
    if (name === 'hit') {
      const { isStaff } = require('./utils/staff');
      const sub = interaction.options.getSubcommand();
      const { stockEmbed, startPoster, stopPoster } = require('./systems/hits');
      if (sub === 'stock') return reply({ embeds: [stockEmbed()] });
      if (!isStaff(interaction.member)) return reply({ content: 'Staff only.' });
      if (sub === 'start') {
        startPoster(client);
        return reply({ content: 'Hits poster started.' });
      }
      if (sub === 'stop') {
        stopPoster();
        return reply({ content: 'Hits poster stopped.' });
      }
    }
    if (name === 'free' || name === 'premium') {
      // staff only deliver via telling them to use prefix for now
      return reply({ content: `Use \`-${name} ${interaction.options.getString('service')}\` in the ticket (staff).`, ephemeral: true });
    }

    if (name === 'help') return reply({ embeds: [E(brand.BOT_NAME, `Prefix \`${brand.PREFIX}\` · \`${brand.PREFIX}help\``)], ephemeral: true });
    
    if (name === 'promote' || name === 'demote') {
      const user = interaction.options.getUser('user');
      const mem = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!mem) return reply({ content: 'Member not found.', ephemeral: true });
      // fake message-like for promoteSys
      const fakeMsg = {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        reply: (x) => reply(x),
      };
      await promoteSys.promote(fakeMsg, mem, name === 'demote');
      return;
    }
    if (name === 'spin') {
      const raw = interaction.options.getString('players') || '';
      const args = raw.split(/\s+/).filter(Boolean);
      const fakeMsg = {
        author: interaction.user,
        member: interaction.member,
        guild: interaction.guild,
        channel: interaction.channel,
        mentions: { members: { values: () => [] }, roles: { values: () => [] } },
        reply: (x) => interaction.followUp(x).catch(() => interaction.reply(x)),
      };
      await interaction.deferReply();
      // collect mentions from resolved if any — names only from string
      await spinSys.runSpin(
        {
          ...fakeMsg,
          reply: async (x) => interaction.editReply(x),
          channel: interaction.channel,
          guild: interaction.guild,
          author: interaction.user,
          mentions: { members: { values: () => [] }, roles: { values: () => [] } },
        },
        args
      );
      return;
    }
    if (name === 'premium') {
      const sub = interaction.options.getSubcommand();
      const staffRole = process.env.STAFF_TEAM_ROLE_ID || '1548173330794815599';
      const authRoles = new Set([
        staffRole,
        '1547183164185911356',
        '1547183162457718847',
        '1549036072909021285',
        '1547183161300090950',
        '1547183159794204675',
      ]);
      const isAuth =
        interaction.member.permissions.has('Administrator') ||
        interaction.member.roles.cache.some((r) => authRoles.has(r.id)) ||
        ['1541659394188509215', '1080190046138802306'].includes(interaction.user.id);
      if (!isAuth) return reply({ content: 'Staff only.', ephemeral: true });
      if (sub === 'add') {
        const combo = interaction.options.getString('combo');
        const service = (interaction.options.getString('service') || 'mcfa').toLowerCase();
        const stockVault = require('./systems/stockVault');
        if (stockVault.addPremium) {
          const n = stockVault.addPremium(service, combo);
          return reply({ content: `Added to premium **${service}** (${n}).`, ephemeral: true });
        }
        // fallback data store
        const dataStore = require('./utils/data');
        const d = dataStore.get();
        if (!d.premiumVault) d.premiumVault = {};
        if (!d.premiumVault[service]) d.premiumVault[service] = [];
        d.premiumVault[service].push(combo);
        dataStore.save();
        return reply({ content: `Added to premium **${service}**.`, ephemeral: true });
      }
      if (sub === 'take') {
        // fall through to existing free/premium take if any
      }
    }

    if (name === 'invites') {
      const u = interaction.options.getUser('user') || interaction.user;
      return reply({ embeds: [buildInviteEmbed(u, interaction.guildId, interaction.user.username)] });
    }
    if (name === 'messages') {
      const u = interaction.options.getUser('user') || interaction.user;
      return reply({
        embeds: [E('Messages', `**${u.username}** · **${(data.messages?.[interaction.guildId]?.[u.id] || 0).toLocaleString()}**`)]
      });
    }
    if (name === 'giveaway') {
      if (!isStaff(interaction.member)) return reply('Staff only.');
      const ms = parseDuration(interaction.options.getString('time'));
      if (!ms) return reply('Bad time');
      const g = {
        channelId: interaction.channelId,
        prize: interaction.options.getString('prize'),
        winners: interaction.options.getInteger('winners') || 1,
        ends: Date.now() + ms,
        hostId: interaction.user.id,
        entries: [],
        ended: false
      };
      const msg = await interaction.channel.send({ embeds: [giveawayEmbed(g)], components: [giveawayRow()] });
      if (!data.giveaways) data.giveaways = {};
      data.giveaways[msg.id] = g;
      dataStore.save();
      setTimeout(() => endGiveaway(client, msg.id), ms + 500);
      return reply({ content: 'Started.', ephemeral: true });
    }
    if (name === 'export') {
      if (!isStaff(interaction.member)) return reply('Staff only.');
      const ch = interaction.options.getChannel('channel');
      data.syncChannelId = ch.id;
      dataStore.save();
      const { exportToChannel } = require('./systems/sync');
      await exportToChannel(ch, 'slash');
      return reply(`Exported to ${ch}`);
    }
    if (name === 'protection') {
      const p = data.protection || {};
      return reply({
        embeds: [E('Protection', `Automod **${p.automod !== false ? 'ON' : 'OFF'}** · Anti-raid **${p.antiraid !== false ? 'ON' : 'OFF'}**`)],
        ephemeral: true
      });
    }
    if (name === 'serverinfo') {
      const g = interaction.guild;
      return reply({
        embeds: [E('Server').setThumbnail(g.iconURL({ size: 256 })).addFields({ name: 'Members', value: String(g.memberCount), inline: true })]
      });
    }
    if (name === 'userinfo') {
      const u = interaction.options.getUser('user') || interaction.user;
      return reply({ embeds: [E(u.username).setThumbnail(u.displayAvatarURL({ size: 256 })).addFields({ name: 'ID', value: u.id })] });
    }
    if (name === 'purge') {
      if (!isStaff(interaction.member)) return reply('Staff only.');
      await interaction.deferReply({ ephemeral: true });
      const deleted = await interaction.channel.bulkDelete(interaction.options.getInteger('amount'), true).catch(() => null);
      return interaction.editReply(`Deleted **${deleted?.size || 0}**`);
    }
    if (name === 'ban' || name === 'kick' || name === 'timeout') {
      if (!isStaff(interaction.member)) return reply('Staff only.');
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason';
      if (name === 'ban') {
        await interaction.guild.members.ban(user.id, { reason }).catch(() => {});
        return reply({ embeds: [E('Banned', user.tag, brand.green)], ephemeral: true });
      }
      const mem = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!mem) return reply('Not found');
      if (name === 'kick') {
        await mem.kick(reason).catch(() => {});
        return reply({ embeds: [E('Kicked', user.tag, brand.green)], ephemeral: true });
      }
      const ms = parseDuration(interaction.options.getString('duration') || '1h') || 3600000;
      await mem.timeout(ms, reason).catch(() => {});
      return reply({ embeds: [E('Timeout', user.tag, brand.green)], ephemeral: true });
    }
    if (name === 'ping') return reply({ embeds: [E('Ping', `WS **${Math.round(client.ws.ping)}ms**`)], ephemeral: true });
    if (name === 'game') {
      const opp = interaction.options.getUser('user');
      if (!opp || opp.bot || opp.id === interaction.user.id) return reply('Pick a real opponent.');
      await interaction.deferReply();
      await ttt.startGame(interaction.channel, interaction.user, opp);
      return interaction.editReply('Challenge sent!');
    }

    if (name === 'stock') {
      const { listPool } = require('./systems/genStock');
      const free = listPool(interaction.guild, 'fgen');
      const boost = listPool(interaction.guild, 'bgen');
      const prem = listPool(interaction.guild, 'pgen');
      return reply({
        embeds: [
          E('Stock', `**Freemium**\n${free}\n\n**Booster**\n${boost}\n\n**Premium**\n${prem}`)
        ]
      });
    }
    if (name === 'access') {
      const { accessGuideEmbed } = require('./systems/statusRole');
      return reply({ embeds: [accessGuideEmbed(interaction.guild)] });
    }

    if (name === 'avatar') {
      const u = interaction.options.getUser('user') || interaction.user;
      return reply({ embeds: [E(u.username).setImage(u.displayAvatarURL({ size: 512 }))] });
    }
  } catch (e) {
    console.error('ix', e.message);
  }
});

registerAntiNuke(client);
registerReactionRoles(client);
registerTicketSystem(client);
startWebServer(client);

client.on('error', (e) => console.error('Discord', e.message));

(async () => {
  console.log('Boot', brand.BOT_NAME, 'token', env.TOKEN.length);
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: 'Bot ' + env.TOKEN }
    });
    if (res.status === 429) {
      const b = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.min(Number(b.retry_after || 15), 60) * 1000));
    } else if (res.status === 401) {
      console.error('Invalid token');
      return;
    } else if (res.ok) console.log('Token OK', (await res.json()).username);
  } catch (e) {
    console.warn(e.message);
  }
  for (let i = 1; i <= 5; i++) {
    try {
      await client.login(env.TOKEN);
      console.log('ONLINE');
      return;
    } catch (e) {
      console.error('Login', i, e.message);
      await new Promise((r) => setTimeout(r, i * 8000));
    }
  }
})();
