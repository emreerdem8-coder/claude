// Image generation pipeline: prompt → provider → crop to aspect → exact logo overlay → vision QA → (optional) one retry.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Brands, Creatives, UPLOAD_DIR, CREATIVE_DIR, now } from '../store.js';
import * as openai from '../ai/openai.js';
import * as ideogram from '../ai/ideogram.js';
import { config } from '../env.js';
import { fill, missingData } from './cards.js';
import { charge, currentUser } from './credits.js';

const TARGET = { '4:5': [1024, 1280], '1:1': [1024, 1024], '9:16': [864, 1536] };
const LAYOUT_HINT = {
  'studio-hero': 'product as the hero on a seamless studio set, sculpted light',
  'in-hand-lifestyle': 'a real hand holding the product in a lived-in, real environment',
  'text-on-object': 'headline physically printed/written on an object in the scene (notebook page, mirror, box, card, screen)',
  'typographic-poster': 'bold editorial typography is the main visual, product small but present',
  'screen-mockup': 'realistic phone/desktop UI (message, search, email) — UI text limited to the given strings',
  'split-comparison': 'two clearly separated halves comparing two states',
  'collage-grid': 'curated grid/collage of 3–4 tightly art-directed frames',
  'macro-detail': 'extreme close-up of material/texture/detail, shallow depth of field',
  'diagram-annotated': 'clean diagram with thin leader lines and small labels',
  'handwritten-note': 'handwritten note, doodle or marker sketch on paper next to the product',
  'environment-wide': 'wide shot of a real place where the product naturally lives',
  'model-portrait': 'natural, unretouched model portrait using the product',
  'packaging-unboxing': 'packaging/unboxing moment, top-down or 3/4 view',
  'offer-card': 'clean offer card layout with the price/offer as the focal point',
};
const POS_LABEL = { 'top-left': 'top-left', 'top-right': 'top-right', 'top-center': 'top-center', 'bottom-left': 'bottom-left', 'bottom-right': 'bottom-right', 'bottom-center': 'bottom-center' };

const readAsset = (ref) => (ref ? { buffer: fs.readFileSync(path.join(UPLOAD_DIR, ref.file)), mime: ref.mime, name: ref.name || ref.file } : null);

export function buildPrompt(brand, cr, fixHint = '') {
  const c = cr.card;
  const d = cr.data;
  const id = brand.identity || {};
  const palette = (id.palette || []).filter((p) => p.hex).map((p) => `${p.hex}${p.name ? ` (${p.name}${p.usage ? ', ' + p.usage : ''})` : ''}`).join('; ');
  const headline = fill(c.headline, d).trim();
  const subline = fill(c.subline, d).trim();
  const cta = fill(c.cta, d).trim();
  const hasProducts = (brand.assets?.products || []).length > 0;
  const mode = brand.logo?.mode === 'product' ? 'product' : brand.assets?.logo ? brand.logo?.mode || 'overlay' : 'none';
  const pos = POS_LABEL[brand.logo?.position] || 'top-left';
  const aspect = c.format || '4:5';

  const text = [`Headline: "${headline}"`];
  if (subline) text.push(`Supporting line: "${subline}"`);
  if (cta) text.push(`CTA button/label: "${cta}"`);

  const lines = [
    `Premium, high-converting Meta (Instagram/Facebook) feed ad creative for the brand "${brand.name}". Agency-level art direction, real photography quality.`,
    `Creative ${c.id} — format: "${c.formatName}". Strategy: ${c.strategyVerbatim}. Category goal: ${c.goal}.`,
    '',
    c.hook ? `SCROLL-STOPPING HOOK (must be obvious in the first second): ${fill(c.hook, d)}` : '',
    c.sales_angle ? `SALES ANGLE: ${fill(c.sales_angle, d)}` : '',
    `SCENE & COMPOSITION: ${fill(c.visual, d)}`,
    c.layout ? `LAYOUT ARCHETYPE: ${c.layout}${LAYOUT_HINT[c.layout] ? ' — ' + LAYOUT_HINT[c.layout] : ''}. Background: ${c.background || 'as described'}. Text placement: ${c.text_placement || 'as described'}.` : '',
    `BRAND APPLICATION: ${fill(c.brand_application, d)}`,
    palette ? `EXACT BRAND COLORS (HEX): ${palette}. Use only these for graphic elements, type and backgrounds.` : '',
    id.headlineFont || id.bodyFont ? `TYPOGRAPHY: headline in the style of ${id.headlineFont || 'a refined sans-serif'}; supporting text in the style of ${id.bodyFont || id.headlineFont || 'a clean sans-serif'}. Clean kerning, strong hierarchy, generous margins.` : '',
    id.photography ? `PHOTOGRAPHY STYLE: ${id.photography}` : '',
    id.designRules ? `DESIGN RULES: ${id.designRules}` : '',
    '',
    `ON-IMAGE TEXT — Turkish. Render these strings EXACTLY, character for character, with correct Turkish letters (ç ğ ı İ ö ş ü). No other words, letters, numbers or fake UI text anywhere in the image:`,
    ...text.map((t) => `- ${t}`),
    '',
    hasProducts
      ? 'PRODUCT: The attached product photos are the real product. Reproduce it exactly — same shape, proportions, color, material, details and branding on the product. Never invent a different design or variant.'
      : 'PRODUCT: Show the product exactly as described; do not invent extra features.',
    mode === 'product'
      ? `LOGO: Do not add a separate logo, badge or brand mark anywhere. The brand appears only on the product itself, exactly as in the product photos.`
      : mode === 'overlay'
      ? `LOGO: Do NOT draw any logo, brand mark or brand name. Keep the ${pos} area (about ${Math.round((brand.logo?.scale || 0.2) * 100) + 6}% of the width) clean and calm, because the real logo file is placed there afterwards.`
      : mode === 'ai'
        ? `LOGO: The attached logo image is LOCKED. Reproduce it exactly once, small, in the ${pos} area — same shape, proportions, spacing and spelling "${brand.name}". Never redesign it or add symbols.`
        : `LOGO: Do not draw any logo. If the brand name appears, spell it exactly "${brand.name}".`,
    aspect === '4:5'
      ? 'FRAMING: The image will be cropped to 4:5. Keep all text, the product and any logo zone inside the central 83% of the height; the top and bottom ~8% are only background continuation.'
      : aspect === '9:16'
        ? 'FRAMING: The image will be cropped to 9:16. Keep all text and the product inside the central 84% of the width; keep the top 12% and bottom 18% free of text (story UI safe zones).'
        : 'FRAMING: Square 1:1 feed post with balanced margins.',
    '',
    'TYPE TREATMENT: Text must feel art-directed — either naturally integrated into the scene (printed on paper, a box, a mirror, a screen) or set as clean editorial typography with generous spacing. CTA as a refined text link or minimal button, never a cheap banner or sticker.',
    'QUALITY: Photorealistic, premium, clean, believable lighting and materials, correct perspective. No AI artifacts, no warped hands or objects, no gibberish or misspelled text, no watermarks, no borders, no stock-photo clichés.',
    fixHint ? `\nPREVIOUS ATTEMPT WAS REJECTED BY QA. Fix these issues: ${fixHint}` : '',
  ];
  return lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
}

