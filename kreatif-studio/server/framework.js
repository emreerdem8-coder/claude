// Loads the user's raw prompt files from /prompts. They are the source of truth:
// edit prompts/strateji.txt and the 100-strategy skeleton changes with it.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';

const read = (f) => fs.readFileSync(path.join(config.promptsDir, f), 'utf8');

export function loadPrompts() {
  return {
    strategy: read('strateji.txt'),
    creative: read('kreatif.txt'),
    branding: read('branding.txt'),
  };
}

// Parses the "KORUNACAK 100 STRATEJİ" block into a fixed skeleton.
export function loadSkeleton() {
  const txt = read('strateji.txt');
  const start = txt.indexOf('KORUNACAK 100 STRATEJİ');
  const end = txt.indexOf('SON KONTROL', start);
  if (start < 0) throw new Error('prompts/strateji.txt içinde "KORUNACAK 100 STRATEJİ" bölümü bulunamadı.');
  const block = txt.slice(start, end > 0 ? end : undefined).split(/\r?\n/);

  const groups = [];
  let g = null;
  for (const raw of block) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^([A-J])\s*[—–-]\s*(.+)$/))) {
      g = { letter: m[1], name: m[2].trim(), goal: '', items: [] };
      groups.push(g);
    } else if (g && (m = line.match(/^Amaç:\s*(.+)$/))) {
      g.goal = m[1].trim();
    } else if (g && (m = line.match(/^(\d{3})\s*(★)?\s*(.+)$/))) {
      g.items.push({ id: m[1], star: !!m[2], strategy: m[3].trim(), group: g.letter });
    }
  }
  const items = groups.flatMap((x) => x.items);
  const problems = [];
  if (groups.length !== 10) problems.push(`10 grup bekleniyordu, ${groups.length} bulundu`);
  groups.forEach((x) => x.items.length !== 10 && problems.push(`${x.letter} grubunda ${x.items.length} madde var`));
  items.forEach((it, i) => it.id !== String(i + 1).padStart(3, '0') && problems.push(`${it.id} sırası hatalı`));
  if (problems.length) throw new Error('Strateji dosyası okunamadı: ' + problems.join('; '));
  return { groups, items };
}

export const BRIEF_FIELDS = [
  ['name_sector', 'Marka adı ve sektör'],
  ['product', 'Ürün/hizmet nedir? Hangi modeller veya seçenekler var?'],
  ['audience', 'Hedef müşteri kim? Hangi durumda satın alır?'],
  ['problem_result', 'Çözdüğü sorun ve müşterinin ulaşmak istediği sonuç'],
  ['top_features', 'En önemli üç özellik ve bunların müşteriye faydaları'],
  ['difference', 'Rakiplerden farkı'],
  ['hesitations', 'Müşterinin satın almadan önceki tereddütleri'],
  ['use_cases', 'Kullanım alanları veya kullanım anları'],
  ['character', 'Marka karakteri: premium, samimi, eğlenceli, teknik vb.'],
  ['visual_style', 'Renkler, görsel tarz, örnek alınabilecek markalar'],
  ['price', 'Güncel satış fiyatı, varsa gerçek önceki fiyat'],
  ['campaign', 'Kampanya, avantaj ve başlangıç/bitiş tarihi'],
  ['offers', 'Tekli ürün, paket, ikinci ürün veya abonelik teklifleri'],
  ['logistics', 'Kargo, ödeme, teslimat, iade/değişim bilgileri'],
  ['stock', 'Gerçek stok, tükenen seçenekler, yeni ürün veya stok tarihleri'],
  ['proof', 'Kullanılabilecek gerçek yorumlar, fotoğraflar, testler ve diğer kanıtlar'],
  ['forbidden', 'Kullanılmasını istemediğim ifadeler veya bilgiler'],
  ['assets', 'Varsa ürün görselleri, site, katalog ve mevcut reklamlar'],
];

export const BATCH_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
