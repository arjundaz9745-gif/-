const env = require('../config/env');

async function askAI(userText) {
  if (!env.OPENAI_API_KEY) return null;
  let base = env.OPENAI_BASE_URL;
  if (!base) base = /^gsk_/i.test(env.OPENAI_API_KEY) ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1';
  let model = env.OPENAI_MODEL;
  if (!model) model = /groq\.com/i.test(base) || /^gsk_/i.test(env.OPENAI_API_KEY) ? 'openai/gpt-oss-20b' : 'gpt-4o-mini';
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.OPENAI_API_KEY },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 700,
        messages: [
          { role: 'system', content: 'You are DashMod, a strict Discord protection assistant. Be concise.' },
          { role: 'user', content: userText || 'hi' }
        ]
      })
    });
    const j = await res.json().catch(() => ({}));
    return res.ok ? j?.choices?.[0]?.message?.content?.trim()?.slice(0, 1900) || null : null;
  } catch (_) {
    return null;
  }
}

module.exports = { askAI };
