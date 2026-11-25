import { BRIEF_FIELDS, loadPrompts } from '../framework.js';
import { jsonCompletion } from '../ai/openai.js';

export function emptyBrand() {
  return {
    name: '',
    brief: Object.fromEntries(BRIEF_FIELDS.map(([k]) => [k, ''])),
    freeText: '',
    identity: {
      tagline: '', story: '', tone: '', palette: [], headlineFont: '', bodyFont: '',
      photography: '', designRules: '', logoDescription: '', ctaPreference: '',
    },
    assets: { logo: null, logoAlt: null, products: [], references: [] },
    // product = marka yalnızca ürünün üzerinde; overlay = gerçek logo dosyası sonradan bindirilir; ai = model çizer
    logo: { mode: 'product', position: 'top-left', scale: 0.2 },
    provider: 'openai',
  };
}

export function briefText(brand) {
  const lines = BRIEF_FIELDS.map(([k, label], i) => `${i + 1}. ${label}: ${brand.brief?.[k]?.trim() || 'belirsiz'}`);
  if (brand.freeText?.trim()) lines.push('', 'Serbest anlatım:', brand.freeText.trim());
  return lines.join('\n');
}

export function identityText(brand) {
  const id = brand.identity || {};
  const palette = (id.palette || []).filter((p) => p.hex).map((p) => `${p.name || 'Renk'} ${p.hex}${p.usage ? ` (${p.usage})` : ''}`).join(', ');
  const rows = [
    ['Marka adı (birebir yazım)', brand.name],
    ['Slogan', id.tagline],
    ['Marka hikâyesi', id.story],
    ['Ses tonu', id.tone],
    ['Renk paleti (HEX)', palette],
    ['Başlık yazı tipi', id.headlineFont],
    ['Gövde yazı tipi', id.bodyFont],
    ['Fotoğraf stili', id.photography],
    ['Tasarım kuralları', id.designRules],
    ['Logo tanımı', id.logoDescription],
    ['CTA tercihi', id.ctaPreference],
  ];
  return rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- (Kimlik bilgisi girilmedi)';
}

// "Eksikleri tek kısa mesajda sor" — the brief-check step from the strategy prompt.
export async function checkBrief(brand) {
  const { strategy } = loadPrompts();
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['ready', 'message', 'questions'],
    properties: {
      ready: { type: 'boolean' },
      message: { type: 'string' },
      questions: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['field', 'question', 'impact'],
          properties: {
            field: { type: 'string', enum: BRIEF_FIELDS.map(([k]) => k) },
            question: { type: 'string' },
            impact: { type: 'string' },
          },
        },
      },
    },
  };
  const { data } = await jsonCompletion({
    name: 'brief_check',
    schema,
    maxTokens: 8000,
    system: `${strategy}\n\n---\nŞU AN SADECE BRİF KONTROLÜ YAPIYORSUN. 100 fikir üretme.\nKullanıcının verdiği bilgileri tekrar sorma. 100 stratejinin kaliteli uyarlanması için kritik olan eksikleri belirle (özellikle teklif, fiyat, kanıt, aciliyet ve tereddüt alanları). Eksikleri tek kısa mesajda sor. Her soru kısa, net ve Türkçe olsun. "impact" alanında bu bilginin hangi strateji grubunu (A–J) etkilediğini tek kısa cümleyle yaz. En fazla 8 soru sor. Bilgi yeterliyse ready=true ve questions boş olsun.`,
    user: `MARKA BRİFİ\n${briefText(brand)}`,
  });
  return data;
}

// Optional: draft a written identity from the brief using the branding prompt's standards.
export async function draftIdentity(brand) {
  const { branding } = loadPrompts();
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['tagline', 'story', 'tone', 'palette', 'headlineFont', 'bodyFont', 'photography', 'designRules', 'ctaPreference', 'rationale'],
    properties: {
      tagline: { type: 'string' },
      story: { type: 'string' },
      tone: { type: 'string' },
      palette: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'hex', 'usage'],
          properties: { name: { type: 'string' }, hex: { type: 'string' }, usage: { type: 'string' } },
        },
      },
      headlineFont: { type: 'string' },
      bodyFont: { type: 'string' },
      photography: { type: 'string' },
      designRules: { type: 'string' },
      ctaPreference: { type: 'string' },
      rationale: { type: 'string' },
    },
  };
  const { data } = await jsonCompletion({
    name: 'identity',
    schema,
    maxTokens: 12000,
    system: `${branding}\n\n---\nBu çağrıda adım adım ilerleme ve görsel üretme. Brife dayanarak reklam kreatiflerinde kullanılacak YAZILI kimlik özetini tek seferde çıkar (Adım 1, 5, 6 ve 7'nin özü). Tüm metinler Türkçe olsun. Palet: 1–2 ana, 2–3 ikincil, 1 vurgu, 2–3 nötr; HEX kodları #RRGGBB biçiminde; "usage" alanında kullanım oranı ve yeri. Yazı tipleri Google Fonts'ta bulunan, Türkçe karakter destekli seçenekler olsun. "tone" alanında 4 "Biz ... / Biz ... değiliz" çifti olsun. "designRules" alanında kreatiflerde uyulacak somut düzen kuralları (grid, boşluk, logo yerleşimi, yapılmayacaklar) olsun. "rationale" alanında kararların gerekçesini 3–4 cümleyle yaz. Kullanıcının verdiği renk/tarz tercihlerine uy.`,
    user: `Marka adı: ${brand.name}\n\nMARKA BRİFİ\n${briefText(brand)}\n\nMevcut kimlik notları:\n${identityText(brand)}`,
  });
  return data;
}
