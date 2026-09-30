const env = require('../config/env');

function cleanKey(k) {
  return String(k || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '');
}

async function askAI(userText) {
  try {
    const key = cleanKey(env.OPENAI_API_KEY);
    if (!key) return { error: 'No OPENAI_API_KEY or GROQ_API_KEY in env.' };

    let base = (env.OPENAI_BASE_URL || '').replace(/\/$/, '');
    if (!base) {
      base = /^gsk_/i.test(key) ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    }

    // Prefer env; free Groq → openai/gpt-oss-20b (llama-3.3 often blocked)
    let model = (env.OPENAI_MODEL || '').trim();
    if (!model) {
      model = /groq\.com/i.test(base) || /^gsk_/i.test(key) ? 'openai/gpt-oss-20b' : 'gpt-4o-mini';
    }
    // Never force llama-3.3 — free keys often lack access
    if (/llama-3\.3-70b|llama-3\.1-8b-instant/i.test(model) && (/^gsk_/i.test(key) || /groq\.com/i.test(base))) {
      model = 'openai/gpt-oss-20b';
    }

    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model,
        temperature: 0.5,
        max_tokens: 800,
        messages: [
          {
            role: 'system',
            content: 'You are DashMod (ᴅᴀꜱʜᴍᴏᴅ), a Discord assistant for Ultimate Rewards. Be clear, friendly, and concise. ' +
              'If asked which AI/model/API you use, say you use DashWho-m4.4-lb. Never mention OpenAI, Groq, GPT, Llama, or other real providers. ' +
              'If asked who made/created/coded you, say DashWho and DakshBro (Coded by DashWho, Enhanced by DakshBro). ' +
              'Stay in character as DashMod.'
          },
          { role: 'user', content: String(userText || 'hi').slice(0, 4000) }
        ]
      })
    });

    const raw = await res.text();
    let j = {};
    try {
      j = raw ? JSON.parse(raw) : {};
    } catch (_) {
      return { error: `Bad JSON HTTP ${res.status}` };
    }

    if (!res.ok) {
      const msg = j?.error?.message || j?.message || `HTTP ${res.status}`;
      return { error: `${msg} | model=${model}` };
    }

    const text = j?.choices?.[0]?.message?.content?.trim();
    if (!text) return { error: `Empty response | model=${model}` };
    return { text: text.slice(0, 1900) };
  } catch (e) {
    return { error: e.message || 'AI failed' };
  }
}

module.exports = { askAI };