async function toAspect(buf, aspect) {
  const [tw, th] = TARGET[aspect] || TARGET['4:5'];
  const img = sharp(buf);
  const { width, height } = await img.metadata();
  const want = tw / th;
  const have = width / height;
  let pipeline = sharp(buf);
  if (Math.abs(want - have) > 0.01) {
    if (have < want) {
      const h = Math.round(width / want);
      pipeline = pipeline.extract({ left: 0, top: Math.round((height - h) / 2), width, height: h });
    } else {
      const w = Math.round(height * want);
      pipeline = pipeline.extract({ left: Math.round((width - w) / 2), top: 0, width: w, height });
    }
  }
  return pipeline.resize(tw, th, { fit: 'cover' }).png().toBuffer();
}

async function overlayLogo(buf, brand) {
  const logos = [brand.assets?.logo, brand.assets?.logoAlt].filter(Boolean).map(readAsset);
  if (!logos.length) return buf;
  const { width: W, height: H } = await sharp(buf).metadata();
  const scale = Math.min(0.5, Math.max(0.06, brand.logo?.scale || 0.2));
  const lw = Math.round(W * scale);
  const margin = Math.round(W * 0.055);
  const prepared = await Promise.all(logos.map(async (l) => {
    const b = await sharp(l.buffer).resize({ width: lw }).png().toBuffer();
    const m = await sharp(b).metadata();
    const s = await sharp(b).stats();
    // luminance of visible pixels
    const lum = 0.2126 * s.channels[0].mean + 0.7152 * s.channels[1].mean + 0.0722 * s.channels[2].mean;
    return { b, w: m.width, h: m.height, lum };
  }));
  const p = brand.logo?.position || 'top-left';
  const { w, h } = prepared[0];
  const left = p.endsWith('left') ? margin : p.endsWith('right') ? W - w - margin : Math.round((W - w) / 2);
  const top = p.startsWith('top') ? Math.round(H * (H / W > 1.5 ? 0.13 : 0.06)) : H - h - Math.round(H * (H / W > 1.5 ? 0.2 : 0.06));
  // Pick the logo version with the best contrast against the background under it.
  let chosen = prepared[0];
  if (prepared.length > 1) {
    const region = await sharp(buf).extract({ left, top, width: Math.min(w, W - left), height: Math.min(h, H - top) }).stats();
    const bg = 0.2126 * region.channels[0].mean + 0.7152 * region.channels[1].mean + 0.0722 * region.channels[2].mean;
    chosen = prepared.reduce((best, x) => (Math.abs(x.lum - bg) > Math.abs(best.lum - bg) ? x : best));
  }
  return sharp(buf).composite([{ input: chosen.b, left, top }]).png().toBuffer();
}

