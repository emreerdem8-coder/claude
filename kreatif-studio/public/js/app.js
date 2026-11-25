// Kreatif Stüdyo — vanilla JS SPA (no build step).
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $foot = document.getElementById('sideFoot');

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const markFlags = (s) => esc(s).replace(/\[([^\]]+)\]/g, '<mark>[$1]</mark>');

// ---------- api ----------
async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: form ? undefined : body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Hata ${res.status}`);
  return data;
}

// ---------- feedback ----------
function toast(msg, kind = '') {
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 4000);
}
async function busy(btn, fn, label) {
  const old = [...btn.childNodes];
  btn.disabled = true;
  btn.replaceChildren(h('span', { class: 'spin' }), label || btn.textContent);
  try { return await fn(); } catch (e) { toast(e.message, 'bad'); throw e; } finally { btn.disabled = false; btn.replaceChildren(...old); }
}
function modal(content, { wide = false } = {}) {
  const root = document.getElementById('modal-root');
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => e.key === 'Escape' && close();
  const bg = h('div', { class: 'modal-bg', onclick: (e) => e.target === bg && close() }, h('div', { class: `modal panel ${wide ? 'wide' : ''}` }, content(close)));
  document.addEventListener('keydown', onKey);
  root.append(bg);
  bg.querySelector('textarea, input')?.focus();
  return close;
}
function ask({ title, text, placeholder = '', ok = 'Gönder', required = true, value = '' }) {
  return new Promise((resolve) => {
    modal((close) => {
      const ta = h('textarea', { class: 'textarea', rows: 4, placeholder }, value);
      const done = (v) => { close(); resolve(v); };
      return h('div', { class: 'panel-pad' },
        h('div', {}, h('h3', { class: 'h2' }, title), text && h('p', { class: 'sub' }, text)),
        ta,
        h('div', { class: 'btns', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Vazgeç'),
          h('button', { class: 'btn primary', onclick: () => { if (required && !ta.value.trim()) return ta.focus(); done(ta.value.trim()); } }, ok)));
    });
  });
}
function confirmBox(title, text, ok = 'Devam et') {
  return new Promise((resolve) => {
    modal((close) => h('div', { class: 'panel-pad' },
      h('h3', { class: 'h2' }, title), h('p', { class: 'sub' }, text),
      h('div', { class: 'btns', style: { justifyContent: 'flex-end' } },
        h('button', { class: 'btn ghost', onclick: () => { close(); resolve(false); } }, 'Vazgeç'),
        h('button', { class: 'btn primary', onclick: () => { close(); resolve(true); } }, ok))));
  });
}
function lightbox(src) {
  modal(() => h('div', { class: 'lightbox' }, h('img', { src })), { wide: true });
}

// ---------- state ----------
const S = { meta: null, brands: [], poll: null };

async function loadMeta() {
  S.meta = await api('/meta');
  S.brands = await api('/brands');
  renderSide();
}

function renderSide() {
  const r = location.hash;
  $nav.replaceChildren(
    h('a', { href: '#/', class: r === '#/' || r === '' ? 'on' : '' }, 'Markalar'),
    h('a', { href: '#/new', class: r === '#/new' ? 'on' : '' }, '+ Yeni marka'),
    S.brands.length ? h('div', { class: 'nav-label' }, 'Markalarım') : null,
    ...S.brands.map((b) => h('a', { href: `#/brand/${b.id}`, class: r.startsWith(`#/brand/${b.id}`) ? 'on' : '' },
      h('i', { class: `dot ${b.progress.approvedGroups === 10 ? 'ok' : b.progress.strategyStatus !== 'empty' ? 'warn' : ''}` }), b.name)),
    h('div', { class: 'nav-label' }, 'Hesap'),
    h('a', { href: '#/usage', class: r === '#/usage' ? 'on' : '' }, 'Kullanım ve kredi'),
    h('a', { href: '#/settings', class: r === '#/settings' ? 'on' : '' }, 'Ayarlar'),
  );
  const c = S.meta.credits;
  $foot.replaceChildren(
    h('div', { class: 'foot-row' }, h('span', {}, 'OpenAI'), h('span', { class: S.meta.openai ? '' : 'flag' }, S.meta.openai ? 'bağlı' : 'anahtar yok')),
    h('div', { class: 'foot-row' }, h('span', {}, 'Ideogram'), h('span', {}, S.meta.ideogram ? 'bağlı' : 'kapalı')),
    h('div', { class: 'foot-row' }, h('span', {}, 'Kredi'), h('span', {}, c.unlimited ? `sınırsız · ${c.spent} harcandı` : `${c.balance}`)),
  );
}

// ---------- router ----------
const routes = [
  [/^#?\/?$/, viewBrands],
  [/^#\/new$/, viewNewBrand],
  [/^#\/settings$/, viewSettings],
  [/^#\/usage$/, viewUsage],
  [/^#\/brand\/([\w]+)(?:\/(\w+))?(?:\/([A-J]))?$/, viewBrand],
];
async function route() {
  clearInterval(S.poll);
  const hash = location.hash || '#/';
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      $app.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spin', style: { width: '18px', height: '18px', border: '1.5px solid var(--muted)', borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' } })));
      try {
        await loadMeta();
        await fn(...m.slice(1));
      } catch (e) {
        $app.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'notice bad' }, e.message)));
      }
      renderSide();
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

function page(...kids) { $app.replaceChildren(h('div', { class: 'page' }, ...kids)); }
function keyBanner() {
  if (S.meta.openai) return null;
  return h('div', { class: 'notice warn', style: { marginBottom: '20px' } },
    h('div', {}, h('b', {}, 'OpenAI anahtarı tanımlı değil. '), 'Proje klasöründeki ', h('code', { class: 'mono' }, '.env.example'), ' dosyasını ', h('code', { class: 'mono' }, '.env'), ' olarak kopyala, OPENAI_API_KEY satırını doldur ve sunucuyu yeniden başlat.'));
}

// =====================================================================
// Brands list
// =====================================================================
async function viewBrands() {
  const list = S.brands;
  page(
    keyBanner(),
    h('div', { class: 'head' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Stüdyo'), h('h1', { class: 'h-display' }, 'Markalar'),
        h('p', { class: 'sub' }, 'Her marka önce tanınır, 100 strateji markaya uyarlanır, onayladığın gruplar 10’arlı batch’ler hâlinde kreatife dönüşür.')),
      h('a', { class: 'btn primary', href: '#/new' }, 'Yeni marka')),
    list.length
      ? h('div', { class: 'brand-grid' }, list.map(brandCard))
      : h('div', { class: 'empty' }, h('div', { class: 'h-display' }, 'İlk markanı ekle'),
        h('p', { class: 'sub' }, 'Marka brifiyle başlayacağız: 18 soru, ardından kimlik, ürün görselleri ve 100 strateji.'),
        h('a', { class: 'btn primary', href: '#/new' }, 'Marka ekle')),
  );
}
function brandCard(b) {
  const p = b.progress;
  const pct = Math.round(((p.approvedGroups / 10) * 0.4 + (p.creativesDone / 100) * 0.6) * 100);
  return h('a', { class: 'panel brand-card', href: `#/brand/${b.id}` },
    h('div', {}, h('div', { class: 'eyebrow' }, (b.brief?.name_sector || '').split(/[,\n]/).slice(1).join(',').trim() || 'Marka'), h('div', { class: 'name' }, b.name)),
    h('div', { class: 'swatches' }, (b.identity?.palette || []).slice(0, 7).map((c) => h('i', { style: { background: c.hex } }))),
    h('div', { class: 'stack', style: { gap: '8px' } },
      h('div', { class: 'meter' }, h('i', { style: { width: pct + '%' } })),
      h('div', { class: 'kv' }, h('span', {}, `${p.approvedGroups}/10 grup onaylı`), h('span', {}, `${p.creativesDone}/100 kreatif`))));
}

