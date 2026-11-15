const test = require('node:test');
const assert = require('node:assert');
const f = require('./library-format');

test('quita marcas de tiempo y contadores', () => {
  const out = f.stripMarks('[00:12] Hola\nImagen 3\n2 / 8 texto [1:02:03] fin');
  assert.ok(!/\d{2}:\d{2}/.test(out));
  assert.ok(!/Imagen 3/.test(out));
  assert.ok(!/2 \/ 8/.test(out));
});

test('extrae URLs, repos, cifras y siglas; rótulos como aviso', () => {
  const { required, warnings } = f.extractTokens('[00:01] Mira https://github.com/HKUDS/CLI-Anything. Usa librepods-org/librepods, 30,2k estrellas, MCP y GitHub. Precio 10.49/mo. CONSEJO');
  for (const t of ['https://github.com/HKUDS/CLI-Anything', 'librepods-org/librepods', '30,2', 'GitHub', '10.49']) assert.ok(required.includes(t), t);
  assert.ok(!required.some(t => t.startsWith('10.49/')));
  assert.ok(warnings.includes('CONSEJO') && warnings.includes('MCP'));
  assert.ok(!required.includes('00'));
});

test('verificación: aprueba texto fiel y rechaza resumen o pérdida de cifras', () => {
  const raw = '[00:01] Hoy os enseño GitHub y 3 trucos con MCP para programar mejor cada día con vuestra inteligencia artificial favorita.';
  assert.ok(f.verifyCleanText(raw, 'Hoy os enseño GitHub y 3 trucos con MCP para programar mejor cada día con vuestra inteligencia artificial favorita.').ok);
  const lost = f.verifyCleanText(raw, 'Hoy os enseño GitHub y trucos con MCP para programar mejor cada día con vuestra inteligencia artificial favorita.');
  assert.ok(!lost.ok && lost.missing.includes('3'));
  const short = f.verifyCleanText(raw, 'GitHub, 3, MCP.');
  assert.ok(!short.ok && short.ratio < f.MIN_WORD_RATIO);
});

test('título seguro para archivo', () => {
  assert.strictEqual(f.safeTitle('Mejora tus apps: 5 herramientas / clave?'), 'Mejora tus apps 5 herramientas clave');
  assert.strictEqual(f.safeTitle('  '), 'Vídeo sin título');
});

test('markdown con el orden de secciones de la biblioteca', () => {
  const md = f.buildLibraryMarkdown({
    title: 'Prueba', date: new Date('2026-11-15T10:00:00Z'), platform: 'TikTok', url: 'https://tiktok.com/x',
    summary: 'Resumen.', ideas: ['Idea 1'], narration: 'Párrafo uno.\n\nPárrafo dos.', onScreen: [], tags: ['ia'], quality: 'alta'
  });
  const order = ['# Prueba', '15/11/2026 · TikTok · [Ver el vídeo](https://tiktok.com/x)', '## De qué va', '## Ideas', '## Lo que dice el vídeo', '## En pantalla', '## Notas'];
  let last = -1;
  for (const part of order) { const i = md.indexOf(part); assert.ok(i > last, part); last = i; }
  assert.ok(md.includes('Nada aparte de lo que se dice.'));
});

test('índice: fila arriba, enlace codificado y contador', () => {
  const index = '# Tema\n\nDescripción.\n\n2 vídeos, del más reciente al más antiguo.\n\n| Fecha | Vídeo | Plataforma |\n| --- | --- | --- |\n| 14/11/2026 | [A](a.md) | TikTok |\n| 13/11/2026 | [B](b.md) | YouTube |\n';
  const out = f.insertIndexRow(index, { date: new Date('2026-11-15T10:00:00Z'), title: "Las 15 'skills'", fileName: "2026-11-15 · Las 15 'skills'.md", platform: 'TikTok' });
  const lines = out.split('\n');
  assert.ok(lines.includes('3 vídeos, del más reciente al más antiguo.'));
  const sep = lines.findIndex(l => l.startsWith('| ---'));
  assert.strictEqual(lines[sep + 1], "| 15/11/2026 | [Las 15 'skills'](2026-11-15%20%C2%B7%20Las%2015%20%27skills%27.md) | TikTok |");
});

test('README: suma uno al total y al tema', () => {
  const readme = 'organizada por temas: 73 vídeos.\n\n| [Skills y Claude Code](Skills%20y%20Claude%20Code/%C3%8Dndice.md) | 23 | Texto |\n| [Ingeniería inversa](Ingenier%C3%ADa%20inversa/%C3%8Dndice.md) | 6 | Texto |';
  const out = f.bumpReadmeCounts(readme, 'Ingeniería inversa');
  assert.ok(out.includes('74 vídeos'));
  assert.ok(out.includes('| 7 |'));
  assert.ok(out.includes('| 23 |'));
});
