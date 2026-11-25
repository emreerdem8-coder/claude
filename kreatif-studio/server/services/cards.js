// Task cards ("GÖREV ###") per batch, following prompts/kreatif.txt.
import { loadPrompts } from '../framework.js';
import fs from 'node:fs';
import path from 'node:path';
import { jsonCompletion, aiSettings } from '../ai/openai.js';
import { Batches, Creatives, UPLOAD_DIR } from '../store.js';
import { identityText, briefText } from './brand.js';
import { getStrategy, groupItems, strategyAsText } from './strategy.js';

export const LAYOUTS = {
  'studio-hero': 'Stüdyo ürün kahramanı',
  'in-hand-lifestyle': 'Elde ürün, gerçek ortam',
  'text-on-object': 'Yazı sahnedeki bir nesnenin üzerinde (not defteri, ayna, kutu, ekran)',
  'typographic-poster': 'Tipografi ağırlıklı afiş',
  'screen-mockup': 'Telefon/ekran arayüzü (mesaj, arama, e-posta)',
  'split-comparison': 'İkiye bölünmüş karşılaştırma',
  'collage-grid': 'Kolaj / grid',
  'macro-detail': 'Makro detay çekimi',
  'diagram-annotated': 'Şema, oklar ve açıklama etiketleri',
  'handwritten-note': 'El yazısı / karalama / doodle',
  'environment-wide': 'Geniş mekân, ürün sahnenin parçası',
  'model-portrait': 'Model portresi, ürünle',
  'packaging-unboxing': 'Ambalaj / kutu açılımı',
  'offer-card': 'Teklif / fiyat kartı',
};
export const BACKGROUNDS = ['light-neutral', 'dark', 'brand-color', 'photo-scene', 'bold-contrast'];
export const PLACEMENTS = ['top', 'bottom', 'left-column', 'right-column', 'integrated-in-scene', 'center-overlay', 'annotation-callouts'];

const cardProps = {
  id: { type: 'string' },
  funnel: { type: 'string', enum: ['cold', 'warm', 'hot'] },
  hook: { type: 'string', description: 'İlk 1 saniyede kaydırmayı durduran şey' },
  sales_angle: { type: 'string', description: 'Satış açısı: hangi arzu/itiraz/teklif üzerinden satıyor' },
  sales_logic: { type: 'string' },
  layout: { type: 'string', enum: Object.keys(LAYOUTS) },
  background: { type: 'string', enum: BACKGROUNDS },
  text_placement: { type: 'string', enum: PLACEMENTS },
  format: { type: 'string', enum: ['4:5', '1:1', '9:16'] },
  format_reason: { type: 'string' },
  headline: { type: 'string' },
  subline: { type: 'string' },
  cta: { type: 'string' },
  visual: { type: 'string' },
  brand_application: { type: 'string' },
  primary_text: { type: 'string' },
  required_data: {
    type: 'array',
    items: { type: 'object', additionalProperties: false, required: ['token', 'label'], properties: { token: { type: 'string' }, label: { type: 'string' } } },
  },
  improvement: { type: 'string' },
};
const cardSchema = { type: 'object', additionalProperties: false, required: Object.keys(cardProps), properties: cardProps };

const DIVERSITY = `
REKLAM KÖRLÜĞÜNE KARŞI ÇEŞİTLİLİK (zorunlu):
- Her kartta "layout", "background" ve "text_placement" seç. Aynı batch'te iki kart aynı layout'u kullanamaz. Bir background veya text_placement değeri batch içinde en fazla 3 kez kullanılır.
- Önceki batch'lerde çok kullanılan layout'lardan kaçın; az kullanılanları tercih et.
- Kamera açısı, ışık, renk hâkimiyeti, sahne ve tipografi ağırlığı kartlar arasında belirgin şekilde farklı olsun. Aynı başlık kalıbı, aynı CTA veya aynı fayda iki kez tekrar etmesin.
Layout sözlüğü:
${Object.entries(LAYOUTS).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

SATIŞ ODAĞI (zorunlu):
- "hook": izleyicinin ilk 1 saniyede neden duracağını yaz (merak boşluğu, somut rakam, tanıdık acı, şaşırtıcı görüntü vb.).
- "sales_angle": kartın hangi arzu, itiraz, kanıt veya teklif üzerinden sattığını yaz. Kategori amacına hizmet etsin.
- Başlık özellik değil sonuç/duygu satsın; jenerik slogan ("Kaliteyi keşfet", "Farkı hisset") yasak.
- CTA'lar kartlar arasında çeşitlensin ve funnel aşamasına uysun (cold: keşif, warm: incele/karşılaştır, hot: satın al/sepete ekle).
- Yazı mümkünse sahnenin içine doğal olarak yerleşsin (not defteri, ayna, ambalaj, ekran) veya editoryal bir tipografi düzeniyle dursun; ucuz banner görünümü olmasın.`;

