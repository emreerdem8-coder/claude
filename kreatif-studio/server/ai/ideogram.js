import { config } from '../env.js';
import { AIError } from './openai.js';

const URL_V3 = 'https://api.ideogram.ai/v1/ideogram-v3/generate';
const ASPECT = { '1:1': '1x1', '4:5': '4x5', '9:16': '9x16' };

export const ideogramEnabled = () => !!config.ideogramKey;

/** Returns a Buffer. Ideogram is strong at on-image typography; product fidelity comes from style refs only. */
export async function generateImage({ prompt, aspect = '4:5', negative, styleRefs = [] }) {
  if (!config.ideogramKey) throw new AIError('IDEOGRAM_API_KEY tanımlı değil.', 400);
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', ASPECT[aspect] || '4x5');
  form.append('rendering_speed', 'QUALITY');
  form.append('magic_prompt', 'OFF');
  form.append('num_images', '1');
  if (negative) form.append('negative_prompt', negative);
  for (const r of styleRefs.slice(0, 3)) form.append('style_reference_images', new Blob([r.buffer], { type: r.mime }), r.name);

  const res = await fetch(URL_V3, { method: 'POST', headers: { 'Api-Key': config.ideogramKey }, body: form });
  if (!res.ok) throw new AIError(`Ideogram ${res.status}: ${await res.text()}`, res.status);
  const json = await res.json();
  const url = json.data?.[0]?.url;
  if (!url) throw new AIError('Ideogram görsel döndürmedi (güvenlik filtresi olabilir).');
  const img = await fetch(url);
  if (!img.ok) throw new AIError('Ideogram görseli indirilemedi.');
  return Buffer.from(await img.arrayBuffer());
}
