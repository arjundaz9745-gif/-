const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const brand = require('../config/brand');

/** gameId -> { board[9], turn: 'X'|'O', xId, oId, channelId } */
const games = new Map();

function emptyBoard() {
  return Array(9).fill(null);
}

function renderBoard(board) {
  const map = { X: '❌', O: '⭕', null: '⬜' };
  const lines = [];
  for (let r = 0; r < 3; r++) {
    lines.push([0, 1, 2].map((c) => map[board[r * 3 + c] ?? null] || '⬜').join(''));
  }
  return lines.join('\n');
}

function winner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every((c) => c)) return 'draw';
  return null;
}

function rows(gameId, board, disabled = false) {
  const out = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const v = board[i];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ttt:${gameId}:${i}`)
          .setLabel(v === 'X' ? 'X' : v === 'O' ? 'O' : '·')
          .setStyle(v === 'X' ? ButtonStyle.Danger : v === 'O' ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(disabled || !!v)
      );
    }
    out.push(row);
  }
  return out;
}

function embed(game, status) {
  return new EmbedBuilder()
    .setColor(brand.blurple)
    .setTitle('Tic Tac Toe')
    .setDescription(
      `${renderBoard(game.board)}\n\n` +
        `❌ <@${game.xId}>  ·  ⭕ <@${game.oId}>\n` +
        status
    )
    .setFooter({ text: brand.footer });
}

async function startGame(channel, challenger, opponent) {
  const gameId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const game = {
    board: emptyBoard(),
    turn: 'X',
    xId: challenger.id,
    oId: opponent.id,
    channelId: channel.id
  };
  games.set(gameId, game);
  const msg = await channel.send({
    content: `${opponent} — challenge from ${challenger}!`,
    embeds: [embed(game, `Turn: ❌ <@${game.xId}>`)],
    components: rows(gameId, game.board)
  });
  game.messageId = msg.id;
  return gameId;
}

async function handleButton(interaction) {
  const parts = interaction.customId.split(':');
  if (parts[0] !== 'ttt') return false;
  const gameId = parts[1];
  const idx = parseInt(parts[2], 10);
  const game = games.get(gameId);
  if (!game) {
    await interaction.reply({ content: 'Game expired.', ephemeral: true });
    return true;
  }
  const uid = interaction.user.id;
  const mark = game.turn;
  const expected = mark === 'X' ? game.xId : game.oId;
  if (uid !== expected) {
    await interaction.reply({ content: 'Not your turn.', ephemeral: true });
    return true;
  }
  if (game.board[idx]) {
    await interaction.reply({ content: 'Taken.', ephemeral: true });
    return true;
  }
  game.board[idx] = mark;
  const w = winner(game.board);
  if (w === 'X' || w === 'O') {
    const winnerId = w === 'X' ? game.xId : game.oId;
    await interaction.update({
      embeds: [embed(game, `🏆 Winner: <@${winnerId}>`)],
      components: rows(gameId, game.board, true)
    });
    games.delete(gameId);
    return true;
  }
  if (w === 'draw') {
    await interaction.update({
      embeds: [embed(game, 'Draw!')],
      components: rows(gameId, game.board, true)
    });
    games.delete(gameId);
    return true;
  }
  game.turn = mark === 'X' ? 'O' : 'X';
  const nextId = game.turn === 'X' ? game.xId : game.oId;
  await interaction.update({
    embeds: [embed(game, `Turn: ${game.turn === 'X' ? '❌' : '⭕'} <@${nextId}>`)],
    components: rows(gameId, game.board)
  });
  return true;
}

module.exports = { startGame, handleButton };
