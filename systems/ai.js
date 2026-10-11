/**
 * DashWho-M.8.1-lb — AI with persistent fact memory
 */
const env = require('../config/env');
const dataStore = require('../utils/data');

function cleanKey(k) {
  return String(k || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '');
}

/** short-term chat turns: channelId:userId -> messages */
const chatMemory = new Map();
const MAX_TURNS = 16;

/** Seed knowledge (always available) */
const SEED_FACTS = [
  {
    about: 'DashWho',
    text:
      'DashWho is a content creator with about 43 subscribers. He is 22 years old. He is staff/owner-side of Ultimate Rewards (role name only, never ping). Best friends with DakshBro. Loves Free Fire Max and Minecraft. On Cart PvP he is Low-Tier 3.'
  },
  {
    about: 'DakshBro',
    text:
      'DakshBro is the Founder / Owner of Ultimate Rewards. Through hard work he rebuilt after raids and once lost all members. He is 14 years old. Birthday: 18 October. Loves Free Fire Max and Minecraft. Friends with DashWho.'
  },
  {
    about: 'Ultimate Rewards',
    text: 'Ultimate Rewards is the Discord / rewards community. Coded by DashWho, Enhanced by DakshBro. Bot brand: DashMod.'
  },
  {
    about: 'DashMod',
    text: 'DashMod is the Discord bot for Ultimate Rewards. AI identity: DashWho-M.8.1-lb.'
  }
];

function memKey(channelId, userId) {
  return `${channelId || 'x'}:${userId || 'x'}`;
}

function pushMemory(channelId, userId, role, content) {
  const key = memKey(channelId, userId);
  let arr = chatMemory.get(key) || [];
  arr.push({ role, content: String(content).slice(0, 2000) });
  while (arr.length > MAX_TURNS * 2) arr.shift();
  chatMemory.set(key, arr);
}

function getFactsStore() {
  const d = dataStore.get();
  if (!d.aiFacts) {
    d.aiFacts = { people: {}, notes: [] };
    for (const s of SEED_FACTS) {
      const k = s.about.toLowerCase();
      if (!d.aiFacts.people[k]) d.aiFacts.people[k] = [];
      if (!d.aiFacts.people[k].includes(s.text)) d.aiFacts.people[k].push(s.text);
    }
    dataStore.save();
  }
  return d.aiFacts;
}

function addFact(about, text, sourceTag) {
  if (!about || !text) return false;
  const cleaned = String(text).trim().slice(0, 300);
  if (cleaned.length < 8) return false;
  const low = cleaned.toLowerCase();
  if (
    /^(hi|hello|hey|ok|lol|lmao|yes|no|idk|test|ping)\b/.test(low) ||
    /^\d+\/\d+\s*online/.test(low) ||
    low.length < 12
  ) {
    return false;
  }
  const store = getFactsStore();
  const key = String(about)
    .toLowerCase()
    .replace(/[^a-z0-9_\- ]/gi, '')
    .trim()
    .slice(0, 40);
  if (!key) return false;
  if (!store.people[key]) store.people[key] = [];
  if (store.people[key].some((f) => f.toLowerCase() === cleaned.toLowerCase())) return false;
  if (store.people[key].length >= 40) store.people[key].shift();
  const line = sourceTag ? `${cleaned} (from ${sourceTag})` : cleaned;
  store.people[key].push(line);
  dataStore.save();
  return true;
}

