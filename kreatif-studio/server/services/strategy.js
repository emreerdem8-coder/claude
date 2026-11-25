// Adapts the raw 100-strategy skeleton to a brand. The skeleton (ids, groups, ★, strategy names)
// always comes from prompts/strateji.txt, never from the model, so structure can't drift.
import { loadPrompts, loadSkeleton } from '../framework.js';
import { jsonCompletion } from '../ai/openai.js';
import { Strategies } from '../store.js';
import { briefText, identityText } from './brand.js';

const itemSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'strategy', 'idea'],
  properties: {
    id: { type: 'string', description: '001–100' },
    strategy: { type: 'string', description: 'Strateji adı; gerekirse anlamı korunarak ürüne uyarlanmış' },
    idea: { type: 'string', description: 'Kısa başlık veya somut görsel fikri, 8–18 kelime' },
  },
};

const OUTPUT_OVERRIDE = `
---
UYGULAMA NOTU (bu bölüm yukarıdaki talimatın çıktı kısmını teknik olarak değiştirir):
- Marka brifi bu mesajda verildi. Brif isteme, doğrudan uyarlamaya geç.
- Çıktıyı istenen JSON şemasında ver. "strategy" alanı strateji adıdır (gerekirse kural 4'e göre anlamı korunarak uyarlanır), "idea" alanı okun (→) sağındaki kısa fikirdir.
- Numaraları, grupları ve ★ işaretlerini sistem korur; sen her id için tam bir fikir yaz.
- "goal" alanı grubun markaya uyarlanmış tek kısa cümlelik amacıdır.
- "missing_info" yalnızca gerçekten eksik olan bilgilerin kısa listesidir.
- Son kontrolü sessizce yap.`;

function skeletonList(skel, letters) {
  return skel.groups
    .filter((g) => !letters || letters.includes(g.letter))
    .map((g) => [`${g.letter} — ${g.name}`, `Amaç: ${g.goal}`, ...g.items.map((i) => `${i.id}${i.star ? ' ★' : ''} ${i.strategy}`)].join('\n'))
    .join('\n\n');
}

function contextBlock(brand) {
  return `MARKA: ${brand.name}\n\nMARKA BRİFİ\n${briefText(brand)}\n\nMARKA KİMLİĞİ\n${identityText(brand)}`;
}

function currentList(strategy, excludeIds = []) {
  return Object.values(strategy.items)
    .filter((i) => !excludeIds.includes(i.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((i) => `${i.id}${i.star ? ' ★' : ''} ${i.strategyAdapted} → ${i.idea}`)
    .join('\n');
}

function blankStrategy(brandId, skel) {
  return {
    id: brandId,
    brandId,
    status: 'empty',
    groups: skel.groups.map((g) => ({ letter: g.letter, name: g.name, baseGoal: g.goal, goal: g.goal, approved: false })),
    items: Object.fromEntries(skel.items.map((i) => [i.id, { ...i, strategyAdapted: i.strategy, idea: '', edited: false }])),
    missingInfo: [],
  };
}

export function getStrategy(brandId) {
  return Strategies.get(brandId) || Strategies.insert(blankStrategy(brandId, loadSkeleton()));
}

export function validate(strategy) {
  const issues = [];
  const items = Object.values(strategy.items);
  if (items.length !== 100) issues.push(`${items.length} madde var, 100 olmalı`);
  for (const g of strategy.groups) {
    const n = items.filter((i) => i.group === g.letter).length;
    if (n !== 10) issues.push(`${g.letter} grubunda ${n} madde var`);
  }
  const empty = items.filter((i) => !i.idea?.trim()).map((i) => i.id);
  if (empty.length) issues.push(`Boş fikir: ${empty.join(', ')}`);
  const long = items.filter((i) => i.idea.split(/\s+/).length > 26).map((i) => i.id);
  if (long.length) issues.push(`Çok uzun satır (26+ kelime): ${long.join(', ')}`);
  // Repetition check: the same idea text reused.
  const seen = new Map();
  for (const i of items) {
    const k = i.idea.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N} ]/gu, '').trim();
    if (k && seen.has(k)) issues.push(`${seen.get(k)} ve ${i.id} aynı fikir`);
    else seen.set(k, i.id);
  }
  const flags = items.filter((i) => /\[[^\]]*(gerekli|ONAY)[^\]]*\]/i.test(i.idea)).map((i) => i.id);
  return { ok: issues.length === 0, issues, flagged: flags };
}

function apply(strategy, items, skel) {
  const byId = Object.fromEntries(skel.items.map((i) => [i.id, i]));
  for (const it of items) {
    const id = String(it.id).trim().padStart(3, '0');
    if (!byId[id] || !strategy.items[id]) continue;
    strategy.items[id] = { ...strategy.items[id], strategyAdapted: it.strategy?.trim() || byId[id].strategy, idea: it.idea.trim(), edited: false };
  }
}

