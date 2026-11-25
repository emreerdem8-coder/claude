import { config, ROOT } from './env.js';
if (process.env.MOCK_AI === '1') await import('./mock.js');
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import multer from 'multer';
import { Brands, Creatives, Settings, UPLOAD_DIR, CREATIVE_DIR, id } from './store.js';
import { BRIEF_FIELDS, BATCH_LETTERS, loadSkeleton } from './framework.js';
import { emptyBrand, checkBrief, draftIdentity } from './services/brand.js';
import * as strategy from './services/strategy.js';
import * as cards from './services/cards.js';
import * as render from './services/render.js';
import { currentUser, assertCredits, charge, summary } from './services/credits.js';
import { aiSettings, ping } from './ai/openai.js';
import { ideogramEnabled } from './ai/ideogram.js';

loadSkeleton(); // fail fast if prompts/strateji.txt is malformed

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => { req.body ??= {}; req.user = currentUser(req); next(); });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${id('f')}${path.extname(file.originalname).toLowerCase() || '.png'}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype)),
});

const h = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); } catch (e) {
    console.error('[hata]', e.message);
    res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message });
  }
};
const brandOr404 = (req) => {
  const b = Brands.get(req.params.id);
  if (!b || b.userId !== req.user.id) throw Object.assign(new Error('Marka bulunamadı'), { status: 404 });
  return b;
};
const withCost = async (req, action, meta, fn) => {
  assertCredits(req.user, action);
  const out = await fn();
  charge(req.user, action, meta);
  return out;
};

// ---------- meta ----------
app.get('/api/meta', h((req) => ({
  briefFields: BRIEF_FIELDS,
  letters: BATCH_LETTERS,
  skeleton: loadSkeleton().groups,
  openai: !!config.openaiKey,
  ideogram: ideogramEnabled(),
  settings: aiSettings(),
  credits: summary(req.user),
  queue: render.queueState(),
})));

app.put('/api/settings', h((req) => {
  const allowed = ['textModel', 'visionModel', 'imageModel', 'reasoningEffort', 'inputFidelity', 'imageQuality', 'qaMinScore', 'qaAutoRetry', 'defaultProvider'];
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  for (const k of ['qaMinScore', 'qaAutoRetry']) if (k in patch) patch[k] = Number(patch[k]) || 0;
  return Settings.set(patch);
}));

app.post('/api/test-openai', h(async () => {
  const models = await ping();
  const s = aiSettings();
  return { ok: true, has: { text: models.includes(s.textModel), vision: models.includes(s.visionModel), image: models.includes(s.imageModel) }, count: models.length };
}));

// ---------- brands ----------
const brandView = (b) => {
  const st = strategy.getStrategy(b.id);
  const crs = Creatives.all((c) => c.brandId === b.id);
  return {
    ...b,
    progress: {
      strategyStatus: st.status,
      approvedGroups: st.groups.filter((g) => g.approved).length,
      creativesDone: crs.filter((c) => c.images.length).length,
    },
  };
};

