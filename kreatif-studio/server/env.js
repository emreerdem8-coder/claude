// Minimal .env loader (no dependency). Existing process.env values win.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function load(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
load(path.join(ROOT, '.env'));

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 4747),
  openaiKey: process.env.OPENAI_API_KEY || '',
  ideogramKey: process.env.IDEOGRAM_API_KEY || '',
  imageConcurrency: Math.max(1, num(process.env.IMAGE_CONCURRENCY, 2)),
  creditsUnlimited: (process.env.CREDITS_UNLIMITED ?? 'true') !== 'false',
  startingCredits: num(process.env.STARTING_CREDITS, 500),
  // Defaults; the settings page can override these (stored in db.settings).
  defaults: {
    textModel: process.env.OPENAI_TEXT_MODEL || 'gpt-5.1',
    visionModel: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_TEXT_MODEL || 'gpt-5.1',
    imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT ?? 'medium',
    inputFidelity: process.env.OPENAI_INPUT_FIDELITY ?? 'high',
    imageQuality: 'high',
    qaMinScore: num(process.env.QA_MIN_SCORE, 9),
    qaAutoRetry: num(process.env.QA_AUTO_RETRY, 2),
    defaultProvider: 'openai',
  },
  dataDir: path.join(ROOT, 'data'),
  promptsDir: path.join(ROOT, 'prompts'),
};
