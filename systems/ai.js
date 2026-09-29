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
    if (!key) {
      return { error: 'No OPENAI_API_KEY or GROQ_API_KEY in env.' };
    }

    let base = (env.OPENAI_BASE_URL || '').replace(/\/$/, '');
    if (!base) {
      base = /^gsk_/i.test(key) ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
    }

    let model = (env.OPENAI_MODEL || '').trim();
    if (!model) {
      model = /groq\.com/i.test(base) || /^gsk_/i.test(key) ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';
    }
    if (/llama-3\.1-8b-instant|gpt-oss|openai\/gpt/i.test(model) && (/groq\.com/i.test(base) || /^gsk_/i.test(key))) {
      model = 'llama-3.3-70b-versatile';
    }

    const url = base + '/chat/completions';
    const res = await fetch(url, {
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
            content:
              'You are DashMod, a helpful Discord server assistant for Ultimate Rewards. Be clear, friendly, and concise.'
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
      return {
        error: `Bad JSON from API (HTTP ${res.status}). model=${model} base=${base}`
      };
    }

    if (!res.ok) {
      const msg =
        j?.error?.message ||
        j?.error?.code ||
        j?.message ||
        raw?.slice(0, 200) ||
        `HTTP ${res.status}`;
      console.error('AI error:', msg, 'model=', model, 'keyPrefix=', key.slice(0, 6));
      return {
        error: `${msg} | model=${model} | key=${key.slice(0, 4)}…`
      };
    }

    const text = j?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { error: `Empty response | model=${model} | choices=${(j?.choices || []).length}` };
    }
    return { text: text.slice(0, 1900), model };
  } catch (e) {
    console.error('AI fetch', e);
    return { error: (e && e.message) || String(e) || 'AI request failed' };
  }
}

module.exports = { askAI };