const CRITIC = `Sen kıdemli bir performans pazarlamacısı ve kreatif direktörsün. Sana bir markanın görev kartları verilecek. Her kartı acımasız ama adil puanla (1–10):
- Strateji sadakati: kart, strateji satırını ve kategori amacını birebir uyguluyor mu? (en önemli)
- Satış gücü: hook gerçekten kaydırmayı durdurur mu, satış açısı net mi, başlık sonuç satıyor mu, CTA funnel'a uygun mu?
- Marka uyumu: ton, renk, tipografi, premium his.
- Üretilebilirlik: görsel kurgu somut mu, bir görsel modeli bunu temiz üretebilir mi? Kalabalık mı?
- Özgünlük: diğer kartlardan ve önceki batch'lerden ayrışıyor mu?
- Doğruluk: uydurma veri, sahte yorum/rakam var mı? Varsa en fazla 4.
- Türkçe: başlık ≤7, alt metin ≤12 kelime, yazım kusursuz mu?
9–10 yalnızca bir üst düzey ajansın bu haliyle yayına alacağı kart için. "must_fix" alanına kartı 9+ yapacak somut düzeltmeleri Türkçe yaz.`;

const OVERRIDE = `
---
UYGULAMA NOTU (bu bölüm yukarıdaki iş akışının teknik kısmını değiştirir):
- Bu uygulamada görev kartlarını bir batch için toplu hazırlıyorsun; görseller kullanıcı her kartı onayladıktan sonra ayrı ayrı üretilecek. Görsel üretme.
- Çıktıyı JSON şemasına göre ver. "Strateji (verbatim)" alanını sistem listeden birebir kopyalar; sen yazma.
- headline en fazla ~7 kelime, subline en fazla ~12 kelime, Türkçe karakterler kusursuz. subline/cta gerekmiyorsa boş string bırak.
- "visual": sahne, kompozisyon, kamera açısı, ışık, arka plan, ürün yerleşimi, model (varsa), aksesuarlar. Somut ve üretilebilir yaz.
- "brand_application": logo yerleşimi, kullanılan HEX renkler, yazı tipi, atmosfer.
- "primary_text": reklamın gönderi metni, Türkçe, 2–4 kısa satır + CTA. Satırları \\n ile ayır.
- Gerçek olmayan veri gerekiyorsa kartta [GERÇEK FİYAT], [KALAN STOK], [MÜŞTERİ YORUMU], [KAMPANYA BİTİŞ TARİHİ] gibi köşeli parantezli yer tutucu kullan ve her birini required_data listesine ekle (token alanı köşeli parantezle birlikte birebir aynı olsun). Brifte gerçek değer varsa yer tutucu kullanma, değeri doğrudan yaz.
- "temsili" ifadesi geçen stratejilerde görselin üzerine görünür "Temsili örnektir" etiketi koy ve bunu visual alanında belirt.
- "improvement": strateji yazıldığı gibi uygulandıktan sonra tek satırlık isteğe bağlı iyileştirme önerisi; yoksa boş string.
- "psychology": batch'in satış psikolojisi, 2–3 cümle.`;

