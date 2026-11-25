// Mocked OpenAI for `npm run check` and `npm run demo` (MOCK_AI=1). No network, no cost.
import sharp from 'sharp';

if (process.env.MOCK_AI === '1') process.env.OPENAI_API_KEY ||= 'sk-mock';

export const realFetch = globalThis.fetch;
const LAYOUTS = ['studio-hero', 'in-hand-lifestyle', 'text-on-object', 'typographic-poster', 'screen-mockup', 'split-comparison', 'collage-grid', 'macro-detail', 'diagram-annotated', 'handwritten-note'];
const BGS = ['light-neutral', 'dark', 'brand-color', 'photo-scene', 'bold-contrast'];
const PL = ['top', 'bottom', 'left-column', 'right-column', 'integrated-in-scene', 'center-overlay', 'annotation-callouts'];
let criticCalls = 0; // first critic round gives card 2 a 7 to exercise the rewrite loop
let imgN = 0;

const card = (id, i) => ({
  id, funnel: 'cold', hook: `Hook ${id}`, sales_angle: `Açı ${id}`, sales_logic: 'Mantık', layout: LAYOUTS[i % 10], background: BGS[i % 5], text_placement: PL[i % 7],
  format: i === 3 ? '1:1' : i === 5 ? '9:16' : '4:5', format_reason: 'Feed', headline: `Başlık ${id}`, subline: 'Alt metin', cta: `CTA ${i}`, visual: 'Sahne', brand_application: 'Renkler',
  primary_text: 'Metin\nCTA', required_data: i === 0 ? [{ token: '[GERÇEK FİYAT]', label: 'Fiyat' }] : [], improvement: '',
});

function mockJson(name, body) {
  const user = typeof body.messages[1].content === 'string' ? body.messages[1].content : body.messages[1].content[0].text;
  const ids = (re) => [...user.matchAll(re)].map((m) => m[1]);
  switch (name) {
    case 'brief_check': return { ready: false, message: 'Fiyat eksik.', questions: [{ field: 'price', question: 'Fiyat nedir?', impact: 'I grubu' }] };
    case 'identity': return { tagline: 'T', story: 'S', tone: 'Biz sakiniz / Biz bağırmayız', palette: [{ name: 'Orman', hex: '#1F3D2B', usage: '%30' }, { name: 'Krem', hex: '#F2ECE0', usage: '%60' }], headlineFont: 'Cormorant', bodyFont: 'Inter', photography: 'Doğal ışık', designRules: 'Bol boşluk', ctaPreference: 'İncele', rationale: 'R' };
    case 'strategy_100': {
      const first = user.includes('yalnızca A, B');
      const off = first ? 0 : 50;
      return {
        groups: (first ? 'ABCDE' : 'FGHIJ').split('').map((l) => ({ letter: l, goal: `Uyarlanmış amaç ${l}` })),
        items: Array.from({ length: first ? 50 : 49 }, (_, i) => ({ id: String(off + i + 1).padStart(3, '0'), strategy: `S${off + i + 1}`, idea: `Fikir numara ${off + i + 1} özgün` })), // 100 missing on purpose → repair pass
        missing_info: ['Stok bilgisi'],
      };
    }
    case 'strategy_items': {
      const part = user.split('YENİDEN YAZILACAK SATIRLAR')[1];
      return { items: [...part.matchAll(/^(\d{3})/gm)].map((m) => ({ id: m[1], strategy: `R${m[1]}`, idea: `Yeniden yazılmış ${m[1]} [Paket bilgisi gerekli]` })) };
    }
    case 'task_cards': {
      const list = user.match(/\(id: ([\d, ]+)\)/)[1].split(', ');
      const cards = list.map((id, i) => card(id, i));
      cards[9].layout = cards[0].layout; // diversity collision on purpose
      return { psychology: 'Psikoloji', cards };
    }
    case 'card_critic': {
      criticCalls++;
      const list = ids(/"id": "(\d{3})"/g);
      return { reviews: list.map((id, i) => ({ id, score: criticCalls === 1 && i === 1 ? 7 : 9, strengths: 'iyi', must_fix: criticCalls === 1 && i === 1 ? ['Başlık zayıf'] : [] })) };
    }
    case 'task_cards_fix': {
      const part = user.split('DÜZELTİLECEK KARTLAR')[1];
      const list = [...new Set(ids.call(null, /"id":"(\d{3})"/g).filter((x) => part.includes(`"id":"${x}"`)))];
      const taken = new Set(ids(/layout=([\w-]+)/g));
      const free = [...LAYOUTS, 'offer-card', 'model-portrait', 'environment-wide', 'packaging-unboxing'].filter((l) => !taken.has(l));
      return { cards: list.map((id, i) => ({ ...card(id, (Number(id) - 1) % 10), layout: free[i], headline: `Düzeltilmiş ${id}` })) };
    }
    case 'task_card_revise': return { card: { ...card('001', 0), headline: 'Revize başlık', layout: 'model-portrait' } };
    case 'creative_qa': return { score: imgN % 2 ? 9 : 8, sales_power: 9, text_exact: true, detected_text: 'x', strategy_match: true, brand_match: true, product_ok: true, issues: [], fix_hint: 'tighter type' };
    default: throw new Error('unmocked ' + name);
  }
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.openai.com')) return realFetch(url, init);
  if (u.endsWith('/chat/completions')) {
    const body = JSON.parse(init.body);
    const data = mockJson(body.response_format.json_schema.name, body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }] }), { status: 200 });
  }
  if (u.includes('/images/')) {
    imgN++;
    const png = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: { r: (imgN * 47) % 255, g: (imgN * 91) % 255, b: (imgN * 13) % 255 } } })
      .composite([{ input: Buffer.from(`<svg width="1024" height="1536"><rect x="${(imgN * 97) % 700}" y="${(imgN * 211) % 1100}" width="300" height="400" fill="white"/></svg>`) }]).png().toBuffer();
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 });
  }
  if (u.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-5.1' }, { id: 'gpt-image-1' }] }), { status: 200 });
  throw new Error('unmocked ' + u);
};

export {};
