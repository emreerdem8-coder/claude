import { config } from '../env.js';
import { Settings } from '../store.js';

const BASE = 'https://api.openai.com/v1';

export const aiSettings = () => ({ ...config.defaults, ...Settings.get() });

export class AIError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function requireKey() {
  if (!config.openaiKey) throw new AIError('OPENAI_API_KEY tanımlı değil. Proje klasöründeki .env dosyasına ekleyip sunucuyu yeniden başlat.', 400);
}

async function call(pathname, init, { retries = 2 } = {}) {
  requireKey();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + pathname, {
      ...init,
      headers: { Authorization: `Bearer ${config.openaiKey}`, ...(init.headers || {}) },
    });
    if (res.ok) return res.json();
    const body = await res.text();
    let msg = body;
    try { msg = JSON.parse(body).error?.message || body; } catch {}
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2));
      continue;
    }
    throw new AIError(`OpenAI ${res.status}: ${msg}`, res.status);
  }
}

/**
 * Structured JSON completion. `schema` is a strict JSON schema.
 * `images` = array of data URLs attached to the user message (vision).
 */
export async function jsonCompletion({ system, user, schema, name = 'output', model, images = [], maxTokens = 32000 }) {
  const s = aiSettings();
  const content = images.length
    ? [{ type: 'text', text: user }, ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))]
    : user;
  const body = {
    model: model || s.textModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    max_completion_tokens: maxTokens,
  };
  if (s.reasoningEffort) body.reasoning_effort = s.reasoningEffort;
  const data = await call('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const choice = data.choices?.[0];
  if (choice?.message?.refusal) throw new AIError('Model isteği reddetti: ' + choice.message.refusal);
  if (choice?.finish_reason === 'length') throw new AIError('Model yanıtı token sınırına takıldı. Daha düşük reasoning seviyesiyle tekrar dene.');
  try {
    return { data: JSON.parse(choice.message.content), usage: data.usage };
  } catch {
    throw new AIError('Modelden geçerli JSON gelmedi.');
  }
}

const SIZES = { '1:1': '1024x1024', '4:5': '1024x1536', '9:16': '1024x1536' };

/** Returns a PNG Buffer. With reference images uses the edits endpoint (keeps product/logo faithful). */
export async function generateImage({ prompt, aspect = '4:5', references = [] }) {
  const s = aiSettings();
  const size = SIZES[aspect] || '1024x1536';
  let data;
  if (references.length) {
    const form = new FormData();
    form.append('model', s.imageModel);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', s.imageQuality || 'high');
    form.append('n', '1');
    if (s.inputFidelity) form.append('input_fidelity', s.inputFidelity);
    for (const r of references.slice(0, 16)) {
      form.append('image[]', new Blob([r.buffer], { type: r.mime }), r.name);
    }
    data = await call('/images/edits', { method: 'POST', body: form });
  } else {
    data = await call('/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: s.imageModel, prompt, size, quality: s.imageQuality || 'high', n: 1 }),
    });
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new AIError('OpenAI görsel döndürmedi.');
  return Buffer.from(b64, 'base64');
}

export async function ping() {
  const data = await call('/models', { method: 'GET' }, { retries: 0 });
  return (data.data || []).map((m) => m.id);
}