// =====================================================================
// New brand
// =====================================================================
async function viewNewBrand() {
  const name = h('input', { class: 'input', placeholder: 'Ör. Veralven', autofocus: true });
  const sector = h('input', { class: 'input', placeholder: 'Ör. saç derisi bakımı' });
  const free = h('textarea', { class: 'textarea', rows: 8, placeholder: 'Ürün, hedef kitle, fiyat, kampanya… Ne biliyorsan serbestçe yaz. Brif sorularını bir sonraki adımda tek tek de doldurabilirsin.' });
  const go = h('button', { class: 'btn primary' }, 'Markayı oluştur');
  go.onclick = () => busy(go, async () => {
    if (!name.value.trim()) { name.focus(); throw new Error('Marka adı gerekli'); }
    const b = await api('/brands', { method: 'POST', body: { name: name.value.trim(), freeText: free.value, brief: { name_sector: `${name.value.trim()}${sector.value ? ', ' + sector.value.trim() : ''}` } } });
    location.hash = `#/brand/${b.id}/brief`;
  });
  page(
    h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Markalar'), '/', 'Yeni'),
    h('div', { class: 'head' }, h('div', {}, h('h1', { class: 'h-display' }, 'Yeni marka'), h('p', { class: 'sub' }, 'Önce markayı tanıyalım. Bildiğin her şeyi yaz; eksikleri sistem tek kısa mesajda soracak.'))),
    h('div', { class: 'panel panel-pad stack', style: { maxWidth: '760px' } },
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', {}, 'Marka adı (birebir yazım)'), name), h('label', { class: 'field' }, h('span', {}, 'Sektör'), sector)),
      h('label', { class: 'field' }, h('span', {}, 'Serbest anlatım'), free),
      h('div', { class: 'btns' }, go)));
}

// =====================================================================
// Brand workspace
// =====================================================================
const TABS = [
  ['brief', 'Brif'],
  ['identity', 'Kimlik'],
  ['assets', 'Görseller'],
  ['strategy', 'Strateji'],
  ['creatives', 'Kreatifler'],
];

async function viewBrand(id, tab = 'brief', letter) {
  const brand = await api(`/brands/${id}`);
  const st = await api(`/brands/${id}/strategy`);
  const filledBrief = S.meta.briefFields.filter(([k]) => brand.brief[k]?.trim()).length;
  const idDone = !!(brand.identity.tone && (brand.identity.palette || []).length);
  const done = {
    brief: filledBrief >= 10,
    identity: idDone,
    assets: (brand.assets.products || []).length > 0,
    strategy: st.groups.some((g) => g.approved),
    creatives: brand.progress.creativesDone > 0,
  };
  const steps = h('nav', { class: 'steps' }, TABS.map(([k, label], i) =>
    h('a', { href: `#/brand/${id}/${k}`, class: tab === k ? 'on' : '' }, h('span', { class: `n ${done[k] ? 'done' : ''}` }, done[k] ? '✓' : i + 1), label)));
  const head = h('div', { class: 'head' },
    h('div', {}, h('div', { class: 'crumbs' }, h('a', { href: '#/' }, 'Markalar'), '/', brand.name), h('h1', { class: 'h-display' }, brand.name)),
    h('div', { class: 'btns' }, h('button', { class: 'btn ghost sm danger', onclick: async () => {
      if (!(await confirmBox('Markayı sil', `${brand.name} ve tüm stratejisi kaldırılacak. Üretilen görsel dosyaları diskte kalır.`, 'Sil'))) return;
      await api(`/brands/${id}`, { method: 'DELETE' }); location.hash = '#/';
    } }, 'Sil')));
  const body = h('div');
  page(keyBanner(), head, steps, body);
  const views = { brief: tabBrief, identity: tabIdentity, assets: tabAssets, strategy: tabStrategy, creatives: tabCreatives };
  await (views[tab] || tabBrief)(body, brand, st, letter);
}

const saveBrand = (id, patch) => api(`/brands/${id}`, { method: 'PUT', body: patch });

