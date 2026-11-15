const test = require('node:test');
const assert = require('node:assert');
const { createJobQueue, newJob, jobPath } = require('./job-queue');

// Repositorio simulado en memoria: no toca GitHub.
const memoryStore = (initial = {}) => {
  const files = new Map(Object.entries(initial));
  let commits = 0;
  return {
    files,
    get commits() { return commits; },
    getFile: async (p) => (files.has(p) ? { sha: 'x', content: files.get(p) } : null),
    putFile: async (p, c) => { files.set(p, c); commits++; },
    commitFiles: async (build) => {
      const list = await build(async (p) => (files.has(p) ? { sha: 'x', content: files.get(p) } : null));
      list.forEach(f => files.set(f.path, f.content));
      commits++;
    },
    htmlUrl: (p) => `https://github.com/o/r/blob/main/${p}`
  };
};

const RAW = '[00:01] Hoy os enseño GitHub y 3 trucos con MCP para programar mejor cada día. Mirad https://github.com/HKUDS/CLI-Anything que tiene 51,3k estrellas.';
const GOOD = {
  title: 'Tres trucos con MCP', topic: 'Skills y Claude Code', summary: 'Trucos para programar con MCP y GitHub.',
  ideas: ['Probar CLI-Anything'], narration: 'Hoy os enseño GitHub y 3 trucos con MCP para programar mejor cada día. Mirad https://github.com/HKUDS/CLI-Anything que tiene 51,3k estrellas.',
  onScreen: [], tags: ['mcp'], quality: 'alta', doubtfulTerms: []
};
const INDEX = '# Skills y Claude Code\n\nDesc.\n\n1 vídeo, del más reciente al más antiguo.\n\n| Fecha | Vídeo | Plataforma |\n| --- | --- | --- |\n| 14/11/2026 | [A](a.md) | TikTok |\n';

const run = async (store, ctxExtra) => {
  const queue = createJobQueue({ log: { warn() {}, error() {} } });
  const job = newJob({ id: '20261115-120000-abc123', url: 'https://www.tiktok.com/@x/video/1', now: new Date('2026-11-15T12:00:00Z') });
  store.files.set(jobPath(job.id), JSON.stringify(job));
  await queue._processJob(job, { store, sleep: async () => {}, ...ctxExtra });
  return JSON.parse(store.files.get(jobPath(job.id)));
};

test('publica en la carpeta del tema con su fila del índice y un solo commit', async () => {
  const store = memoryStore({ 'Skills y Claude Code/Índice.md': INDEX, 'README.md': 'organizada por temas: 73 vídeos.\n' });
  const job = await run(store, { transcribe: async () => ({ transcription: RAW, platform: 'TikTok', model: 'm' }), format: async () => GOOD });
  assert.strictEqual(job.status, 'hecho');
  assert.strictEqual(job.result.path, 'Skills y Claude Code/2026-11-15 · Tres trucos con MCP.md');
  assert.strictEqual(job.result.review, false);
  assert.ok(store.files.get('Skills y Claude Code/Índice.md').includes('2 vídeos'));
  assert.ok(store.files.get('README.md').includes('74 vídeos'));
  assert.strictEqual(store.commits, 1);
  const md = store.files.get(job.result.path);
  assert.ok(md.startsWith('# Tres trucos con MCP\n\n15/11/2026 · TikTok · [Ver el vídeo](https://www.tiktok.com/@x/video/1)'));
  assert.ok(!md.includes('## Texto original'));
});

test('si el texto limpio pierde datos, va a transcripts/ para revisión con el original', async () => {
  const store = memoryStore({ 'Skills y Claude Code/Índice.md': INDEX });
  const job = await run(store, { transcribe: async () => ({ transcription: RAW, platform: 'TikTok' }), format: async () => ({ ...GOOD, narration: 'Trucos con MCP y GitHub.' }) });
  assert.strictEqual(job.status, 'hecho');
  assert.ok(job.result.review);
  assert.ok(job.result.path.startsWith('transcripts/2026/11/2026-11-15 · '));
  assert.ok(store.files.get(job.result.path).includes('## Texto original'));
  assert.strictEqual(store.files.get('Skills y Claude Code/Índice.md'), INDEX);
});

test('tema dudoso va a transcripts/', async () => {
  const store = memoryStore();
  const job = await run(store, { transcribe: async () => ({ transcription: RAW, platform: 'TikTok' }), format: async () => ({ ...GOOD, topic: 'dudoso' }) });
  assert.ok(job.result.review && job.result.path.startsWith('transcripts/'));
});

test('reintenta errores temporales de Gemini y luego termina', async () => {
  const store = memoryStore({ 'Skills y Claude Code/Índice.md': INDEX });
  let calls = 0;
  const job = await run(store, {
    transcribe: async () => { calls++; if (calls < 3) throw new Error('503 UNAVAILABLE overloaded'); return { transcription: RAW, platform: 'TikTok' }; },
    format: async () => GOOD
  });
  assert.strictEqual(calls, 3);
  assert.strictEqual(job.status, 'hecho');
});

test('un error definitivo queda guardado como error, sin reintentos', async () => {
  const store = memoryStore();
  let calls = 0;
  const job = await run(store, { transcribe: async () => { calls++; throw new Error('Vídeo privado'); }, format: async () => GOOD });
  assert.strictEqual(calls, 1);
  assert.strictEqual(job.status, 'error');
  assert.match(job.error, /Vídeo privado/);
});