export async function generateAll(brand) {
  const { strategy: prompt } = loadPrompts();
  const skel = loadSkeleton();
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['groups', 'items', 'missing_info'],
    properties: {
      groups: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['letter', 'goal'], properties: { letter: { type: 'string', enum: skel.groups.map((g) => g.letter) }, goal: { type: 'string' } } },
      },
      items: { type: 'array', items: itemSchema },
      missing_info: { type: 'array', items: { type: 'string' } },
    },
  };
  // Two halves (A–E, then F–J with the first half as "do not repeat" context): keeps each call well
  // under HTTP timeouts while the second half still sees the first.
  const halves = [['A', 'B', 'C', 'D', 'E'], ['F', 'G', 'H', 'I', 'J']];
  const data = { groups: [], items: [], missing_info: [] };
  for (const letters of halves) {
    const before = data.items.length
      ? `\n\nİLK YARIDA YAZILAN FİKİRLER (tekrar etme, farklı açı ve fayda kullan):\n${data.items.map((i) => `${i.id} ${i.strategy} → ${i.idea}`).join('\n')}`
      : '';
    const { data: part } = await jsonCompletion({
      name: 'strategy_100',
      schema,
      system: prompt + OUTPUT_OVERRIDE + `\n- Bu çağrıda yalnızca ${letters.join(', ')} gruplarını (${letters.length * 10} fikir) üret. Diğer gruplar ayrı üretilir.`,
      user: `${contextBlock(brand)}\n\nKORUNACAK 100 STRATEJİ (id, ★ ve grup sabit)\n${skeletonList(skel)}${before}\n\nŞimdi yalnızca ${letters.join(', ')} gruplarının ${letters.length * 10} fikrini üret.`,
    });
    data.groups.push(...part.groups.filter((g) => letters.includes(g.letter)));
    data.items.push(...part.items);
    data.missing_info.push(...(part.missing_info || []));
  }
  data.missing_info = [...new Set(data.missing_info)];

  const st = blankStrategy(brand.id, skel);
  const prev = Strategies.get(brand.id);
  st.groups = st.groups.map((g) => ({ ...g, goal: data.groups.find((x) => x.letter === g.letter)?.goal?.trim() || g.baseGoal }));
  apply(st, data.items, skel);
  st.missingInfo = data.missing_info || [];

  // Repair pass: if the model skipped any id, ask only for those.
  const missing = Object.values(st.items).filter((i) => !i.idea).map((i) => i.id);
  if (missing.length) {
    const fix = await regenerateItems(brand, st, missing, 'Bu satırlar eksik kaldı, tamamla.');
    apply(st, fix, skel);
  }
  st.status = 'review';
  st.generatedAt = new Date().toISOString();
  st.version = (prev?.version || 0) + 1;
  if (prev) Strategies.remove(brand.id);
  return Strategies.insert(st);
}

async function regenerateItems(brand, strategy, ids, note) {
  const { strategy: prompt } = loadPrompts();
  const skel = loadSkeleton();
  const targets = skel.items.filter((i) => ids.includes(i.id));
  const schema = {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: itemSchema } },
  };
  const { data } = await jsonCompletion({
    name: 'strategy_items',
    schema,
    maxTokens: 12000,
    system: prompt + OUTPUT_OVERRIDE + `\n- Bu çağrıda yalnızca istenen satırları yeniden yaz. Mevcut diğer satırları tekrar etme; onlardan farklı açı, fayda ve anlatım kullan.`,
    user: `${contextBlock(brand)}\n\nMEVCUT LİSTE (tekrar etme)\n${currentList(strategy, ids)}\n\nYENİDEN YAZILACAK SATIRLAR\n${targets
      .map((t) => `${t.id}${t.star ? ' ★' : ''} ${t.strategy} (Grup ${t.group}: ${strategy.groups.find((g) => g.letter === t.group)?.goal})\n   Şu anki hali: ${strategy.items[t.id]?.idea || '(boş)'}`)
      .join('\n')}\n\nKullanıcı notu: ${note || 'Daha güçlü, ürüne daha özgü ve somut yaz.'}`,
  });
  return data.items;
}

export async function regenerate(brand, ids, note) {
  const st = getStrategy(brand.id);
  const items = await regenerateItems(brand, st, ids, note);
  return Strategies.update(brand.id, (cur) => {
    const next = structuredClone(cur);
    apply(next, items, loadSkeleton());
    const letters = new Set(ids.map((i) => next.items[i].group));
    next.groups = next.groups.map((g) => (letters.has(g.letter) ? { ...g, approved: false } : g));
    return next;
  });
}

export function editItem(brandId, itemId, { idea, strategyAdapted }) {
  return Strategies.update(brandId, (cur) => {
    const next = structuredClone(cur);
    const it = next.items[itemId];
    if (!it) throw Object.assign(new Error('Madde bulunamadı'), { status: 404 });
    if (typeof idea === 'string') it.idea = idea.trim();
    if (typeof strategyAdapted === 'string' && strategyAdapted.trim()) it.strategyAdapted = strategyAdapted.trim();
    it.edited = true;
    next.groups = next.groups.map((g) => (g.letter === it.group ? { ...g, approved: false } : g));
    return next;
  });
}

export function setGroupApproval(brandId, letter, approved) {
  return Strategies.update(brandId, (cur) => {
    const next = structuredClone(cur);
    next.groups = next.groups.map((g) => (g.letter === letter ? { ...g, approved, approvedAt: approved ? new Date().toISOString() : null } : g));
    if (next.groups.every((g) => g.approved)) next.status = 'approved';
    else if (next.status === 'approved') next.status = 'review';
    return next;
  });
}

export function groupItems(strategy, letter) {
  return Object.values(strategy.items).filter((i) => i.group === letter).sort((a, b) => a.id.localeCompare(b.id));
}

export function strategyAsText(strategy) {
  return strategy.groups
    .map((g) => [`${g.letter} — ${g.name}`, `Amaç: ${g.goal}`, ...groupItems(strategy, g.letter).map((i) => `${i.id}${i.star ? ' ★' : ''} ${i.strategyAdapted} → ${i.idea}`)].join('\n'))
    .join('\n\n');
}
