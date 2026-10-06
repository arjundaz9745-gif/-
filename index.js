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
const { addMessageCount, ensureInviteStats, buildInviteEmbed } = require('./systems/invites');
const { trackWindow, spamTracker, joinTracker, getProtection, logProtect } = require('./systems/protection');
const { handleMentions } = require('./systems/pingProtect');
const { askAI } = require('./systems/ai');
const { handleIAmHere } = require('./systems/redeem');
const { handleGenMessage } = require('./systems/genCommands');
const { handlePassMessage } = require('./systems/passChanger');
const { importFromChannel, scheduleExport } = require('./systems/sync');
const { giveawayEmbed, giveawayRow, endGiveaway } = require('./systems/giveaways');
const { isSbanActive, addSban, removeSban, isTimeoutExempt } = require('./systems/sban');
const { handleCommand } = require('./commands/router');
const { startWebServer } = require('./web/server');
const { registerAntiNuke } = require('./systems/antinuke');
const { registerReactionRoles } = require('./systems/reactionRoles');
const ttt = require('./systems/tictactoe');
const { registerTicketSystem, handleTicketPanelCommand } = require('./systems/tickets');

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
client.once('ready', onReady);

async function onReady() {
  console.log(`${brand.BOT_NAME} online as ${client.user.tag}`);
  try {
    const cmds = [
      new SlashCommandBuilder().setName('help').setDescription('Commands'),
      new SlashCommandBuilder().setName('invites').setDescription('Invite stats').addUserOption((o) => o.setName('user')),
      new SlashCommandBuilder().setName('messages').setDescription('Message count').addUserOption((o) => o.setName('user')),
      new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Start giveaway')
        .addStringOption((o) => o.setName('time').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setRequired(true))
        .addStringOption((o) => o.setName('prize').setRequired(true)),
      new SlashCommandBuilder().setName('export').setDescription('Export sync').addChannelOption((o) => o.setName('channel').setRequired(true)),
      new SlashCommandBuilder().setName('protection').setDescription('Protection status'),
      new SlashCommandBuilder().setName('serverinfo').setDescription('Server info'),
      new SlashCommandBuilder().setName('userinfo').setDescription('User info').addUserOption((o) => o.setName('user')),
      new SlashCommandBuilder().setName('purge').setDescription('Delete messages').addIntegerOption((o) => o.setName('amount').setRequired(true).setMinValue(1).setMaxValue(100)),
      new SlashCommandBuilder().setName('ban').setDescription('Ban').addUserOption((o) => o.setName('user').setRequired(true)).addStringOption((o) => o.setName('reason')),
      new SlashCommandBuilder().setName('kick').setDescription('Kick').addUserOption((o) => o.setName('user').setRequired(true)).addStringOption((o) => o.setName('reason')),
      new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Timeout')
        .addUserOption((o) => o.setName('user').setRequired(true))
        .addStringOption((o) => o.setName('duration').setRequired(true))
        .addStringOption((o) => o.setName('reason')),
      new SlashCommandBuilder().setName('ping').setDescription('Latency'),
      new SlashCommandBuilder().setName('avatar').setDescription('Avatar').addUserOption((o) => o.setName('user')),
      new SlashCommandBuilder().setName('game').setDescription('Tic Tac Toe').addUserOption((o) => o.setName('user').setDescription('Opponent').setRequired(true))
    ].map((c) => c.toJSON());
    const rest = new REST({ version: '10' }).setToken(env.TOKEN);
    if (env.GUILD_ID) await rest.put(Routes.applicationGuildCommands(client.user.id, env.GUILD_ID), { body: cmds });
    else await rest.put(Routes.applicationCommands(client.user.id), { body: cmds });
    console.log('Slash commands registered');
  } catch (e) {
    console.error('slash', e.message);
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
  if (!message.guild || message.author.bot) return;
  const data = dataStore.get();
  addMessageCount(message.guild.id, message.author.id);

  // XP / levels
  if (!data.levels) data.levels = {};
  if (!data.levels[message.guild.id]) data.levels[message.guild.id] = {};
  data.levels[message.guild.id][message.author.id] =
    (data.levels[message.guild.id][message.author.id] || 0) + 1 + Math.floor(Math.random() * 3);

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
  const _d = dataStore.get();
  if (_d.botPaused && !message.member?.permissions?.has?.('Administrator')) {
    // bot stopped from panel — ignore non-admin
    return;
  }
  if (await handleGenMessage(message, client).catch((e) => { console.error('gen', e.message); return false; })) return;
  if (await handlePassMessage(message, client).catch((e) => { console.error('pass', e.message); return false; })) return;
  if (await handleIAmHere(message).catch(() => false)) return;

  const aiCh = data.aiChannelId || env.AI_CHANNEL_ID;
  if (aiCh && message.channel.id === aiCh && !message.content.startsWith(brand.PREFIX)) {
    if (!env.OPENAI_API_KEY) {
      await message.reply({ content: 'AI is offline — set `OPENAI_API_KEY` (or Groq `gsk_…`) in env.' }).catch(() => {});
      return;
    }
    await message.channel.sendTyping().catch(() => {});
    const reply = await askAI(message.content, message.channel.id, message.author.id);
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
  }

  await handleCommand(message, client);
});

client.on('interactionCreate', async (interaction) => {
  try {
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

    if (name === 'help') return reply({ embeds: [E(brand.BOT_NAME, `Prefix \`${brand.PREFIX}\` · \`${brand.PREFIX}help\``)], ephemeral: true });
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