async function qa(brand, cr, png) {
  const jpeg = await sharp(png).resize({ width: 1024 }).jpeg({ quality: 85 }).toBuffer();
  const c = cr.card;
  const expected = [fill(c.headline, cr.data), fill(c.subline, cr.data), fill(c.cta, cr.data)].filter(Boolean);
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['score', 'sales_power', 'text_exact', 'detected_text', 'strategy_match', 'brand_match', 'product_ok', 'issues', 'fix_hint'],
    properties: {
      score: { type: 'integer', description: '1-10' },
      sales_power: { type: 'integer', description: '1-10' },
      text_exact: { type: 'boolean' },
      detected_text: { type: 'string' },
      strategy_match: { type: 'boolean' },
      brand_match: { type: 'boolean' },
      product_ok: { type: 'boolean' },
      issues: { type: 'array', items: { type: 'string' } },
      fix_hint: { type: 'string' },
    },
  };
  const products = (brand.assets?.products || []).slice(0, 2).map(readAsset);
  const imgs = [`data:image/jpeg;base64,${jpeg.toString('base64')}`, ...products.map((p) => `data:${p.mime};base64,${p.buffer.toString('base64')}`)];
  const { data } = await openai.jsonCompletion({
    name: 'creative_qa',
    schema,
    maxTokens: 6000,
    model: openai.aiSettings().visionModel,
    images: imgs,
    system: `Sen premium bir ajansta kreatif direktör ve performans pazarlamacısın. Sana bir reklam kreatifi (ilk görsel) ve varsa gerçek ürün fotoğrafları (sonraki görseller) verilecek. Kreatifi acımasızca ama adil değerlendir.
Kontrol et:
1) Görseldeki tüm yazıyı oku (detected_text). Beklenen metinlerle karakter karakter aynı mı, Türkçe karakterler doğru mu, fazladan/anlamsız yazı var mı? (text_exact)
2) Görsel, görev kartındaki stratejiyi ve formatı birebir uyguluyor mu? (strategy_match)
3) Marka renkleri, tipografi hissi ve premium görünüm korunmuş mu? AI görünümü, bozuk el/nesne, ucuz görünüm var mı? (brand_match)
4) Ürün, gerçek ürün fotoğraflarıyla aynı mı? Ürün fotoğrafı verilmediyse ürün tutarlı ve gerçekçi mi? (product_ok)
5) Satış gücü: 1 saniyede ne satıldığı anlaşılıyor mu, hook belirgin mi, başlık okunaklı ve hiyerarşi net mi, CTA görünür mü? Feed'de kaydırmayı durdurur mu?
score: 1–10. Yazı hatası varsa en fazla 6. Ürün farklıysa en fazla 5. 9–10 yalnızca gerçek bir ajansın yayına alacağı kalitede.
issues: Türkçe kısa maddeler. fix_hint: görsel modeline verilecek İngilizce, kısa ve uygulanabilir düzeltme talimatı.`,
    user: `Marka: ${brand.name}\nGörev ${c.id} — ${c.formatName}\nStrateji: ${c.strategyVerbatim}\nGörsel kurgu: ${fill(c.visual, cr.data)}\nBeklenen görsel üstü metinler: ${expected.map((t) => `"${t}"`).join(' | ') || '(yok)'}${brand.logo?.mode === 'overlay' && brand.assets?.logo ? '\nNot: Logo, gerçek logo dosyasından sonradan yerleştirildi; logo yazısını beklenen metin dışında say ama hata sayma.' : ''}`,
  });
  data.score = Math.max(1, Math.min(10, Math.round(data.score)));
  return data;
}

// Perceptual hash (dHash 9x8) to catch creatives that look alike (ad blindness).
async function dhash(buf) {
  const px = await sharp(buf).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? '1' : '0';
  return bits;
}
const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
const SIMILAR_AT = 10; // of 64 bits

function nearest(brandId, cid, hash) {
  let best = null;
  for (const c of Creatives.all((x) => x.brandId === brandId && x.id !== cid && x.current >= 0)) {
    const h = c.images[c.current]?.hash;
    if (!h) continue;
    const d = hamming(h, hash);
    if (!best || d < best.d) best = { d, num: c.num };
  }
  return best;
}

// ---------------- queue ----------------
const queue = [];
let running = 0;

