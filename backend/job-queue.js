// Cola persistente de vídeos: cada trabajo es un archivo cola/<id>.json en el repositorio
// de la biblioteca (sin claves ni sesiones, el repositorio puede ser público).
// El servidor procesa los trabajos de uno en uno, reintenta los fallos temporales de Gemini
// y publica el vídeo, su fila del Índice y el estado del trabajo en un único commit.

const lib = require('./library-format');

const QUEUE_DIR = 'cola';
const JOB_ID_RE = /^\d{8}-\d{6}-[a-z0-9]{6}$/;
const RETRY_DELAYS_S = [30, 120, 300];
const STALE_PENDING_MS = 2 * 60 * 1000;

const jobPath = (id) => `${QUEUE_DIR}/${id}.json`;
const serialize = (job) => `${JSON.stringify(job, null, 2)}\n`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isTemporary = (error) => /\b(429|500|502|503|504)\b|unavailable|overloaded|resource_exhausted|rate limit|try again|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i
  .test(`${error?.status || ''} ${error?.message || ''} ${JSON.stringify(error || {})}`);

const retryAfterSeconds = (error) => {
  const match = `${error?.message || ''} ${JSON.stringify(error || {})}`.match(/retry\s+in\s+([0-9.]+)s|retryDelay"\s*:\s*"?([0-9.]+)s/i);
  return match ? Math.ceil(Number(match[1] || match[2])) : null;
};

const newJob = ({ id, url, now = new Date() }) => ({
  id, url, status: 'pendiente', createdAt: now.toISOString(), updatedAt: now.toISOString(), attempts: 0, error: null, result: null
});

const uniquePath = async (read, folder, baseName) => {
  for (let n = 1; n < 50; n++) {
    const name = n === 1 ? `${baseName}.md` : `${baseName} (${n}).md`;
    if (!(await read(`${folder}/${name}`))) return { folder, name, path: `${folder}/${name}` };
  }
  throw new Error('No se ha encontrado un nombre de archivo libre.');
};

// Decide carpeta y contenido, y devuelve la lista de archivos del commit.
const buildPublication = async ({ job, raw, formatted, platform, model, read }) => {
  const date = new Date(job.createdAt);
  const day = lib.madridDate(date);
  const title = lib.safeTitle(formatted?.title || 'Vídeo sin título');
  const body = [formatted?.narration, ...(formatted?.onScreen || [])].join('\n');
  const allText = [formatted?.title, formatted?.summary, ...(formatted?.ideas || []), body].join('\n');
  const check = formatted ? lib.verifyCleanText(raw, allText, body) : { ok: false, missing: [], warnings: [], ratio: 0 };
  const topic = lib.TOPICS.includes(formatted?.topic) ? formatted.topic : null;
  const review = !check.ok || !topic;

  const extraNotes = [`Procesado por AETERNA en segundo plano con ${model || 'Gemini'}.`];
  if (check.warnings.length) extraNotes.push(`Rótulos en mayúsculas no encontrados en el texto limpio: ${check.warnings.slice(0, 15).join(', ')}.`);
  if (!topic) extraNotes.push('Tema dudoso: revisar y mover a su carpeta.');
  if (!check.ok) {
    extraNotes.push(check.missing.length
      ? `El texto limpio no conserva estas fichas del original: ${check.missing.slice(0, 20).join(', ')}. Revisar con el texto original de abajo.`
      : `El texto limpio es demasiado corto (${Math.round(check.ratio * 100)} % de las palabras). Revisar con el texto original de abajo.`);
  }

  const markdown = lib.buildLibraryMarkdown({
    title, date, platform, url: job.url,
    summary: formatted?.summary, ideas: formatted?.ideas, narration: formatted?.narration,
    onScreen: formatted?.onScreen, tags: formatted?.tags, quality: formatted?.quality,
    doubtfulTerms: formatted?.doubtfulTerms, extraNotes,
    originalText: review ? lib.stripMarks(raw).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : null
  });

  const folder = review ? `transcripts/${day.year}/${day.month}` : topic;
  const target = await uniquePath(read, folder, `${day.iso} · ${title}`);
  const files = [{ path: target.path, content: markdown }];

  if (!review) {
    const indexPath = `${topic}/Índice.md`;
    const index = await read(indexPath);
    files.push({ path: indexPath, content: lib.insertIndexRow(index?.content || `# ${topic}\n\n0 vídeos, del más reciente al más antiguo.\n`, { date, title, fileName: target.name, platform }) });
    const readme = await read('README.md');
    const bumped = lib.bumpReadmeCounts(readme?.content, topic);
    if (bumped) files.push({ path: 'README.md', content: bumped });
  }
  return { files, path: target.path, title, topic: review ? null : topic, review, missing: check.missing };
};

