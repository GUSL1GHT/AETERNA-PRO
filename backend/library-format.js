// Formato legible de la biblioteca AETERNA-TRANSCRIPTS: una carpeta por tema,
// un archivo «AAAA-MM-DD · Título.md» por vídeo y una fila en el Índice.md del tema.

const TOPICS = [
  'Skills y Claude Code',
  'Memoria, contexto y prompts',
  'IA gratis y alternativas',
  'Asistentes tipo Jarvis',
  'Repositorios de GitHub',
  'Ingeniería inversa',
  'Vídeo y apps web',
  'Windows y seguridad'
];

const TOPIC_HINTS = {
  'Skills y Claude Code': 'skills (SKILL.md), plugins, mods, MCP y kits para Claude Code, Codex o ChatGPT; flujos de programación con agentes',
  'Memoria, contexto y prompts': 'memoria persistente, context rot, ahorro de tokens, mapas o grafos de código, prompts de rol, enrutado a modelos baratos',
  'IA gratis y alternativas': 'modelos gratis o locales (Ollama), enrutadores de modelos, alternativas libres para imagen, vídeo, voz o reuniones',
  'Asistentes tipo Jarvis': 'asistentes personales con IA, voz, rutinas, servidores 24/7, Jarvis',
  'Repositorios de GitHub': 'recopilatorios de proyectos open source útiles de GitHub',
  'Ingeniería inversa': 'analizar o recrear aplicaciones existentes con IA (REA, ClonaKit, GitReverse)',
  'Vídeo y apps web': 'generar o editar vídeo con código (Remotion) y publicar apps web hechas con IA',
  'Windows y seguridad': 'optimizar Windows y proteger cuentas'
};

const MIN_WORD_RATIO = 0.45;

const clean = (value) => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const oneLine = (value) => clean(value).replace(/\s+/g, ' ');

// Fecha y hora en Madrid, que es la de la biblioteca.
const madridDate = (date = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, display: `${parts.day}/${parts.month}/${parts.year}`, year: parts.year, month: parts.month };
};

// Quita marcas de tiempo, contadores «Imagen N» y «N / N» antes de comparar.
const stripMarks = (text) => clean(text)
  .replace(/\[\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*\]/g, ' ')
  .replace(/^\s*Imagen\s+\d+\s*[:.\-–]?\s*$/gim, ' ')
  .replace(/\bImagen\s+\d+\s*[:.\-–]?/gi, ' ')
  .replace(/(^|\s)\d{1,3}\s*\/\s*\d{1,3}(?=\s|$)/g, ' ');

const URL_RE = /https?:\/\/[^\s)\]>"'`«»]+/gi;
const trimUrl = (url) => url.replace(/[.,;:!?]+$/, '');

// Fichas que no pueden perderse al limpiar el texto.
const extractTokens = (text) => {
  const source = stripMarks(text);
  const required = new Set();
  const warnings = new Set();
  const urls = (source.match(URL_RE) || []).map(trimUrl);
  urls.forEach(url => required.add(url));
  const rest = source.replace(URL_RE, ' ');
  for (const match of rest.match(/\b[\w.-]*[A-Za-z][\w.-]*\/[\w.-]*[A-Za-z][\w.-]*/g) || []) required.add(match.replace(/[.,]+$/, ''));
  for (const match of rest.match(/\d+(?:[.,]\d+)*/g) || []) required.add(match);
  for (const match of rest.match(/\b[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*\b/g) || []) required.add(match);
  for (const match of rest.match(/\b[A-ZÁÉÍÓÚÑ0-9]*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]*\b/g) || []) {
    if (match.length < 2 || /^\d+$/.test(match)) continue;
    // Palabras solo en mayúsculas (rótulos o siglas): si faltan es un aviso, no un fallo.
    if (/\d/.test(match)) required.add(match);
    else warnings.add(match);
  }
  return { required: [...required], warnings: [...warnings] };
};

const wordCount = (text) => (stripMarks(text).match(/[\p{L}\p{N}]+/gu) || []).length;

// Comprueba que la versión limpia conserva nombres, cifras y enlaces del bruto.
const verifyCleanText = (raw, cleaned, cleanedBody = cleaned) => {
  const haystack = clean(cleaned).toLowerCase();
  const { required, warnings } = extractTokens(raw);
  const missing = required.filter(token => !haystack.includes(token.toLowerCase()));
  const missingWarnings = warnings.filter(token => !haystack.includes(token.toLowerCase()));
  const rawWords = wordCount(raw);
  const ratio = rawWords ? wordCount(cleanedBody) / rawWords : 1;
  return { ok: !missing.length && ratio >= MIN_WORD_RATIO, missing, warnings: missingWarnings, ratio };
};