function context(brand, strategy) {
  return `1) MARKA KİMLİĞİ — TEK DOĞRU KAYNAK\n${identityText(brand)}\n\nMarka brifi (gerçek veriler buradan):\n${briefText(brand)}\n\n2) KREATİF STRATEJİ LİSTESİ — TEK DOĞRU KAYNAK\n${strategyAsText(strategy)}`;
}

export const creativeId = (brandId, num) => `${brandId}_${num}`;
export const batchId = (brandId, letter) => `${brandId}_${letter}`;

export function getBatch(brandId, letter) {
  return Batches.get(batchId(brandId, letter));
}

const BATCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['psychology', 'cards'],
  properties: { psychology: { type: 'string' }, cards: { type: 'array', items: cardSchema } },
};

function usedLayouts(brandId, exceptLetter) {
  const counts = {};
  for (const c of Creatives.all((x) => x.brandId === brandId && x.letter !== exceptLetter)) {
    const l = c.card?.layout;
    if (l) counts[l] = (counts[l] || 0) + 1;
  }
  return counts;
}

function referenceImages(brand) {
  return (brand.assets?.references || []).slice(0, 4).map((r) => {
    const buf = fs.readFileSync(path.join(UPLOAD_DIR, r.file));
    return `data:${r.mime};base64,${buf.toString('base64')}`;
  });
}

/** Code-level diversity check: returns {id: reason}. */
export function diversityIssues(cards) {
  const out = {};
  const by = (k) => cards.reduce((m, c) => ((m[c[k]] = [...(m[c[k]] || []), c.id]), m), {});
  for (const [layout, ids] of Object.entries(by('layout'))) if (ids.length > 1) ids.slice(1).forEach((i) => (out[i] = `"${layout}" layout'u ${ids[0]} ile aynı; farklı bir layout seç.`));
  for (const k of ['background', 'text_placement']) {
    for (const [v, ids] of Object.entries(by(k))) if (ids.length > 3) ids.slice(3).forEach((i) => (out[i] = (out[i] ? out[i] + ' ' : '') + `${k}="${v}" batch'te 3'ten fazla kullanıldı.`));
  }
  const heads = by('headline');
  for (const ids of Object.values(heads)) if (ids.length > 1) ids.slice(1).forEach((i) => (out[i] = (out[i] ? out[i] + ' ' : '') + 'Başlık başka kartla aynı.'));
  const ctas = by('cta');
  for (const [v, ids] of Object.entries(ctas)) if (v && ids.length > 2) ids.slice(2).forEach((i) => (out[i] = (out[i] ? out[i] + ' ' : '') + `CTA "${v}" çok tekrar ediyor.`));
  return out;
}

async function critique(brand, strategy, cards) {
  const schema = {
    type: 'object', additionalProperties: false, required: ['reviews'],
    properties: {
      reviews: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'score', 'strengths', 'must_fix'],
          properties: { id: { type: 'string' }, score: { type: 'integer' }, strengths: { type: 'string' }, must_fix: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
  };
  const { data } = await jsonCompletion({
    name: 'card_critic',
    schema,
    maxTokens: 16000,
    model: aiSettings().visionModel,
    system: CRITIC,
    user: `${context(brand, strategy)}\n\nKARTLAR:\n${JSON.stringify(cards.map(({ id, formatName, strategyVerbatim, goal, funnel, hook, sales_angle, layout, background, text_placement, headline, subline, cta, visual, primary_text, required_data }) => ({ id, formatName, strategyVerbatim, goal, funnel, hook, sales_angle, layout, background, text_placement, headline, subline, cta, visual, primary_text, required_data })), null, 1)}`,
  });
  return Object.fromEntries(data.reviews.map((r) => [String(r.id).padStart(3, '0'), { ...r, score: Math.max(1, Math.min(10, Math.round(r.score))) }]));
}

async function rewriteCards(brand, strategy, letter, items, current, problems) {
  const { creative } = loadPrompts();
  const group = strategy.groups.find((g) => g.letter === letter);
  const ids = Object.keys(problems);
  const keep = current.filter((c) => !ids.includes(c.id));
  const { data } = await jsonCompletion({
    name: 'task_cards_fix',
    schema: { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: { type: 'array', items: cardSchema } } },
    system: creative + OVERRIDE + DIVERSITY + '\n- Bu çağrıda yalnızca düzeltilmesi istenen kartları yeniden yaz. Stratejiden sapma. Diğer kartlarla aynı layout/başlık/CTA kullanma.',
    images: referenceImages(brand),
    user: `${context(brand, strategy)}\n\nBATCH ${letter} — ${group.name}\nAmaç: ${group.goal}\n\nDOKUNULMAYAN KARTLAR (tekrar etme): ${keep.map((c) => `${c.id} layout=${c.layout} bg=${c.background} text=${c.text_placement} başlık="${c.headline}" cta="${c.cta}"`).join(' | ')}\n\nDÜZELTİLECEK KARTLAR:\n${ids
      .map((i) => `${JSON.stringify(current.find((c) => c.id === i))}\nSorunlar: ${problems[i]}`)
      .join('\n\n')}`,
  });
  const map = Object.fromEntries(data.cards.map((c) => [String(c.id).padStart(3, '0'), c]));
  return current.map((c) => (map[c.id] ? sanitize(map[c.id], items.find((i) => i.id === c.id), group) : c));
}

