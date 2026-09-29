/** Normalize Discord fancy nickname fonts → plain for Ping = Mute detection */
function normalizeFonts(str) {
  if (!str) return '';
  const maps = [
    [0x1d400, 0x1d419, 65], [0x1d41a, 0x1d433, 97],
    [0x1d434, 0x1d44d, 65], [0x1d44e, 0x1d467, 97],
    [0x1d468, 0x1d481, 65], [0x1d482, 0x1d49b, 97],
    [0x1d5a0, 0x1d5b9, 65], [0x1d5ba, 0x1d5d3, 97],
    [0x1d5d4, 0x1d5ed, 65], [0x1d5ee, 0x1d607, 97],
    [0x1d608, 0x1d621, 65], [0x1d622, 0x1d63b, 97],
    [0x1d63c, 0x1d655, 65], [0x1d656, 0x1d66f, 97],
    [0x1d670, 0x1d689, 65], [0x1d68a, 0x1d6a3, 97]
  ];
  let out = '';
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    let done = false;
    for (const [s, e, b] of maps) {
      if (cp >= s && cp <= e) { out += String.fromCharCode(b + (cp - s)); done = true; break; }
    }
    if (!done) {
      if (cp >= 0xff21 && cp <= 0xff3a) out += String.fromCharCode(65 + (cp - 0xff21));
      else if (cp >= 0xff41 && cp <= 0xff5a) out += String.fromCharCode(97 + (cp - 0xff41));
      else out += ch;
    }
  }
  return out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectPingStatus(member) {
  if (!member) return 'none';
  const bits = [member.nickname, member.displayName, member.user?.globalName, member.user?.username]
    .filter(Boolean).map(normalizeFonts).join(' | ');
  if (/ping\s*[=:]\s*mute/.test(bits)) return 'mute';
  if (/ping\s*[=:]\s*warn/.test(bits)) return 'warn';
  if (/ping\s*[=:]\s*help/.test(bits)) return 'help';
  return 'none';
}

function stylish(str) {
  const map = {
    a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',
    n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ'
  };
  return String(str || '').split('').map((c) => map[c.toLowerCase()] || c).join('');
}

function presenceLabel(s) {
  return ({ online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline', invisible: 'Invisible' })[s] || 'Unknown';
}

module.exports = { normalizeFonts, detectPingStatus, stylish, presenceLabel };
