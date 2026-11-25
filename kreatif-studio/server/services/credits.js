// Credit ledger. Locally every action is logged but nothing is blocked (CREDITS_UNLIMITED=true).
// When the product becomes paid, set CREDITS_UNLIMITED=false and plug real auth into currentUser().
import { config } from '../env.js';
import { Users, Ledger } from '../store.js';

export const COSTS = {
  strategy: 10,        // 100 stratejinin markaya uyarlanması
  strategy_group: 2,   // bir grubun yeniden yazılması
  strategy_line: 1,    // tek satırın yeniden yazılması
  brief_check: 1,
  identity_draft: 3,
  cards: 3,            // 10 görev kartı
  card_revise: 1,
  image: 5,            // bir kreatif görseli (kalite kontrol dahil)
};

const LOCAL_ID = 'usr_local';

export function currentUser(_req) {
  return Users.get(LOCAL_ID) || Users.insert({ id: LOCAL_ID, name: 'Lokal kullanıcı', plan: 'local', credits: config.startingCredits });
}

export class CreditError extends Error {
  constructor(need, have) { super(`Yetersiz kredi: ${need} gerekli, bakiye ${have}.`); this.status = 402; }
}

export function assertCredits(user, action, qty = 1) {
  const need = (COSTS[action] || 0) * qty;
  if (!config.creditsUnlimited && user.credits < need) throw new CreditError(need, user.credits);
}

export function charge(user, action, meta = {}, qty = 1) {
  const amount = (COSTS[action] || 0) * qty;
  if (!amount) return;
  if (!config.creditsUnlimited) Users.update(user.id, (u) => ({ ...u, credits: u.credits - amount }));
  Ledger.add({ userId: user.id, action, amount, ...meta });
}

export function summary(user) {
  const entries = Ledger.forUser(user.id);
  const byAction = {};
  for (const e of entries) byAction[e.action] = (byAction[e.action] || 0) + e.amount;
  return {
    unlimited: config.creditsUnlimited,
    balance: Users.get(user.id).credits,
    spent: entries.reduce((s, e) => s + e.amount, 0),
    byAction,
    costs: COSTS,
    recent: entries.slice(-30).reverse(),
  };
}