export async function generateCards(brand, letter, note) {
  const { creative } = loadPrompts();
  const strategy = getStrategy(brand.id);
  const group = strategy.groups.find((g) => g.letter === letter);
  if (!group?.approved) throw Object.assign(new Error(`${letter} grubu onaylanmadan görev kartları hazırlanamaz.`), { status: 409 });
  const items = groupItems(strategy, letter);
  const ids = items.map((i) => i.id);
  const batchNo = strategy.groups.findIndex((g) => g.letter === letter) + 1;
  const used = usedLayouts(brand.id, letter);
  const refs = referenceImages(brand);
  const { data } = await jsonCompletion({
    name: 'task_cards',
    schema: BATCH_SCHEMA,
    images: refs,
    system: creative + OVERRIDE + DIVERSITY,
    user: `${context(brand, strategy)}\n\n${refs.length ? 'Ekteki görseller bu markanın onaylı kalite çıtası örnekleridir. Bu seviyede, editoryal ve gerçekçi kurgular yaz; ama kompozisyonlarını kopyalama.\n\n' : ''}Önceki batch'lerde kullanılan layout'lar: ${Object.entries(used).map(([k, v]) => `${k}×${v}`).join(', ') || 'yok'}\n\nBATCH ${batchNo} = ${letter} — ${group.name}\nAmaç: ${group.goal}\nBu batch'in 10 maddesi:\n${items
      .map((i) => `${i.id}${i.star ? ' ★' : ''} ${i.strategyAdapted} → ${i.idea}`)
      .join('\n')}\n\n${note ? `Kullanıcı notu: ${note}\n\n` : ''}Bu 10 madde için görev kartlarını hazırla (id: ${ids.join(', ')}).`,
  });

  const byId = Object.fromEntries(data.cards.map((c) => [String(c.id).padStart(3, '0'), c]));
  const missing = ids.filter((i) => !byId[i]);
  if (missing.length) throw new Error(`Model şu kartları atladı: ${missing.join(', ')}. Tekrar dene.`);
  let list = items.map((it) => sanitize(byId[it.id], it, group));

  // Quality gate: code-level diversity check + critic. Anything under 9 or colliding is rewritten
  // (max 2 rounds) and re-scored.
  const minScore = 9;
  let reviews = await critique(brand, strategy, list);
  for (let round = 0; round < 2; round++) {
    const problems = {};
    const div = diversityIssues(list);
    for (const c of list) {
      const r = reviews[c.id];
      const bits = [];
      if (r && r.score < minScore) bits.push(...r.must_fix);
      if (div[c.id]) bits.push(div[c.id]);
      if (bits.length) problems[c.id] = bits.join(' ');
    }
    if (!Object.keys(problems).length) break;
    list = await rewriteCards(brand, strategy, letter, items, list, problems);
    reviews = { ...reviews, ...(await critique(brand, strategy, list.filter((c) => problems[c.id]))) };
  }
  for (const c of list) c.critic = reviews[c.id] || null;

  for (const card of list) {
    const cid = creativeId(brand.id, card.id);
    const prev = Creatives.get(cid);
    if (prev) Creatives.update(cid, { card, cardStatus: 'draft', data: keepData(prev.data, card) });
    else Creatives.insert({ id: cid, brandId: brand.id, num: card.id, letter, card, cardStatus: 'draft', data: keepData({}, card), status: 'idle', images: [], current: -1, provider: brand.provider || 'openai' });
  }
  const bid = batchId(brand.id, letter);
  const batch = { id: bid, brandId: brand.id, letter, psychology: data.psychology, ids, diversity: diversityIssues(list) };
  return Batches.get(bid) ? Batches.update(bid, batch) : Batches.insert(batch);
}

