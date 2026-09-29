const { EmbedBuilder } = require('discord.js');
const brand = require('../config/brand');

function E(title, desc, color = brand.color) {
  const e = new EmbedBuilder().setColor(color).setFooter({ text: brand.footer }).setTimestamp();
  if (title) e.setTitle(title);
  if (desc) e.setDescription(desc);
  return e;
}

module.exports = { E, brand };