// ---------- Brif ----------
async function tabBrief(el, brand) {
  const fields = {};
  const grid = h('div', { class: 'grid2' }, S.meta.briefFields.map(([k, label], i) => {
    const ta = h('textarea', { class: 'textarea', rows: 3, placeholder: 'belirsiz' }, brand.brief[k] || '');
    fields[k] = ta;
    const f = h('label', { class: `field ${ta.value.trim() ? 'filled' : ''}`, id: `f-${k}` }, h('span', {}, h('b', {}, String(i + 1).padStart(2, '0')), label), ta);
    ta.addEventListener('input', () => f.classList.toggle('filled', !!ta.value.trim()));
    return f;
  }));
  const free = h('textarea', { class: 'textarea', rows: 5 }, brand.freeText || '');
  const collect = () => ({ brief: Object.fromEntries(Object.entries(fields).map(([k, t]) => [k, t.value])), freeText: free.value });
  const save = h('button', { class: 'btn' }, 'Kaydet');
  save.onclick = () => busy(save, async () => { await saveBrand(brand.id, collect()); toast('Brif kaydedildi', 'ok'); });
  const out = h('div');
  const check = h('button', { class: 'btn primary' }, 'Eksikleri sor');
  check.onclick = () => busy(check, async () => {
    await saveBrand(brand.id, collect());
    const r = await api(`/brands/${brand.id}/brief-check`, { method: 'POST' });
    out.replaceChildren(briefQuestions(r, fields, brand));
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 'Brif inceleniyor…');
  el.append(
    h('div', { class: 'head', style: { marginBottom: '18px' } },
      h('div', {}, h('h2', { class: 'h2' }, 'Marka brifi'), h('p', { class: 'sub' }, '100 strateji bu bilgilerle markaya uyarlanır. Bilmediğin alanları boş bırak; sistem “belirsiz” kabul eder ve uydurmaz.')),
      h('div', { class: 'btns' }, save, check)),
    out,
    h('div', { class: 'panel panel-pad stack' }, grid, h('label', { class: 'field' }, h('span', {}, 'Serbest anlatım'), free)),
    h('div', { class: 'btns', style: { marginTop: '18px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: async () => { await saveBrand(brand.id, collect()); location.hash = `#/brand/${brand.id}/identity`; } }, 'Kaydet ve kimliğe geç →')));
}
function briefQuestions(r, fields, brand) {
  if (r.ready || !r.questions.length) return h('div', { class: 'notice', style: { marginBottom: '16px' } }, h('div', {}, h('b', {}, 'Brif yeterli. '), r.message));
  const inputs = r.questions.map((q) => ({ q, ta: h('textarea', { class: 'textarea', rows: 2, placeholder: 'Bilmiyorsan boş bırak' }) }));
  const apply = h('button', { class: 'btn primary sm' }, 'Cevapları brife ekle');
  apply.onclick = () => busy(apply, async () => {
    for (const { q, ta } of inputs) {
      if (!ta.value.trim()) continue;
      const t = fields[q.field];
      t.value = t.value.trim() ? `${t.value.trim()}\n${ta.value.trim()}` : ta.value.trim();
      t.dispatchEvent(new Event('input'));
    }
    await saveBrand(brand.id, { brief: Object.fromEntries(Object.entries(fields).map(([k, t]) => [k, t.value])) });
    toast('Cevaplar brife eklendi', 'ok');
  });
  return h('div', { class: 'panel panel-pad stack', style: { marginBottom: '16px', borderColor: 'rgba(224,173,102,.3)' } },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Eksik bilgiler'), h('p', { class: 'sub', style: { color: 'var(--text-2)' } }, r.message)),
    inputs.map(({ q, ta }) => h('label', { class: 'field' }, h('span', {}, q.question, h('b', {}, q.impact)), ta)),
    h('div', { class: 'btns' }, apply));
}

// ---------- Kimlik ----------
async function tabIdentity(el, brand) {
  const idt = structuredClone(brand.identity);
  const F = (k, label, rows = 2, ph = '') => {
    const ta = h('textarea', { class: 'textarea', rows, placeholder: ph }, idt[k] || '');
    ta.oninput = () => (idt[k] = ta.value);
    return h('label', { class: 'field' }, h('span', {}, label), ta);
  };
  const I = (k, label, ph = '') => {
    const inp = h('input', { class: 'input', value: idt[k] || '', placeholder: ph });
    inp.oninput = () => (idt[k] = inp.value);
    return h('label', { class: 'field' }, h('span', {}, label), inp);
  };
  const palBox = h('div', { class: 'pal' });
  const drawPal = () => palBox.replaceChildren(
    ...(idt.palette || []).map((p, i) => {
      const hex = h('input', { class: 'input mono', value: p.hex || '' });
      const color = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(p.hex) ? p.hex : '#000000' });
      color.oninput = () => { p.hex = color.value.toUpperCase(); hex.value = p.hex; };
      hex.oninput = () => { p.hex = hex.value.trim(); if (/^#[0-9a-f]{6}$/i.test(p.hex)) color.value = p.hex; };
      const nm = h('input', { class: 'input', value: p.name || '', placeholder: 'Ad', oninput: (e) => (p.name = e.target.value) });
      const us = h('input', { class: 'input', value: p.usage || '', placeholder: 'Kullanım (ör. %60 arka plan)', oninput: (e) => (p.usage = e.target.value) });
      return h('div', { class: 'pal-row' }, color, hex, nm, us, h('button', { class: 'btn ghost sm', onclick: () => { idt.palette.splice(i, 1); drawPal(); } }, '×'));
    }),
    h('div', {}, h('button', { class: 'btn sm', onclick: () => { idt.palette = [...(idt.palette || []), { name: '', hex: '#', usage: '' }]; drawPal(); } }, '+ Renk')));
  drawPal();

  const form = h('div', { class: 'stack' });
  const draw = () => form.replaceChildren(
    h('div', { class: 'panel panel-pad stack' },
      h('div', { class: 'eyebrow' }, 'Strateji ve ses'),
      h('div', { class: 'grid2' }, I('tagline', 'Slogan'), I('ctaPreference', 'CTA tercihi', 'Ör. “İncele” gibi yumuşak CTA’lar')),
      F('story', 'Marka hikâyesi', 4),
      F('tone', 'Ses tonu (Biz … / Biz … değiliz)', 4)),
    h('div', { class: 'panel panel-pad stack' },
      h('div', { class: 'eyebrow' }, 'Renk paleti'), palBox),
    h('div', { class: 'panel panel-pad stack' },
      h('div', { class: 'eyebrow' }, 'Tipografi ve görsel dil'),
      h('div', { class: 'grid2' }, I('headlineFont', 'Başlık yazı tipi', 'Ör. Cormorant Garamond'), I('bodyFont', 'Gövde yazı tipi', 'Ör. Inter')),
      F('photography', 'Fotoğraf stili', 3, 'Işık, kompozisyon, renk tonu, modeller, yapılmayacaklar'),
      F('designRules', 'Tasarım kuralları', 3, 'Grid, boşluk, logo yerleşimi, yasaklar'),
      F('logoDescription', 'Logo tanımı', 2)));
  draw();

  const save = h('button', { class: 'btn primary' }, 'Kaydet');
  save.onclick = () => busy(save, async () => { await saveBrand(brand.id, { identity: idt }); toast('Kimlik kaydedildi', 'ok'); });
  const gen = h('button', { class: 'btn' }, 'Brifimden kimlik oluştur');
  const rationale = h('div');
  gen.onclick = async () => {
    const has = idt.tone || (idt.palette || []).length;
    if (has && !(await confirmBox('Kimliği yeniden oluştur', 'Mevcut kimlik alanlarının üzerine yazılacak. Kaydetmeden önce gözden geçirebilirsin.'))) return;
    await busy(gen, async () => {
      const d = await api(`/brands/${brand.id}/identity-draft`, { method: 'POST' });
      Object.assign(idt, { ...d, logoDescription: idt.logoDescription });
      drawPal(); draw();
      rationale.replaceChildren(h('div', { class: 'notice', style: { marginBottom: '16px' } }, h('div', {}, h('b', {}, 'Gerekçe. '), d.rationale, h('div', { class: 'muted', style: { marginTop: '6px' } }, 'Taslak henüz kaydedilmedi. Düzenleyip Kaydet’e bas.'))));
    }, 'Kimlik hazırlanıyor…');
  };
  el.append(
    h('div', { class: 'head', style: { marginBottom: '18px' } },
      h('div', {}, h('h2', { class: 'h2' }, 'Marka kimliği'), h('p', { class: 'sub' }, 'Kreatiflerin tek doğru kaynağı. Kimliğin varsa yapıştır; yoksa brifinden ajans standardında bir taslak oluştur.')),
      h('div', { class: 'btns' }, gen, save)),
    rationale, form,
    h('div', { class: 'btns', style: { marginTop: '18px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: async () => { await saveBrand(brand.id, { identity: idt }); location.hash = `#/brand/${brand.id}/assets`; } }, 'Kaydet ve görsellere geç →')));
}

// ---------- Görseller ----------
async function tabAssets(el, brand) {
  const uploader = (kind, title, help, multiple, list) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple, hidden: true });
    input.onchange = async () => {
      const fd = new FormData();
      for (const f of input.files) fd.append('files', f);
      try { await api(`/brands/${brand.id}/assets/${kind}`, { method: 'POST', form: fd }); route(); } catch (e) { toast(e.message, 'bad'); }
    };
    return h('div', { class: 'drop' },
      h('div', { class: 'ctop' }, h('div', {}, h('div', { class: 'h2' }, title), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, help)),
        h('button', { class: 'btn sm', onclick: () => input.click() }, multiple ? 'Ekle' : 'Yükle'), input),
      list.length ? h('div', { class: 'files' }, list.map((f) => h('div', { class: 'file' }, h('img', { src: `/files/uploads/${f.file}`, alt: f.name }),
        h('button', { title: 'Kaldır', onclick: async () => { await api(`/brands/${brand.id}/assets/${kind}/${f.file}`, { method: 'DELETE' }); route(); } }, '×')))) : null);
  };
  const a = brand.assets;
  const L = brand.logo;
  const mode = h('select', { class: 'select' },
    [['product', 'Logo sadece üründe (önerilen)'], ['overlay', 'Gerçek logo dosyasını bindir (birebir)'], ['ai', 'Logoyu model çizsin (referansla)']]
      .map(([v, t]) => h('option', { value: v, selected: L.mode === v }, t)));
  const pos = h('select', { class: 'select' }, [['top-left', 'Sol üst'], ['top-center', 'Üst orta'], ['top-right', 'Sağ üst'], ['bottom-left', 'Sol alt'], ['bottom-center', 'Alt orta'], ['bottom-right', 'Sağ alt']]
    .map(([v, t]) => h('option', { value: v, selected: L.position === v }, t)));
  const scale = h('input', { class: 'input', type: 'number', min: 6, max: 50, value: Math.round((L.scale || 0.2) * 100) });
  const prov = h('select', { class: 'select' }, [['openai', 'OpenAI (ürün sadakati yüksek)'], ['ideogram', 'Ideogram (tipografi güçlü)']]
    .map(([v, t]) => h('option', { value: v, selected: brand.provider === v, disabled: v === 'ideogram' && !S.meta.ideogram }, t)));
  const save = h('button', { class: 'btn primary' }, 'Kaydet');
  save.onclick = () => busy(save, async () => {
    await saveBrand(brand.id, { logo: { mode: mode.value, position: pos.value, scale: Number(scale.value) / 100 }, provider: prov.value });
    toast('Kaydedildi', 'ok');
  });
  el.append(
    h('div', { class: 'head', style: { marginBottom: '18px' } },
      h('div', {}, h('h2', { class: 'h2' }, 'Ürün, logo ve kalite referansları'), h('p', { class: 'sub' }, 'Gerçek ürün fotoğrafları görsel modeline referans olarak gider; ürün her kreatifte birebir aynı kalır.')),
      save),
    h('div', { class: 'grid2' },
      h('div', { class: 'stack' },
        uploader('products', 'Ürün fotoğrafları', 'Temiz, farklı açılardan 1–6 fotoğraf. Şekil, renk, etiket birebir korunur.', true, a.products || []),
        uploader('references', 'Kalite referansları', 'Beğendiğin, onaylı kreatif örnekleri. Kart yazımında kalite çıtası olarak kullanılır, kopyalanmaz.', true, a.references || [])),
      h('div', { class: 'stack' },
        uploader('logo', 'Logo', 'Şeffaf PNG önerilir.', false, a.logo ? [a.logo] : []),
        uploader('logoAlt', 'Logo (ters renk)', 'Koyu/açık zeminler için ikinci sürüm. Sistem zemine göre kontrastlı olanı seçer.', false, a.logoAlt ? [a.logoAlt] : []),
        h('div', { class: 'panel panel-pad stack' },
          h('label', { class: 'field' }, h('span', {}, 'Logo kullanımı'), mode),
          h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', {}, 'Konum'), pos), h('label', { class: 'field' }, h('span', {}, 'Genişlik (%)'), scale)),
          h('label', { class: 'field' }, h('span', {}, 'Varsayılan görsel motoru'), prov)))),
    h('div', { class: 'btns', style: { marginTop: '18px', justifyContent: 'flex-end' } }, h('a', { class: 'btn', href: `#/brand/${brand.id}/strategy` }, 'Stratejiye geç →')));
}

// ---------- Strateji ----------
async function tabStrategy(el, brand, st) {
  const gen = h('button', { class: 'btn primary' }, st.status === 'empty' ? '100 stratejiyi uyarla' : 'Baştan uyarla');
  gen.onclick = async () => {
    if (st.status !== 'empty' && !(await confirmBox('Baştan uyarla', 'Tüm satırlar ve grup onayları sıfırlanır. Elle yaptığın düzenlemeler kaybolur.', 'Baştan uyarla'))) return;
    await busy(gen, async () => { await api(`/brands/${brand.id}/strategy/generate`, { method: 'POST' }); route(); }, '100 strateji uyarlanıyor… (2–5 dk)');
  };
  const approved = st.groups.filter((g) => g.approved).length;
  const head = h('div', { class: 'head', style: { marginBottom: '18px' } },
    h('div', {}, h('h2', { class: 'h2' }, '100 strateji'),
      h('p', { class: 'sub' }, 'A–J yapısı, numaralar ve ★ işaretleri sabittir. Sistem yalnızca markaya özgü fikri yazar. Her grubu okuyup onayla; onaylanan grup kreatif üretimine açılır.')),
    h('div', { class: 'btns' }, st.status !== 'empty' ? h('span', { class: `badge ${approved === 10 ? 'ok' : 'accent'}` }, `${approved}/10 grup onaylı`) : null, gen));
  el.append(head);

  if (st.status === 'empty') {
    el.append(h('div', { class: 'empty' }, h('div', { class: 'h-display' }, 'Strateji henüz uyarlanmadı'),
      h('p', { class: 'sub' }, 'Brif ve kimlik ne kadar dolu olursa uyarlama o kadar özgün olur. Eksik ticari veriler satırdan silinmez, [… gerekli] olarak işaretlenir.')));
    return;
  }
  const chk = st.check;
  if (!chk.ok || chk.flagged.length || st.missingInfo.length) {
    el.append(h('div', { class: `notice ${chk.ok ? '' : 'bad'}`, style: { marginBottom: '16px' } }, h('div', { class: 'stack', style: { gap: '6px' } },
      !chk.ok && h('div', {}, h('b', {}, 'Yapı kontrolü: '), chk.issues.join(' · ')),
      chk.flagged.length ? h('div', {}, h('b', {}, `${chk.flagged.length} satır gerçek veri bekliyor: `), h('span', { class: 'mono' }, chk.flagged.join(' '))) : null,
      st.missingInfo.length ? h('div', {}, h('b', {}, 'Eksik bilgiler: '), st.missingInfo.join(' · '), ' ', h('a', { href: `#/brand/${brand.id}/brief`, style: { textDecoration: 'underline' } }, 'Brife ekle')) : null)));
  }

  for (const g of st.groups) {
    const items = Object.values(st.items).filter((i) => i.group === g.letter).sort((a, b) => a.id.localeCompare(b.id));
    const regen = h('button', { class: 'btn sm ghost' }, 'Grubu yeniden yaz');
    regen.onclick = async () => {
      const note = await ask({ title: `${g.letter} grubunu yeniden yaz`, text: 'Neyi değiştirmek istiyorsun? Boş bırakırsan daha özgün ve somut yazılır.', required: false, ok: 'Yeniden yaz' });
      if (note === null) return;
      await busy(regen, async () => { await api(`/brands/${brand.id}/strategy/regenerate`, { method: 'POST', body: { letter: g.letter, note } }); route(); }, 'Yazılıyor…');
    };
    const appr = h('button', { class: `btn sm ${g.approved ? '' : 'primary'}` }, g.approved ? 'Onayı kaldır' : 'Grubu onayla');
    appr.onclick = () => busy(appr, async () => {
      await api(`/brands/${brand.id}/strategy/groups/${g.letter}/approve`, { method: 'POST', body: { approved: !g.approved } });
      toast(g.approved ? 'Onay kaldırıldı' : `${g.letter} onaylandı. Kreatifler sekmesinden kartları hazırlayabilirsin.`, 'ok');
      route();
    });
    el.append(h('section', { class: `panel group ${g.approved ? 'approved' : ''}`, id: `g-${g.letter}` },
      h('div', { class: 'group-head' },
        h('div', { class: 'letter' }, g.letter),
        h('div', {}, h('div', { class: 'group-title' }, g.name, g.approved ? h('span', { class: 'badge ok', style: { marginLeft: '10px' } }, 'Onaylı') : null), h('div', { class: 'group-goal' }, 'Amaç: ', g.goal)),
        h('div', { class: 'btns' }, regen, appr, g.approved ? h('a', { class: 'btn sm', href: `#/brand/${brand.id}/creatives/${g.letter}` }, 'Kreatiflere →') : null)),
      h('div', { class: 'rows' }, items.map((it) => strategyRow(brand, it)))));
  }
}
function strategyRow(brand, it) {
  const idea = h('div', { class: 'idea', html: markFlags(it.idea) });
  const edit = h('button', { class: 'btn ghost sm', title: 'Düzenle' }, 'Düzenle');
  edit.onclick = async () => {
    if (idea.isContentEditable) {
      idea.contentEditable = 'false';
      edit.textContent = 'Düzenle';
      const text = idea.textContent.trim();
      if (text && text !== it.idea) { await api(`/brands/${brand.id}/strategy/items/${it.id}`, { method: 'PUT', body: { idea: text } }); it.idea = text; toast(`${it.id} güncellendi. Grubun onayı kaldırıldı.`); }
      idea.innerHTML = markFlags(it.idea);
      return;
    }
    idea.textContent = it.idea;
    idea.contentEditable = 'true';
    idea.focus();
    edit.textContent = 'Kaydet';
  };
  const re = h('button', { class: 'btn ghost sm', title: 'Bu satırı yeniden yaz' }, '↻');
  re.onclick = async () => {
    const note = await ask({ title: `${it.id} — ${it.strategyAdapted}`, text: 'Bu satırı nasıl değiştirelim?', required: false, ok: 'Yeniden yaz' });
    if (note === null) return;
    await busy(re, async () => { await api(`/brands/${brand.id}/strategy/regenerate`, { method: 'POST', body: { ids: [it.id], note } }); route(); }, '');
  };
  return h('div', { class: 'row' },
    h('div', { class: 'num' }, it.id, it.star ? h('span', { class: 'star' }, ' ★') : null),
    h('div', { class: 'strat' }, it.strategyAdapted, it.strategyAdapted !== it.strategy ? h('small', {}, it.strategy) : null),
    idea,
    h('div', { class: 'tools' }, edit, re));
}

// ---------- Kreatifler ----------
async function tabCreatives(el, brand, st, letter) {
  const batches = await api(`/brands/${brand.id}/batches`);
  const current = letter || batches.find((b) => b.approved && b.done < 10)?.letter || batches.find((b) => b.approved)?.letter || 'A';
  el.append(h('div', { class: 'batch-tabs' }, batches.map((b, i) =>
    h('a', { class: `batch-tab ${b.letter === current ? 'on' : ''} ${b.approved ? '' : 'locked'}`, href: `#/brand/${brand.id}/creatives/${b.letter}`, title: `${b.name}${b.approved ? '' : ' (strateji onayı bekliyor)'}` },
      h('div', { class: 'l' }, b.letter),
      h('div', { class: 's' }, `Batch ${i + 1}`),
      h('div', { class: 'meter' }, h('i', { style: { width: `${b.done * 10}%` } })),
      h('div', { class: 's' }, b.busy ? `${b.busy} üretimde` : `${b.done}/10${b.avgScore ? ` · ${b.avgScore}` : ''}`)))));
  const box = h('div');
  el.append(box);
  await renderBatch(box, brand, st, current, batches.find((b) => b.letter === current));
}

async function renderBatch(box, brand, st, letter, meta) {
  const g = st.groups.find((x) => x.letter === letter);
  const data = await api(`/brands/${brand.id}/batches/${letter}`);
  const { batch, creatives } = data;
  const no = st.groups.indexOf(g) + 1;

  const header = h('div', { class: 'head', style: { marginBottom: '18px' } },
    h('div', {}, h('div', { class: 'eyebrow' }, `Batch ${no}/10 · ${letter} — ${g.name}`), h('h2', { class: 'h-display', style: { fontSize: '32px', marginTop: '6px' } }, g.goal),
      batch?.psychology ? h('p', { class: 'sub' }, batch.psychology) : null),
    h('div', { class: 'btns' }));
  const actions = header.lastChild;
  box.replaceChildren(header);

  if (!g.approved) {
    box.append(h('div', { class: 'notice warn' }, h('div', {}, h('b', {}, 'Bu grup henüz onaylanmadı. '), 'Önce ', h('a', { href: `#/brand/${brand.id}/strategy`, style: { textDecoration: 'underline' } }, 'strateji sekmesinde'), ` ${letter} grubunu oku ve onayla.`)));
    return;
  }

  const mkCards = h('button', { class: `btn ${creatives.length ? '' : 'primary'}` }, creatives.length ? 'Kartları yeniden hazırla' : '10 görev kartını hazırla');
  mkCards.onclick = async () => {
    let note = '';
    if (creatives.length) {
      note = await ask({ title: 'Kartları yeniden hazırla', text: 'Onaylanmış kartlar da taslağa döner. Görseller silinmez. İstersen bir yön notu ekle.', required: false, ok: 'Yeniden hazırla' });
      if (note === null) return;
    }
    await busy(mkCards, async () => { await api(`/brands/${brand.id}/batches/${letter}/cards`, { method: 'POST', body: { note } }); route(); }, 'Kartlar yazılıyor ve puanlanıyor… (1–3 dk)');
  };
  actions.append(mkCards);

  if (creatives.length) {
    const drafts = creatives.filter((c) => c.cardStatus !== 'approved').length;
    const approveAll = h('button', { class: 'btn', disabled: !drafts }, 'Tüm kartları onayla');
    approveAll.onclick = () => busy(approveAll, async () => { await api(`/brands/${brand.id}/batches/${letter}/approve-all`, { method: 'POST' }); route(); });
    const pending = creatives.filter((c) => c.cardStatus === 'approved' && !c.images.length && !c.missing.length && c.status === 'idle').length;
    const genAll = h('button', { class: 'btn primary', disabled: !pending }, `Onaylıları üret (${pending})`);
    genAll.onclick = () => busy(genAll, async () => {
      const r = await api(`/brands/${brand.id}/batches/${letter}/generate`, { method: 'POST', body: {} });
      r.skipped?.forEach((m) => toast(m, 'bad'));
      route();
    });
    const summary = h('button', { class: 'btn ghost' }, 'Durum özeti');
    summary.onclick = () => showSummary(brand, st, g, creatives);
    actions.append(approveAll, genAll, summary);

    if (batch?.diversity && Object.keys(batch.diversity).length) {
      box.append(h('div', { class: 'notice warn', style: { marginBottom: '16px' } }, h('div', {}, h('b', {}, 'Çeşitlilik uyarısı: '), Object.entries(batch.diversity).map(([k, v]) => `${k}: ${v}`).join(' · '))));
    }
    const scores = creatives.map((c) => c.card.critic?.score).filter(Number.isFinite);
    if (scores.length) {
      const low = creatives.filter((c) => (c.card.critic?.score ?? 10) < 9).map((c) => c.num);
      box.append(h('div', { class: 'chips', style: { marginBottom: '16px' } },
        h('span', { class: 'badge accent' }, `Kart puanı ort. ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}`),
        low.length ? h('span', { class: 'badge warn' }, `9 altı: ${low.join(', ')}`) : h('span', { class: 'badge ok' }, 'Tüm kartlar 9+'),
        h('span', { class: 'badge' }, `${creatives.filter((c) => c.cardStatus === 'approved').length}/10 onaylı`),
        h('span', { class: 'badge' }, `${creatives.filter((c) => c.images.length).length}/10 görsel`)));
    }
    creatives.forEach((c) => box.append(creativeCard(brand, c)));
  } else {
    box.append(h('div', { class: 'empty' }, h('div', { class: 'h-display' }, '10 görev kartı'),
      h('p', { class: 'sub' }, 'Her strateji satırı için satış mantığı, başlık, görsel kurgu ve reklam metni içeren bir kart yazılır. Kartlar kendi içinde puanlanır; 9 altı olanlar ve birbirine benzeyenler otomatik yeniden yazılır.')));
  }

  if (creatives.some((c) => ['queued', 'generating', 'reviewing'].includes(c.status))) {
    S.poll = setInterval(async () => {
      if (!location.hash.includes('/creatives')) return clearInterval(S.poll);
      const fresh = await api(`/brands/${brand.id}/batches/${letter}`).catch(() => null);
      if (!fresh) return;
      const sig = (list) => list.map((c) => `${c.status}:${c.images.length}`).join('|');
      if (sig(fresh.creatives) !== sig(creatives)) route();
    }, 2500);
  }
}

const STATUS = { idle: ['', ''], queued: ['Sırada', 'warn'], generating: ['Üretiliyor', 'warn'], reviewing: ['Kalite kontrol', 'warn'], done: ['Hazır', 'ok'], failed: ['Hata', 'bad'] };
const FUNNEL = { cold: 'Soğuk', warm: 'Ilık', hot: 'Sıcak' };
const scoreClass = (s) => (s >= 9 ? 'ok' : s >= 7 ? 'warn' : 'bad');

function creativeCard(brand, c) {
  const card = c.card;
  const img = c.images[c.current];
  const working = ['queued', 'generating', 'reviewing'].includes(c.status);
  const ratio = card.format === '1:1' ? 'r11' : card.format === '9:16' ? 'r916' : '';
  const frame = h('div', { class: `frame ${ratio}` },
    img ? h('img', { src: `/files/creatives/${img.file}`, alt: card.headline, onclick: () => lightbox(`/files/creatives/${img.file}`) })
      : h('div', { class: 'ph' }, h('div', { class: 'big' }, c.num), working ? STATUS[c.status][0] + '…' : c.cardStatus === 'approved' ? 'Üretime hazır' : 'Kart onayı bekliyor'),
    working ? h('div', { class: 'shimmer' }) : null,
    h('div', { class: 'over' },
      img?.qa?.score ? h('span', { class: `badge ${scoreClass(img.qa.score)}` }, h('span', { class: 'score' }, `${img.qa.score}/10`)) : null,
      working ? h('span', { class: 'badge warn' }, STATUS[c.status][0], c.attempt > 1 ? ` · deneme ${c.attempt}` : '') : null));
  const left = h('div', {}, frame,
    c.images.length > 1 ? h('div', { class: 'thumbs' }, c.images.map((im, i) =>
      h('button', { class: i === c.current ? 'on' : '', title: `Sürüm ${i + 1}`, onclick: async () => { await api(`/brands/${brand.id}/creatives/${c.num}`, { method: 'PUT', body: { current: i } }); route(); } },
        h('img', { src: `/files/creatives/${im.file}` }), im.qa?.score ? h('span', {}, im.qa.score) : null))) : null);

  // editable copy
  const ed = {};
  const field = (k, label, rows = 1) => {
    const el = rows > 1 ? h('textarea', { class: 'textarea', rows }, card[k] || '') : h('input', { class: 'input', value: card[k] || '' });
    ed[k] = el;
    return h('label', { class: 'field' }, h('span', {}, label), el);
  };
  const dataInputs = (card.required_data || []).map((r) => {
    const inp = h('input', { class: 'input', value: c.data?.[r.token] || '', placeholder: r.label });
    inp.dataset.token = r.token;
    return h('label', { class: 'field' }, h('span', {}, h('b', {}, r.token), r.label), inp);
  });

  const saveBtn = h('button', { class: 'btn sm' }, 'Kaydet');
  const collect = () => ({
    card: Object.fromEntries(Object.entries(ed).map(([k, e]) => [k, e.value])),
    data: Object.fromEntries(dataInputs.map((d) => { const i = d.querySelector('input'); return [i.dataset.token, i.value]; })),
  });
  saveBtn.onclick = () => busy(saveBtn, async () => { await api(`/brands/${brand.id}/creatives/${c.num}`, { method: 'PUT', body: collect() }); toast(`${c.num} kaydedildi`, 'ok'); route(); });

  const approve = h('button', { class: `btn sm ${c.cardStatus === 'approved' ? '' : 'primary'}` }, c.cardStatus === 'approved' ? 'Onayı kaldır' : 'Onayla');
  approve.onclick = () => busy(approve, async () => {
    await api(`/brands/${brand.id}/creatives/${c.num}`, { method: 'PUT', body: collect() });
    await api(`/brands/${brand.id}/creatives/${c.num}/approve`, { method: 'POST', body: { approved: c.cardStatus !== 'approved' } });
    route();
  });
  const revise = h('button', { class: 'btn sm' }, 'Revize');
  revise.onclick = async () => {
    const note = await ask({ title: `Görev ${c.num} — revize`, text: 'Kartta neyi değiştirelim? Kart strateji satırına sadık kalarak yeniden yazılır ve tekrar puanlanır.', placeholder: 'Ör. başlık daha merak uyandırıcı olsun, sahne banyo yerine ofis olsun' });
    if (!note) return;
    await busy(revise, async () => { await api(`/brands/${brand.id}/creatives/${c.num}/revise`, { method: 'POST', body: { note } }); route(); }, 'Revize ediliyor…');
  };
  const prov = h('select', { class: 'select', style: { width: 'auto', height: '28px', padding: '0 26px 0 8px', fontSize: '12px' } },
    h('option', { value: 'openai', selected: c.provider !== 'ideogram' }, 'OpenAI'), h('option', { value: 'ideogram', selected: c.provider === 'ideogram', disabled: !S.meta.ideogram }, 'Ideogram'));
  const gen = h('button', { class: 'btn sm primary', disabled: c.cardStatus !== 'approved' || working }, c.images.length ? 'Yeniden üret' : 'Görseli üret');
  gen.onclick = () => busy(gen, async () => {
    await api(`/brands/${brand.id}/creatives/${c.num}`, { method: 'PUT', body: collect() });
    await api(`/brands/${brand.id}/creatives/${c.num}/generate`, { method: 'POST', body: { provider: prov.value } });
    route();
  });
  const promptBtn = h('button', { class: 'btn sm ghost' }, 'Prompt');
  promptBtn.onclick = async () => {
    const { prompt } = await api(`/brands/${brand.id}/creatives/${c.num}/prompt`);
    modal((close) => {
      const ta = h('textarea', { class: 'textarea mono', rows: 22, style: { fontSize: '12px' } }, img?.prompt || prompt);
      return h('div', { class: 'panel-pad' }, h('h3', { class: 'h2' }, `Görsel promptu — ${c.num}`),
        h('p', { class: 'sub' }, 'Karttan otomatik oluşturulur. Buradan düzenleyip tek seferlik bu promptla üretebilirsin.'), ta,
        h('div', { class: 'btns', style: { justifyContent: 'flex-end' } },
          h('button', { class: 'btn ghost', onclick: close }, 'Kapat'),
          h('button', { class: 'btn primary', disabled: c.cardStatus !== 'approved', onclick: async () => {
            try { await api(`/brands/${brand.id}/creatives/${c.num}/generate`, { method: 'POST', body: { provider: prov.value, prompt: ta.value } }); close(); route(); } catch (e) { toast(e.message, 'bad'); }
          } }, 'Bu promptla üret')));
    }, { wide: true });
  };
  const dl = img ? h('a', { class: 'btn sm ghost', href: `/files/creatives/${img.file}`, download: `${brand.name}-${c.num}.png` }, 'İndir') : null;
  const copyText = h('button', { class: 'btn sm ghost', onclick: () => { navigator.clipboard.writeText(card.primary_text || ''); toast('Reklam metni kopyalandı'); } }, 'Metni kopyala');

  const critic = card.critic;
  const qaBox = img?.qa ? h('div', { class: 'qa' },
    h('div', { class: 'chips' },
      h('span', { class: `badge ${scoreClass(img.qa.score)}` }, `Görsel ${img.qa.score ?? '–'}/10`),
      img.qa.sales_power ? h('span', { class: 'badge' }, `Satış gücü ${img.qa.sales_power}/10`) : null,
      img.qa.text_exact === false ? h('span', { class: 'badge bad' }, 'Yazı hatası') : img.qa.text_exact ? h('span', { class: 'badge ok' }, 'Yazı doğru') : null,
      img.qa.product_ok === false ? h('span', { class: 'badge bad' }, 'Ürün farklı') : null,
      img.qa.similarTo ? h('span', { class: 'badge warn' }, `${img.qa.similarTo} ile benzer`) : null,
      h('span', { class: 'badge' }, img.provider === 'ideogram' ? 'Ideogram' : 'OpenAI')),
    img.qa.issues?.length ? h('ul', {}, img.qa.issues.map((i) => h('li', {}, i))) : null) : null;

  return h('article', { class: 'panel creative', id: `c-${c.num}` },
    left,
    h('div', { class: 'cbody' },
      h('div', { class: 'ctop' },
        h('div', {}, h('div', { class: 'ctitle' }, `GÖREV ${c.num}`, card.star ? h('span', { class: 'star' }, ' ★') : null), h('div', { class: 'cname' }, card.formatName)),
        h('div', { class: 'chips' },
          critic ? h('span', { class: `badge ${scoreClass(critic.score)}`, title: critic.strengths }, `Kart ${critic.score}/10`) : null,
          h('span', { class: 'badge' }, FUNNEL[card.funnel] || card.funnel),
          h('span', { class: 'badge' }, card.format),
          c.cardStatus === 'approved' ? h('span', { class: 'badge ok' }, 'Onaylı') : h('span', { class: 'badge' }, 'Taslak'),
          c.status === 'failed' ? h('span', { class: 'badge bad' }, 'Hata') : null)),
      h('div', { class: 'verbatim' }, card.strategyVerbatim),
      c.status === 'failed' && c.error ? h('div', { class: 'notice bad' }, c.error) : null,
      h('dl', { class: 'kvs' },
        h('dt', {}, 'Hook'), h('dd', {}, card.hook),
        h('dt', {}, 'Satış açısı'), h('dd', {}, card.sales_angle),
        h('dt', {}, 'Satış mantığı'), h('dd', {}, card.sales_logic),
        h('dt', {}, 'Kurgu tipi'), h('dd', {}, `${card.layout} · ${card.background} · yazı: ${card.text_placement}`)),
      h('div', { class: 'copy' }, field('headline', 'Ana başlık'), field('subline', 'Alt metin'), field('cta', 'CTA')),
      dataInputs.length ? h('div', { class: 'needs' }, h('div', { class: 'h' }, 'Gerçek veri gerekli. Doldurmadan görsel üretilmez.'), h('div', { class: 'grid2' }, dataInputs)) : null,
      field('visual', 'Görsel kurgu', 3),
      h('details', { class: 'more' }, h('summary', {}, 'Marka uygulaması, reklam metni ve format'),
        h('div', { class: 'stack', style: { marginTop: '12px' } },
          field('brand_application', 'Marka uygulaması', 2),
          field('primary_text', 'Reklam metni (primary text)', 4),
          h('div', { class: 'muted', style: { fontSize: '12px' } }, `Format: ${card.format} — ${card.format_reason}`),
          card.improvement ? h('div', { class: 'muted', style: { fontSize: '12px' } }, `Öneri: ${card.improvement}`) : null)),
      critic?.must_fix?.length && critic.score < 9 ? h('div', { class: 'qa' }, h('div', { class: 'muted' }, 'Kart değerlendirmesi'), h('ul', {}, critic.must_fix.map((m) => h('li', {}, m)))) : null,
      qaBox,
      h('div', { class: 'btns' }, approve, revise, saveBtn, h('span', { style: { flex: 1 } }), prov, gen, promptBtn, copyText, dl)));
}

function showSummary(brand, st, g, creatives) {
  const idt = brand.identity;
  const lines = [
    `DURUM ÖZETİ — ${brand.name}`,
    `Batch ${st.groups.indexOf(g) + 1}/10 · ${g.letter} — ${g.name}`,
    '',
    'ID | Format | Başlık | Kart | Görsel',
    ...creatives.map((c) => `${c.num} | ${c.card.formatName} | ${c.card.headline} | ${c.cardStatus === 'approved' ? 'onaylı' : 'taslak'} ${c.card.critic?.score ?? '-'} | ${c.images.length ? `✓ ${c.images[c.current]?.qa?.score ?? '-'}/10` : '—'}`),
    '',
    'Marka kimliği kuralları:',
    `- Renkler: ${(idt.palette || []).map((p) => `${p.name} ${p.hex}`).join(', ') || '—'}`,
    `- Yazı tipleri: ${idt.headlineFont || '—'} / ${idt.bodyFont || '—'}`,
    `- Ton: ${(idt.tone || '—').replace(/\n/g, ' ')}`,
    `- Logo: ${brand.logo.mode}`,
    '',
    'Girilen gerçek veriler:',
    ...creatives.flatMap((c) => Object.entries(c.data || {}).filter(([, v]) => v).map(([k, v]) => `- ${c.num} ${k}: ${v}`)),
    '',
    `Tamamlanan ID'ler: ${creatives.filter((c) => c.images.length).map((c) => c.num).join(', ') || '—'}`,
  ];
  modal((close) => h('div', { class: 'panel-pad' }, h('h3', { class: 'h2' }, 'Durum özeti'), h('pre', { class: 'prompt' }, lines.join('\n')),
    h('div', { class: 'btns', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onclick: close }, 'Kapat'),
      h('button', { class: 'btn primary', onclick: () => { navigator.clipboard.writeText(lines.join('\n')); toast('Kopyalandı'); } }, 'Kopyala'))), { wide: true });
}

// =====================================================================
// Settings & usage
// =====================================================================
async function viewSettings() {
  const s = S.meta.settings;
  const I = (k, label, help = '') => h('label', { class: 'field' }, h('span', {}, label, help && h('b', {}, help)), h('input', { class: 'input', name: k, value: s[k] ?? '' }));
  const Sel = (k, label, opts) => h('label', { class: 'field' }, h('span', {}, label), h('select', { class: 'select', name: k }, opts.map(([v, t]) => h('option', { value: v, selected: String(s[k]) === v }, t))));
  const form = h('form', { class: 'stack', onsubmit: (e) => e.preventDefault() },
    h('div', { class: 'panel panel-pad stack' }, h('div', { class: 'eyebrow' }, 'Modeller'),
      h('div', { class: 'grid3' }, I('textModel', 'Metin modeli', 'strateji, kart'), I('visionModel', 'Kalite kontrol modeli', 'görsel okuyabilmeli'), I('imageModel', 'Görsel modeli')),
      h('div', { class: 'grid3' },
        Sel('reasoningEffort', 'Reasoning seviyesi', [['', 'Gönderme'], ['low', 'Düşük'], ['medium', 'Orta'], ['high', 'Yüksek']]),
        Sel('inputFidelity', 'Referans sadakati', [['', 'Gönderme'], ['low', 'Düşük'], ['high', 'Yüksek']]),
        Sel('imageQuality', 'Görsel kalitesi', [['high', 'Yüksek'], ['medium', 'Orta'], ['low', 'Düşük']]))),
    h('div', { class: 'panel panel-pad stack' }, h('div', { class: 'eyebrow' }, 'Kalite kapısı'),
      h('div', { class: 'grid3' }, I('qaMinScore', 'Minimum görsel puanı', '0 = kapalı'), I('qaAutoRetry', 'Otomatik yeniden deneme'),
        Sel('defaultProvider', 'Varsayılan motor', [['openai', 'OpenAI'], ['ideogram', 'Ideogram']]))));
  const save = h('button', { class: 'btn primary' }, 'Kaydet');
  save.onclick = () => busy(save, async () => {
    const body = Object.fromEntries(new FormData(form).entries());
    await api('/settings', { method: 'PUT', body });
    toast('Ayarlar kaydedildi', 'ok');
  });
  const test = h('button', { class: 'btn' }, 'OpenAI bağlantısını test et');
  const out = h('div');
  test.onclick = () => busy(test, async () => {
    const r = await api('/test-openai', { method: 'POST' });
    const tag = (ok, t) => h('span', { class: `badge ${ok ? 'ok' : 'warn'}` }, `${t}: ${ok ? 'erişilebilir' : 'listede yok'}`);
    out.replaceChildren(h('div', { class: 'chips', style: { marginTop: '12px' } }, h('span', { class: 'badge ok' }, `Anahtar çalışıyor · ${r.count} model`), tag(r.has.text, 'Metin'), tag(r.has.vision, 'Kontrol'), tag(r.has.image, 'Görsel')));
  });
  page(h('div', { class: 'head' }, h('div', {}, h('h1', { class: 'h-display' }, 'Ayarlar'), h('p', { class: 'sub' }, 'API anahtarları yalnızca .env dosyasında durur ve tarayıcıya gönderilmez.')), h('div', { class: 'btns' }, test, save)), out, form);
}

async function viewUsage() {
  const c = await api('/credits');
  const labels = { strategy: '100 strateji uyarlama', strategy_group: 'Grup yeniden yazma', strategy_line: 'Satır yeniden yazma', brief_check: 'Brif kontrolü', identity_draft: 'Kimlik taslağı', cards: '10 görev kartı', card_revise: 'Kart revizesi', image: 'Kreatif görseli' };
  page(
    h('div', { class: 'head' }, h('div', {}, h('h1', { class: 'h-display' }, 'Kullanım ve kredi'),
      h('p', { class: 'sub' }, 'Lokal modda kredi düşülmez ama her işlem kayıt altına alınır. Üyelik modeline geçildiğinde bu tablo fiyatlandırmanın temeli olur.'))),
    h('div', { class: 'grid3', style: { marginBottom: '16px' } },
      h('div', { class: 'panel panel-pad' }, h('div', { class: 'eyebrow' }, 'Bakiye'), h('div', { class: 'h-display' }, c.unlimited ? '∞' : c.balance)),
      h('div', { class: 'panel panel-pad' }, h('div', { class: 'eyebrow' }, 'Harcanan'), h('div', { class: 'h-display' }, c.spent)),
      h('div', { class: 'panel panel-pad' }, h('div', { class: 'eyebrow' }, 'Görsel başına'), h('div', { class: 'h-display' }, c.costs.image))),
    h('div', { class: 'grid2' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', { class: 'h2' }, 'Kredi tarifesi')),
        h('table', { class: 't' }, h('tbody', {}, Object.entries(c.costs).map(([k, v]) => h('tr', {}, h('td', {}, labels[k] || k), h('td', { class: 'mono' }, v), h('td', { class: 'mono muted' }, c.byAction[k] ? `${c.byAction[k]} harcandı` : '')))))),
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', { class: 'h2' }, 'Son işlemler')),
        c.recent.length ? h('table', { class: 't' }, h('tbody', {}, c.recent.map((e) => h('tr', {}, h('td', {}, labels[e.action] || e.action), h('td', { class: 'mono' }, `−${e.amount}`), h('td', { class: 'muted' }, new Date(e.at).toLocaleString('tr-TR'))))))
          : h('div', { class: 'panel-pad muted' }, 'Henüz işlem yok.'))));
}

route();