const createJobQueue = ({ log = console } = {}) => {
  const chains = new Map();   // repositorio -> promesa del último trabajo
  const active = new Map();   // id -> estado en memoria

  const processJob = async (job, ctx) => {
    let lastError;
    let transcript = null;
    let formatted;
    for (let attempt = 0; attempt <= RETRY_DELAYS_S.length; attempt++) {
      active.set(job.id, { status: 'procesando', attempts: job.attempts + attempt + 1 });
      try {
        if (!transcript) transcript = await ctx.transcribe(job.url);
        if (formatted === undefined) formatted = await ctx.format(transcript.transcription, { url: job.url, platform: transcript.platform })
          .catch(error => { log.warn?.('No se pudo dar formato; queda para revisión:', error.message); return null; });
        let published;
        await ctx.store.commitFiles(async (read) => {
          published = await buildPublication({ job, raw: transcript.transcription, formatted, platform: transcript.platform, model: transcript.model, read });
          const done = {
            ...job, status: 'hecho', attempts: job.attempts + attempt + 1, updatedAt: new Date().toISOString(), error: null,
            result: { path: published.path, url: ctx.store.htmlUrl(published.path), title: published.title, topic: published.topic, review: published.review }
          };
          return [...published.files, { path: jobPath(job.id), content: serialize(done) }];
        }, `AETERNA: añadir vídeo ${job.id}`);
        active.delete(job.id);
        return;
      } catch (error) {
        lastError = error;
        if (!isTemporary(error) || attempt === RETRY_DELAYS_S.length) break;
        const wait = Math.min(Math.max(retryAfterSeconds(error) || 0, RETRY_DELAYS_S[attempt]), 600);
        active.set(job.id, { status: 'procesando', attempts: job.attempts + attempt + 1, retryAt: new Date(Date.now() + wait * 1000).toISOString(), note: 'Gemini ocupado; reintento automático.' });
        await (ctx.sleep || sleep)(wait * 1000);
      }
    }
    log.error?.('Trabajo fallido', job.id, lastError?.message);
    const failed = {
      ...job, status: 'error', attempts: job.attempts + RETRY_DELAYS_S.length + 1, updatedAt: new Date().toISOString(),
      error: String(ctx.publicError ? ctx.publicError(lastError) : lastError?.message || 'Error desconocido').slice(0, 300)
    };
    try { await ctx.store.putFile(jobPath(job.id), serialize(failed), `AETERNA: error en ${job.id}`); } catch (error) { log.error?.('No se pudo guardar el error del trabajo', error.message); }
    active.delete(job.id);
  };

  // Encola respetando el orden; nunca procesa dos veces el mismo trabajo a la vez.
  const enqueue = (job, ctx) => {
    if (active.has(job.id)) return false;
    active.set(job.id, { status: 'pendiente' });
    const key = ctx.key || 'default';
    const next = (chains.get(key) || Promise.resolve()).then(() => processJob(job, ctx)).catch(error => log.error?.(error));
    chains.set(key, next);
    next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
    return true;
  };

  const overlay = (job) => (active.has(job.id) ? { ...job, ...active.get(job.id) } : job);
  const shouldResume = (job, now = Date.now()) => job.status === 'pendiente' && !active.has(job.id) && now - Date.parse(job.updatedAt || job.createdAt) > STALE_PENDING_MS;

  return { enqueue, overlay, shouldResume, isActive: (id) => active.has(id), _processJob: processJob };
};

module.exports = { QUEUE_DIR, JOB_ID_RE, jobPath, serialize, newJob, buildPublication, createJobQueue, isTemporary };