// Nombre de archivo válido en Windows y GitHub.
const safeTitle = (title) => {
  const value = oneLine(title)
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 110)
    .trim();
  return value || 'Vídeo sin título';
};

const encodeLink = (fileName) => encodeURIComponent(fileName).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const bulletList = (items, fallback) => {
  const list = (Array.isArray(items) ? items : []).map(oneLine).filter(Boolean);
  return list.length ? list.map(item => `- ${item}`).join('\n') : fallback;
};

const buildLibraryMarkdown = (entry) => {
  const date = madridDate(entry.date);
  const doubtful = (Array.isArray(entry.doubtfulTerms) ? entry.doubtfulTerms : [])
    .map(item => ({ term: oneLine(item?.term), suggestion: oneLine(item?.suggestion), reason: oneLine(item?.reason) }))
    .filter(item => item.term);
  const notes = [
    `- Etiquetas: ${(Array.isArray(entry.tags) && entry.tags.length ? entry.tags.map(oneLine).filter(Boolean) : ['aeterna']).join(', ')}`,
    `- Calidad de la transcripción automática: ${oneLine(entry.quality) || 'media'}`,
    ...(entry.extraNotes || []).map(note => `- ${oneLine(note)}`)
  ];
  const doubtfulText = doubtful.length
    ? `\n\nPosibles errores de transcripción:\n\n${doubtful.map(item => `- "${item.term}"${item.suggestion ? ` → posible: "${item.suggestion}"` : ''}${item.reason ? `. Motivo: ${item.reason}` : ''}`).join('\n')}`
    : '';
  const narration = clean(entry.narration) || 'El vídeo no tiene narración.';
  return `# ${oneLine(entry.title)}

${date.display} · ${oneLine(entry.platform) || 'Web'} · [Ver el vídeo](${oneLine(entry.url)})

## De qué va

${oneLine(entry.summary) || 'Pendiente de revisar.'}

## Ideas

${bulletList(entry.ideas, '- Revisar el vídeo antes de aplicarlo.')}

## Lo que dice el vídeo

${narration}

## En pantalla

${bulletList(entry.onScreen, 'Nada aparte de lo que se dice.')}

## Notas

${notes.join('\n')}${doubtfulText}
${entry.originalText ? `\n## Texto original\n\n${clean(entry.originalText)}\n` : ''}`;
};

const escapeCell = (value) => oneLine(value).replace(/\|/g, '\\|');

// Añade la fila arriba de la tabla (del más reciente al más antiguo) y actualiza el contador.
const insertIndexRow = (indexText, { date, title, fileName, platform }) => {
  const display = madridDate(date).display;
  const row = `| ${display} | [${escapeCell(title)}](${encodeLink(fileName)}) | ${escapeCell(platform) || 'Web'} |`;
  const lines = clean(indexText).split('\n');
  const separator = lines.findIndex(line => /^\|\s*-{3,}/.test(line));
  if (separator === -1) {
    lines.push('', '| Fecha | Vídeo | Plataforma |', '| --- | --- | --- |', row);
  } else {
    lines.splice(separator + 1, 0, row);
  }
  const rows = lines.filter(line => /^\|\s*\d{2}\/\d{2}\/\d{4}\s*\|/.test(line)).length;
  const counter = `${rows} ${rows === 1 ? 'vídeo' : 'vídeos'}, del más reciente al más antiguo.`;
  const counterIndex = lines.findIndex(line => /^\d+ vídeos?, del más reciente al más antiguo\.$/.test(line));
  if (counterIndex !== -1) lines[counterIndex] = counter;
  return `${lines.join('\n')}\n`;
};

// Suma uno al total y al tema en el README de la biblioteca; si no reconoce el formato, lo deja igual.
const bumpReadmeCounts = (readme, topic) => {
  if (!readme) return null;
  let changed = readme.replace(/(organizada por temas: )(\d+)( vídeos)/, (_, a, n, b) => `${a}${Number(n) + 1}${b}`);
  const link = `[${topic}](${encodeURIComponent(topic).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}/`;
  changed = changed.split('\n').map(line => {
    if (!line.startsWith(`| ${link}`) && !line.startsWith(`| [${topic}](`)) return line;
    return line.replace(/^(\|[^|]+\|\s*)(\d+)(\s*\|)/, (_, a, n, b) => `${a}${Number(n) + 1}${b}`);
  }).join('\n');
  return changed === readme ? null : changed;
};

module.exports = {
  TOPICS, TOPIC_HINTS, MIN_WORD_RATIO, madridDate, stripMarks, extractTokens, verifyCleanText,
  safeTitle, encodeLink, buildLibraryMarkdown, insertIndexRow, bumpReadmeCounts
};
