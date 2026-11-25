// JSON-file data store behind a tiny repository API.
// Swap this module for Postgres/SQLite later without touching services.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './env.js';

const DB_FILE = path.join(config.dataDir, 'db.json');
export const UPLOAD_DIR = path.join(config.dataDir, 'uploads');
export const CREATIVE_DIR = path.join(config.dataDir, 'creatives');
for (const d of [config.dataDir, UPLOAD_DIR, CREATIVE_DIR]) fs.mkdirSync(d, { recursive: true });

const EMPTY = { users: {}, brands: {}, strategies: {}, batches: {}, creatives: {}, ledger: [], settings: {} };

let db;
try {
  db = { ...EMPTY, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
} catch {
  db = structuredClone(EMPTY);
}

let timer = null;
function flush() {
  timer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
export function save() {
  if (!timer) timer = setTimeout(flush, 150);
}
export function saveNow() {
  if (timer) clearTimeout(timer);
  flush();
}
process.on('exit', () => { if (timer) flush(); });

export const id = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
export const now = () => new Date().toISOString();

function collection(name) {
  return {
    get: (k) => db[name][k] || null,
    all: (pred = () => true) => Object.values(db[name]).filter(pred),
    insert(obj) {
      db[name][obj.id] = { createdAt: now(), updatedAt: now(), ...obj };
      save();
      return db[name][obj.id];
    },
    update(k, patch) {
      const cur = db[name][k];
      if (!cur) return null;
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      db[name][k] = { ...next, updatedAt: now() };
      save();
      return db[name][k];
    },
    remove(k) { delete db[name][k]; save(); },
  };
}

export const Users = collection('users');
export const Brands = collection('brands');
export const Strategies = collection('strategies');
export const Batches = collection('batches');
export const Creatives = collection('creatives');

export const Ledger = {
  add(entry) { db.ledger.push({ id: id('led'), at: now(), ...entry }); save(); },
  forUser: (userId) => db.ledger.filter((l) => l.userId === userId),
};

export const Settings = {
  get: () => db.settings,
  set(patch) { db.settings = { ...db.settings, ...patch }; save(); return db.settings; },
};

// On boot, jobs that were mid-flight when the server stopped become failed so they can be retried.
for (const c of Object.values(db.creatives)) {
  if (['queued', 'generating', 'reviewing'].includes(c.status)) {
    c.status = 'failed';
    c.error = 'Sunucu yeniden başlatıldığı için iş yarıda kaldı. Yeniden üret.';
  }
}