export function enqueue(cid, { provider, promptOverride } = {}) {
  const cr = Creatives.get(cid);
  if (!cr) throw Object.assign(new Error('Kreatif bulunamadı'), { status: 404 });
  if (cr.cardStatus !== 'approved') throw Object.assign(new Error(`${cr.num}: Görev kartı onaylanmadan görsel üretilemez.`), { status: 409 });
  const miss = missingData(cr);
  if (miss.length) throw Object.assign(new Error(`${cr.num}: Önce gerçek verileri gir: ${miss.join(', ')}`), { status: 409 });
  if (['queued', 'generating', 'reviewing'].includes(cr.status)) return cr;
  const prov = provider || cr.provider || 'openai';
  if (prov === 'ideogram' && !ideogram.ideogramEnabled()) throw Object.assign(new Error('Ideogram anahtarı tanımlı değil.'), { status: 400 });
  Creatives.update(cid, { status: 'queued', error: null, provider: prov, promptOverride: promptOverride ?? cr.promptOverride ?? null });
  queue.push(cid);
  pump();
  return Creatives.get(cid);
}

function pump() {
  while (running < config.imageConcurrency && queue.length) {
    const cid = queue.shift();
    running++;
    run(cid).catch((e) => {
      Creatives.update(cid, { status: 'failed', error: e.message });
    }).finally(() => { running--; pump(); });
  }
}

async function run(cid) {
  let cr = Creatives.get(cid);
  const brand = Brands.get(cr.brandId);
  const s = openai.aiSettings();
  const user = currentUser();
  let fixHint = '';
  const attempts = 1 + Math.max(0, s.qaAutoRetry || 0);
  let best = null;

  for (let a = 0; a < attempts; a++) {
    Creatives.update(cid, { status: 'generating', attempt: a + 1 });
    cr = Creatives.get(cid);
    const prompt = cr.promptOverride && a === 0 ? cr.promptOverride : buildPrompt(brand, cr, fixHint);
    const aspect = cr.card.format || '4:5';
    let raw;
    if (cr.provider === 'ideogram') {
      raw = await ideogram.generateImage({
        prompt,
        aspect,
        negative: 'gibberish text, misspelled words, extra text, watermark, distorted logo, deformed hands, low quality, cluttered layout',
        styleRefs: (brand.assets?.products || []).slice(0, 3).map(readAsset),
      });
    } else {
      const refs = [...(brand.assets?.products || []).slice(0, 6)];
      if (brand.logo?.mode === 'ai' && brand.assets?.logo) refs.push(brand.assets.logo);
      raw = await openai.generateImage({ prompt, aspect, references: refs.map(readAsset) });
    }
    let png = await toAspect(raw, aspect);
    if (brand.logo?.mode !== 'ai' && brand.logo?.mode !== 'none') png = await overlayLogo(png, brand);
    charge(user, 'image', { brandId: brand.id, creative: cr.num, provider: cr.provider });

    const file = `${cid}_${Date.now()}.png`;
    fs.writeFileSync(path.join(CREATIVE_DIR, file), png);

    Creatives.update(cid, { status: 'reviewing' });
    let review = null;
    try { review = await qa(brand, Creatives.get(cid), png); } catch (e) { review = { score: null, issues: [`Kalite kontrol yapılamadı: ${e.message}`], fix_hint: '' }; }
    const hash = await dhash(png);
    const near = nearest(brand.id, cid, hash);
    if (near && near.d <= SIMILAR_AT) {
      review.similarTo = near.num;
      review.issues = [...(review.issues || []), `Kreatif ${near.num} ile görsel olarak çok benzer (reklam körlüğü riski).`];
      review.fix_hint = `${review.fix_hint || ''} Make the composition, camera angle, background tone and text position clearly different from a typical centered product shot.`.trim();
      if (review.score !== null) review.score = Math.min(review.score, 7);
    }

    const entry = { file, prompt, provider: cr.provider, aspect, qa: review, hash, createdAt: now() };
    const updated = Creatives.update(cid, (c) => ({ ...c, images: [...c.images, entry] }));
    const idx = updated.images.length - 1;
    if (!best || (review.score ?? 0) > (best.score ?? 0)) best = { idx, score: review.score };
    Creatives.update(cid, { current: best.idx });

    if (review.score === null || review.score >= s.qaMinScore || !s.qaMinScore) break;
    fixHint = [review.fix_hint, ...(review.text_exact === false ? [`Text must read exactly: ${[cr.card.headline, cr.card.subline, cr.card.cta].filter(Boolean).map((t) => `"${fill(t, cr.data)}"`).join(', ')}`] : [])].filter(Boolean).join(' ');
  }
  Creatives.update(cid, { status: 'done', promptOverride: null });
}

export const queueState = () => ({ running, waiting: queue.length });
