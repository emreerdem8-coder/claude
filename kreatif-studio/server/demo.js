// Demo mode: the full app with a mocked OpenAI (no key, no cost) and a separate data folder.
// Lets you click through the whole flow before connecting a real key: `npm run demo`
import path from 'node:path';
process.env.MOCK_AI = '1';
process.env.OPENAI_API_KEY = 'sk-mock';
const { config, ROOT } = await import('./env.js');
config.openaiKey = 'sk-mock';
config.dataDir = path.join(ROOT, 'data-demo');
console.log('  DEMO MODU: yapay zekâ yanıtları sahte, görseller renkli yer tutucudur.');
await import('./index.js');