function extractFactsFromMessage(userText, displayName, userId) {
  const t = String(userText || '').trim();
  if (!t || t.length < 10) return;
  const who = displayName || 'User';

  let m = t.match(/\b(?:i am|i'm|im)\s+(\d{1,2})\s*(?:years?\s*old)?/i);
  if (m) addFact(who, `${who} is ${m[1]} years old`, who);

  m = t.match(/\b(?:my birthday is|birthday[:\s]+)\s*(.+)$/i);
  if (m) addFact(who, `${who}'s birthday is ${m[1].trim().slice(0, 80)}`, who);

  m = t.match(/\b(?:i love|i like|i play|i main)\s+(.+)/i);
  if (m) addFact(who, `${who} said they ${m[0].slice(0, 120)}`, who);

  m = t.match(/\b(?:i am|i'm)\s+(?:the\s+)?(owner|founder|admin|mod|staff|creator|coder)\b/i);
  if (m) addFact(who, `${who} is ${m[1]} (self-stated)`, who);

  m = t.match(/\bremember(?:\s+that)?\s+(.+)/i);
  if (m) addFact(who, m[1].trim().slice(0, 200), who);

  m = t.match(/\b(dashwho|dakshbro|ultimate rewards)\s+is\s+(.+)/i);
  if (m) addFact(m[1], `${m[1]} is ${m[2].trim().slice(0, 200)}`, who);
}

function factsForPrompt(userText) {
  const store = getFactsStore();
  const lower = String(userText || '').toLowerCase();
  const chunks = [];

  for (const key of ['dashwho', 'dakshbro', 'ultimate rewards', 'dashmod']) {
    if (store.people[key]?.length) {
      chunks.push(`Known about ${key}:\n- ` + store.people[key].slice(-8).join('\n- '));
    }
  }

  for (const [key, arr] of Object.entries(store.people)) {
    if (key.length < 2) continue;
    if (lower.includes(key) && !['dashwho', 'dakshbro', 'ultimate rewards', 'dashmod'].includes(key)) {
      chunks.push(`Known about ${key}:\n- ` + arr.slice(-12).join('\n- '));
    }
  }

  const who = lower.match(/\bwho is\s+([a-z0-9_\-. ]{2,40})\??/);
  if (who) {
    const k = who[1].trim().toLowerCase();
    const arr = store.people[k];
    if (arr?.length) {
      chunks.push(`ANSWER USING THESE FACTS about ${k}:\n- ` + arr.join('\n- '));
    }
  }

  return chunks.join('\n\n').slice(0, 3500);
}

function exactWorkingReply(text) {
  const t = String(text || '').trim();
  if (/^is my bot working\?$/i.test(t)) {
    return 'Idk which bot you are talking but I am online';
  }
  return null;
}

function systemPrompt() {
  return [
    'You are DashMod, powered by DashWho-M.8.1-lb (Ultimate Rewards Discord assistant).',
    'Be friendly, slightly playful, clear, and concise. Use short paragraphs.',
    'You remember useful facts about people from prior chats (provided in context). When asked "who is X", summarize saved facts naturally.',
    'Never ping Discord roles or users with @. Refer to roles by name only.',
    'If asked which AI/model/API you use, reply EXACTLY that you use DashWho-M.8.1-lb. Never say OpenAI, Groq, GPT, Llama, Claude, Grok, or Gemini.',
    'If asked who coded you: Coded by DashWho, Enhanced by DakshBro.',
    'Hard facts you already know:',
    '- DashWho: ~22, content creator (~43 subs), Ultimate Rewards staff-side, friends with DakshBro, Free Fire Max + Minecraft, Cart PvP Low-Tier 3.',
    '- DakshBro: Founder/Owner of Ultimate Rewards, 14, birthday 18 October, rebuilt after raids, Free Fire Max + Minecraft, friends with DashWho.',
    'Only treat informative personal facts as memory-worthy. Ignore spam, pure greetings, and low-value noise like "4/10 online".',
    'Refuse illegal help: scams, phishing, hacking, account theft, carding, doxxing.'
  ].join(' ');
}

async function askAI(userText, channelId, userId, displayName) {
  try {
    const exact = exactWorkingReply(userText);
    if (exact) return { text: exact };

    extractFactsFromMessage(userText, displayName || userId, userId);

    const key = cleanKey(env.OPENAI_API_KEY);
    if (!key) return { error: 'No OPENAI_API_KEY or GROQ_API_KEY in env.' };

    let base = (env.OPENAI_BASE_URL || '').replace(/\/$/, '');
    if (!base) {
      base = /^gsk_/i.test(key) ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    }

    let model = (env.OPENAI_MODEL || '').trim();
    if (!model) {
      model = /groq\.com/i.test(base) || /^gsk_/i.test(key) ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
    }

    const history = chatMemory.get(memKey(channelId, userId)) || [];
    const factBlock = factsForPrompt(userText);

    const messages = [
      { role: 'system', content: systemPrompt() },
      ...(factBlock
        ? [{ role: 'system', content: 'Long-term memory facts (use when relevant):\n' + factBlock }]
        : []),
      ...history,
      { role: 'user', content: String(userText || 'hi').slice(0, 4000) }
    ];

    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({ model, temperature: 0.6, max_tokens: 900, messages })
    });

    const raw = await res.text();
    let j = {};
    try {
      j = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return { error: `Bad JSON HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { error: `${j?.error?.message || j?.message || 'HTTP ' + res.status} | model=${model}` };
    }
    const text = j?.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: `Empty response | model=${model}` };

    pushMemory(channelId, userId, 'user', userText);
    pushMemory(channelId, userId, 'assistant', text);
    return { text: text.slice(0, 1900) };
  } catch (e) {
    return { error: e.message || 'AI failed' };
  }
}

function clearChatMemory(channelId, userId) {
  chatMemory.delete(memKey(channelId, userId));
}

function listFacts(about) {
  const store = getFactsStore();
  if (!about) return store.people;
  return store.people[String(about).toLowerCase()] || [];
}

module.exports = { askAI, clearChatMemory, listFacts, addFact, getFactsStore };