app.get('/api/brands', h((req) => Brands.all((b) => b.userId === req.user.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(brandView)));

app.post('/api/brands', h((req) => {
  const b = { ...emptyBrand(), ...pickBrand(req.body), id: id('brd'), userId: req.user.id, provider: aiSettings().defaultProvider };
  if (!b.name?.trim()) throw Object.assign(new Error('Marka adı gerekli'), { status: 400 });
  return brandView(Brands.insert(b));
}));

function pickBrand(body) {
  const out = {};
  for (const k of ['name', 'freeText', 'provider']) if (typeof body[k] === 'string') out[k] = body[k];
  if (body.brief) out.brief = body.brief;
  if (body.identity) out.identity = body.identity;
  if (body.logo) out.logo = body.logo;
  return out;
}

app.get('/api/brands/:id', h((req) => brandView(brandOr404(req))));
app.put('/api/brands/:id', h((req) => {
  const b = brandOr404(req);
  const patch = pickBrand(req.body);
  if (patch.brief) patch.brief = { ...b.brief, ...patch.brief };
  if (patch.identity) patch.identity = { ...b.identity, ...patch.identity };
  if (patch.logo) patch.logo = { ...b.logo, ...patch.logo };
  return brandView(Brands.update(b.id, patch));
}));
app.delete('/api/brands/:id', h((req) => { const b = brandOr404(req); Brands.remove(b.id); return { ok: true }; }));

app.post('/api/brands/:id/assets/:kind', upload.array('files', 10), h((req) => {
  const b = brandOr404(req);
  const kind = req.params.kind;
  const refs = (req.files || []).map((f) => ({ file: f.filename, name: f.originalname, mime: f.mimetype }));
  if (!refs.length) throw Object.assign(new Error('PNG, JPG veya WEBP yükle.'), { status: 400 });
  const assets = { ...b.assets };
  if (kind === 'logo' || kind === 'logoAlt') assets[kind] = refs[0];
  else if (kind === 'products') assets.products = [...(assets.products || []), ...refs].slice(0, 8);
  else if (kind === 'references') assets.references = [...(assets.references || []), ...refs].slice(0, 8);
  else throw Object.assign(new Error('Geçersiz tür'), { status: 400 });
  return brandView(Brands.update(b.id, { assets }));
}));
app.delete('/api/brands/:id/assets/:kind/:file', h((req) => {
  const b = brandOr404(req);
  const assets = { ...b.assets };
  const { kind, file } = req.params;
  if (kind === 'products' || kind === 'references') assets[kind] = (assets[kind] || []).filter((p) => p.file !== file);
  else if (assets[kind]?.file === file) assets[kind] = null;
  return brandView(Brands.update(b.id, { assets }));
}));

app.post('/api/brands/:id/brief-check', h((req) => {
  const b = brandOr404(req);
  return withCost(req, 'brief_check', { brandId: b.id }, () => checkBrief(b));
}));
app.post('/api/brands/:id/identity-draft', h((req) => {
  const b = brandOr404(req);
  return withCost(req, 'identity_draft', { brandId: b.id }, () => draftIdentity(b));
}));

// ---------- strategy ----------
const strategyView = (st) => ({ ...st, check: strategy.validate(st) });

app.get('/api/brands/:id/strategy', h((req) => strategyView(strategy.getStrategy(brandOr404(req).id))));
app.post('/api/brands/:id/strategy/generate', h((req) => {
  const b = brandOr404(req);
  return withCost(req, 'strategy', { brandId: b.id }, async () => strategyView(await strategy.generateAll(b)));
}));
app.post('/api/brands/:id/strategy/regenerate', h((req) => {
  const b = brandOr404(req);
  const { ids = [], letter, note } = req.body;
  const st = strategy.getStrategy(b.id);
  const targets = letter ? strategy.groupItems(st, letter).map((i) => i.id) : ids;
  if (!targets.length) throw Object.assign(new Error('Yeniden yazılacak satır yok'), { status: 400 });
  return withCost(req, letter ? 'strategy_group' : 'strategy_line', { brandId: b.id, targets }, async () => strategyView(await strategy.regenerate(b, targets, note)));
}));
app.put('/api/brands/:id/strategy/items/:item', h((req) => strategyView(strategy.editItem(brandOr404(req).id, req.params.item, req.body))));
app.post('/api/brands/:id/strategy/groups/:letter/approve', h((req) => {
  const b = brandOr404(req);
  const st = strategy.getStrategy(b.id);
  const empty = strategy.groupItems(st, req.params.letter).filter((i) => !i.idea);
  if (req.body.approved !== false && empty.length) throw Object.assign(new Error('Boş satır varken grup onaylanamaz.'), { status: 409 });
  return strategyView(strategy.setGroupApproval(b.id, req.params.letter, req.body.approved !== false));
}));

// ---------- batches / cards ----------
const batchView = (brandId, letter) => ({
  batch: cards.getBatch(brandId, letter) || null,
  creatives: Creatives.all((c) => c.brandId === brandId && c.letter === letter)
    .sort((a, b) => a.num.localeCompare(b.num))
    .map((c) => ({ ...c, missing: cards.missingData(c) })),
});

app.get('/api/brands/:id/batches', h((req) => {
  const b = brandOr404(req);
  const st = strategy.getStrategy(b.id);
  return st.groups.map((g) => {
    const crs = Creatives.all((c) => c.brandId === b.id && c.letter === g.letter);
    return {
      letter: g.letter, name: g.name, goal: g.goal, approved: g.approved,
      cards: crs.length,
      cardsApproved: crs.filter((c) => c.cardStatus === 'approved').length,
      done: crs.filter((c) => c.images.length).length,
      busy: crs.filter((c) => ['queued', 'generating', 'reviewing'].includes(c.status)).length,
      avgScore: avg(crs.map((c) => c.images[c.current]?.qa?.score).filter((x) => typeof x === 'number')),
    };
  });
}));
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

app.get('/api/brands/:id/batches/:letter', h((req) => batchView(brandOr404(req).id, req.params.letter)));
app.post('/api/brands/:id/batches/:letter/cards', h((req) => {
  const b = brandOr404(req);
  return withCost(req, 'cards', { brandId: b.id, letter: req.params.letter }, async () => {
    await cards.generateCards(b, req.params.letter, req.body.note);
    return batchView(b.id, req.params.letter);
  });
}));
app.post('/api/brands/:id/batches/:letter/approve-all', h((req) => {
  const b = brandOr404(req);
  for (const c of Creatives.all((c) => c.brandId === b.id && c.letter === req.params.letter)) Creatives.update(c.id, { cardStatus: 'approved' });
  return batchView(b.id, req.params.letter);
}));
app.post('/api/brands/:id/batches/:letter/generate', h((req) => {
  const b = brandOr404(req);
  const list = Creatives.all((c) => c.brandId === b.id && c.letter === req.params.letter && c.cardStatus === 'approved' && !c.images.length);
  const skipped = [];
  for (const c of list) {
    try { assertCredits(req.user, 'image'); render.enqueue(c.id, { provider: req.body.provider }); } catch (e) { skipped.push(e.message); }
  }
  return { ...batchView(b.id, req.params.letter), skipped };
}));

const creativeOr404 = (req) => {
  const b = brandOr404(req);
  const c = Creatives.get(cards.creativeId(b.id, req.params.num));
  if (!c) throw Object.assign(new Error('Kart bulunamadı'), { status: 404 });
  return { b, c };
};

app.put('/api/brands/:id/creatives/:num', h((req) => {
  const { c } = creativeOr404(req);
  if (req.body.data) cards.setCardData(c.id, req.body.data);
  if (req.body.card) cards.editCard(c.id, req.body.card);
  if (typeof req.body.provider === 'string') Creatives.update(c.id, { provider: req.body.provider });
  if (typeof req.body.current === 'number') Creatives.update(c.id, { current: req.body.current });
  return Creatives.get(c.id);
}));
app.post('/api/brands/:id/creatives/:num/approve', h((req) => {
  const { c } = creativeOr404(req);
  return Creatives.update(c.id, { cardStatus: req.body.approved === false ? 'draft' : 'approved' });
}));
app.post('/api/brands/:id/creatives/:num/revise', h((req) => {
  const { b, c } = creativeOr404(req);
  if (!req.body.note?.trim()) throw Object.assign(new Error('Revize notu yaz.'), { status: 400 });
  return withCost(req, 'card_revise', { brandId: b.id, creative: c.num }, () => cards.reviseCard(b, c.id, req.body.note));
}));
app.post('/api/brands/:id/creatives/:num/generate', h((req) => {
  const { c } = creativeOr404(req);
  assertCredits(req.user, 'image');
  return render.enqueue(c.id, { provider: req.body.provider, promptOverride: req.body.prompt || null });
}));
app.get('/api/brands/:id/creatives/:num/prompt', h((req) => {
  const { b, c } = creativeOr404(req);
  return { prompt: render.buildPrompt(b, c) };
}));

app.get('/api/credits', h((req) => summary(req.user)));

// ---------- files ----------
app.use('/files/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));
app.use('/files/creatives', express.static(CREATIVE_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(ROOT, 'public')));
app.get(/^\/(?!api|files).*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  Kreatif Stüdyo hazır →  http://localhost:${config.port}\n`);
  if (!config.openaiKey) console.log('  ! OPENAI_API_KEY yok. .env.example dosyasını .env olarak kopyalayıp anahtarı ekle.\n');
});

export { fs };