function sanitize(c, item, group) {
  return {
    ...c,
    id: item.id,
    star: item.star,
    formatName: item.strategyAdapted,
    strategyVerbatim: `${item.id}${item.star ? ' ★' : ''} ${item.strategyAdapted} → ${item.idea}`,
    goal: group.goal,
    required_data: (c.required_data || []).filter((r) => /^\[.+\]$/.test(r.token?.trim())),
  };
}

function keepData(prev, card) {
  const out = {};
  for (const r of card.required_data) out[r.token] = prev?.[r.token] || '';
  return out;
}

export async function reviseCard(brand, cid, note) {
  const { creative } = loadPrompts();
  const cr = Creatives.get(cid);
  if (!cr) throw Object.assign(new Error('Kart bulunamadı'), { status: 404 });
  const strategy = getStrategy(brand.id);
  const group = strategy.groups.find((g) => g.letter === cr.letter);
  const item = strategy.items[cr.num];
  const schema = { type: 'object', additionalProperties: false, required: ['card'], properties: { card: cardSchema } };
  const { card: old } = cr;
  const { data } = await jsonCompletion({
    name: 'task_card_revise',
    schema,
    maxTokens: 10000,
    system: creative + OVERRIDE + DIVERSITY + '\n- Bu çağrıda tek bir kartı kullanıcının revize notuna göre güncelliyorsun. Stratejiden sapma. Batch\'teki diğer kartlarla aynı layout\'u kullanma.',
    user: `${context(brand, strategy)}\n\nBATCH'TEKİ DİĞER KARTLAR: ${Creatives.all((x) => x.brandId === brand.id && x.letter === cr.letter && x.id !== cid).map((x) => `${x.num} layout=${x.card.layout} başlık="${x.card.headline}"`).join(' | ')}\n\nMEVCUT KART (GÖREV ${cr.num}):\n${JSON.stringify(old, null, 1)}\n\nREVİZE: ${note}`,
  });
  const card = sanitize(data.card, item, group);
  try { card.critic = (await critique(brand, strategy, [card]))[card.id] || null; } catch { card.critic = null; }
  return Creatives.update(cid, (c) => ({ ...c, card, cardStatus: 'draft', data: keepData(c.data, card) }));
}

export function editCard(cid, patch) {
  const allowed = ['headline', 'subline', 'cta', 'visual', 'brand_application', 'primary_text', 'format', 'layout', 'background', 'text_placement', 'hook', 'sales_angle'];
  return Creatives.update(cid, (c) => {
    const card = { ...c.card };
    for (const k of allowed) if (typeof patch[k] === 'string') card[k] = patch[k];
    return { ...c, card, cardStatus: 'draft' };
  });
}

export function setCardData(cid, values) {
  return Creatives.update(cid, (c) => ({ ...c, data: { ...c.data, ...values } }));
}

export function missingData(cr) {
  return (cr.card.required_data || []).filter((r) => !cr.data?.[r.token]?.trim()).map((r) => r.token);
}

export function fill(text, data) {
  let out = text || '';
  for (const [k, v] of Object.entries(data || {})) if (v) out = out.split(k).join(v);
  return out;
}
