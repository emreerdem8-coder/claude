// End-to-end self test with a mocked OpenAI (no key, no cost): `npm run check`
// Runs the full flow: brand → brief check → identity → strategy → approve → cards (critic gate) → images → QA.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

process.env.PORT = '4799';
process.env.OPENAI_API_KEY = 'sk-test';
process.env.MOCK_AI = '1';
process.env.IMAGE_CONCURRENCY = '3';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ks-'));

import { realFetch } from './mock.js';

// isolate data dir
const env = await import('./env.js');
env.config.dataDir = tmp;
await import('./index.js');
const B = 'http://127.0.0.1:4799/api';
const call = async (p, method = 'GET', body) => {
  const r = await realFetch(B + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${j.error}`);
  return j;
};
const ok = (cond, msg) => { if (!cond) { console.error('✗', msg); process.exit(1); } console.log('✓', msg); };
await new Promise((r) => setTimeout(r, 300));

const meta = await call('/meta');
ok(meta.skeleton.length === 10 && meta.skeleton.every((g) => g.items.length === 10), 'strateji iskeleti 10×10 okundu');
const brand = await call('/brands', 'POST', { name: 'Test', freeText: 'serum' });
const bc = await call(`/brands/${brand.id}/brief-check`, 'POST');
ok(bc.questions.length === 1, 'brif kontrolü eksik soruyu döndü');
const idt = await call(`/brands/${brand.id}/identity-draft`, 'POST');
await call(`/brands/${brand.id}`, 'PUT', { identity: idt });
const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 200, g: 180, b: 150, alpha: 1 } } }).png().toBuffer();
const fd = new FormData(); fd.append('files', new Blob([png], { type: 'image/png' }), 'p.png');
await realFetch(`${B}/brands/${brand.id}/assets/products`, { method: 'POST', body: fd });
let st = await call(`/brands/${brand.id}/strategy/generate`, 'POST');
ok(Object.keys(st.items).length === 100 && st.items['100'].idea.startsWith('Yeniden'), 'eksik 100. satır onarım çağrısıyla tamamlandı');
ok(st.items['001'].star && !st.items['004'].star, '★ işaretleri iskeletten korundu');
ok(st.check.flagged.includes('100'), '[... gerekli] satırları işaretlendi');
await call(`/brands/${brand.id}/batches/A/cards`, 'POST').then(() => ok(false, 'onaysız grup engellenmeli')).catch(() => ok(true, 'onaysız grupta kart üretimi engellendi'));
st = await call(`/brands/${brand.id}/strategy/groups/A/approve`, 'POST', { approved: true });
ok(st.groups[0].approved, 'A grubu onaylandı');
let b = await call(`/brands/${brand.id}/batches/A/cards`, 'POST');
ok(b.creatives.length === 10, '10 görev kartı oluştu');
ok(b.creatives[1].card.headline === 'Düzeltilmiş 002' && b.creatives[1].card.critic.score === 9, '9 altı kart otomatik yeniden yazıldı ve 9 aldı');
ok(new Set(b.creatives.map((c) => c.card.layout)).size === 10, 'aynı layout çakışması düzeltildi (10 farklı kurgu)');
ok(b.creatives[0].card.strategyVerbatim.startsWith('001 ★'), 'strateji satırı kartta birebir');
ok(b.creatives[0].missing.includes('[GERÇEK FİYAT]'), 'gerçek veri gerektiren kart işaretlendi');
await call(`/brands/${brand.id}/batches/A/approve-all`, 'POST');
const g = await call(`/brands/${brand.id}/batches/A/generate`, 'POST', {});
ok(g.skipped.length === 1, 'gerçek verisi eksik kart üretime alınmadı');
await call(`/brands/${brand.id}/creatives/001`, 'PUT', { data: { '[GERÇEK FİYAT]': '899 TL' } });
const prompt = await call(`/brands/${brand.id}/creatives/001/prompt`);
ok(prompt.prompt.includes('899 TL') || !prompt.prompt.includes('[GERÇEK FİYAT]'), 'yer tutucu gerçek veriyle değişti');
await call(`/brands/${brand.id}/creatives/001/generate`, 'POST', {});
for (let i = 0; i < 80; i++) {
  b = await call(`/brands/${brand.id}/batches/A`);
  if (b.creatives.every((c) => c.status === 'done' || c.status === 'failed')) break;
  await new Promise((r) => setTimeout(r, 250));
}
const failed = b.creatives.filter((c) => c.status === 'failed');
ok(!failed.length, `10 görsel üretildi${failed.length ? ': ' + failed.map((f) => f.error).join(' | ') : ''}`);
const dims = await Promise.all(b.creatives.map(async (c) => { const m = await sharp(path.join(tmp, 'creatives', c.images[c.current].file)).metadata(); return `${c.card.format}=${m.width}x${m.height}`; }));
ok(dims.includes('4:5=1024x1280') && dims.includes('1:1=1024x1024') && dims.includes('9:16=864x1536'), 'formatlar doğru kırpıldı: ' + [...new Set(dims)].join(', '));
ok(b.creatives.some((c) => c.images.length > 1), '9 altı görseller otomatik yeniden üretildi');
ok(b.creatives.every((c) => c.images[c.current].qa.score !== undefined), 'her görsel puanlandı');
const rev = await call(`/brands/${brand.id}/creatives/001/revise`, 'POST', { note: 'daha merak uyandırıcı' });
ok(rev.card.headline === 'Revize başlık' && rev.cardStatus === 'draft', 'kart revizesi çalıştı, onay sıfırlandı');
const cr = await call('/credits');
ok(cr.spent > 0, `kredi defteri işlendi (${cr.spent})`);
console.log('\nTüm kontroller geçti.');
process.exit(0);
