const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const ytdlp = require('yt-dlp-exec');
const { GoogleGenAI, createUserContent, createPartFromUri } = require('@google/genai');
const { sealSession, openSession } = require('./session-seal');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use((req, res, next) => { res.set('Access-Control-Expose-Headers', 'X-Aeterna-Github-Session'); next(); });
app.use(express.json({ limit: '2mb' }));

const geminiSessions = new Map();
const GEMINI_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTENT_SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const OWNER_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const USER_GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const geminiSessionFromRequest = (req) => {
  const sessionId = req.get('X-Aeterna-Gemini-Session') || '';
  const persistent = openSession(sessionId, 'gemini');
  if (persistent) return { ...persistent, lastUsed: Date.now() };
  if (!/^[a-f0-9]{64}$/.test(sessionId)) return null;
  const session = geminiSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.lastUsed > GEMINI_SESSION_MS) {
    geminiSessions.delete(sessionId);
    return null;
  }
  session.lastUsed = Date.now();
  return session;
};
const requireGeminiSession = async (req, res, next) => {
  const session = geminiSessionFromRequest(req);
  if (session) {
    req.geminiAi = new GoogleGenAI({ apiKey: session.apiKey });
    req.geminiModels = session.models;
    return next();
  }
  try {
    const githubSessionId = req.get('X-Aeterna-Github-Session') || '';
    if (githubSessionId && process.env.GEMINI_API_KEY) {
      const githubSession = await sessionFromId(githubSessionId);
      if (githubSession?.login?.toLowerCase() === 'gusl1ght') {
        if (githubSession.renewedSessionId) res.set('X-Aeterna-Github-Session', githubSession.renewedSessionId);
        req.geminiAi = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        req.geminiModels = OWNER_GEMINI_MODELS;
        return next();
      }
    }
    res.status(401).json({ success: false, error: 'Conecta Gemini para transcribir.' });
  } catch (_) {
    res.status(401).json({ success: false, error: 'Conecta Gemini para transcribir.' });
  }
};

app.post('/api/gemini-auth/connect', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const apiKey = String(req.body?.apiKey || '').trim();
  if (!apiKey || apiKey.length > 256 || /\s/.test(apiKey)) {
    return res.status(400).json({ error: 'Introduce una clave de Gemini válida.' });
  }
  try {
    const check = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(10000)
    });
    if (!check.ok) {
      return res.status(400).json({ error: 'No se ha podido validar la clave de Gemini. Compruébala e inténtalo de nuevo.' });
    }
    const available = new Set((await check.json()).models?.filter(model => model.supportedGenerationMethods?.includes('generateContent')).map(model => model.name.replace(/^models\//, '')) || []);
    const models = USER_GEMINI_MODELS.filter(model => available.has(model));
    if (!models.length) return res.status(400).json({ error: 'Esta clave no tiene acceso a un modelo de Gemini compatible.' });
    for (const [id, session] of geminiSessions) {
      if (Date.now() - session.lastUsed > GEMINI_SESSION_MS) geminiSessions.delete(id);
    }
    if (geminiSessions.size >= 1000) geminiSessions.delete(geminiSessions.keys().next().value);
    const sessionId = sealSession('gemini', { apiKey, models }, PERSISTENT_SESSION_MS) || crypto.randomBytes(32).toString('hex');
    if (/^[a-f0-9]{64}$/.test(sessionId)) geminiSessions.set(sessionId, { apiKey, models, lastUsed: Date.now() });
    res.json({ connected: true, sessionId, model: models[0] });
  } catch (_) {
    res.status(502).json({ error: 'No se ha podido conectar con Gemini. Inténtalo de nuevo.' });
  }
});

app.get('/api/gemini-auth/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ connected: !!geminiSessionFromRequest(req) });
});

app.post('/api/gemini-auth/logout', (req, res) => {
  const sessionId = req.get('X-Aeterna-Gemini-Session') || '';
  if (/^[a-f0-9]{64}$/.test(sessionId)) geminiSessions.delete(sessionId);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true });
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const stringifyError = (error) => `${JSON.stringify(error || {})} ${String(error?.message || '')}`;

const isTemporaryGeminiError = (error) => {
  const text = stringifyError(error).toLowerCase();
  return text.includes('503') ||
    text.includes('unavailable') ||
    text.includes('overloaded') ||
    text.includes('try again later') ||
    text.includes('429') ||
    text.includes('resource_exhausted') ||
    text.includes('quota exceeded') ||
    text.includes('rate limit');
};

const isModelUnavailableError = (error) => {
  const text = stringifyError(error).toLowerCase();
  return text.includes('not found') || text.includes('not supported') || (text.includes('model') && text.includes('not'));
};

const extractRetrySeconds = (error) => {
  const text = stringifyError(error);
  const patterns = [
    /retry\s+in\s+([0-9]+(?:\.[0-9]+)?)s/i,
    /retryDelay"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)s/i,
    /retry_after"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Math.ceil(Number(match[1]));
  }

  return null;
};

const buildPublicGeminiError = (error) => {
  const text = stringifyError(error).toLowerCase();
  const retryAfterSeconds = extractRetrySeconds(error);

  if (text.includes('429') || text.includes('resource_exhausted') || text.includes('quota exceeded') || text.includes('rate limit')) {
    return {
      status: 429,
      retryAfterSeconds,
      message: retryAfterSeconds
        ? `Límite temporal de Gemini alcanzado. Espera ${retryAfterSeconds} segundos y vuelve a intentarlo.`
        : 'Límite temporal de Gemini alcanzado. Espera unos minutos y vuelve a intentarlo.'
    };
  }

  if (text.includes('503') || text.includes('unavailable') || text.includes('overloaded')) {
    return {
      status: 503,
      retryAfterSeconds,
      message: 'Gemini está saturado temporalmente. Espera un momento y vuelve a intentarlo.'
    };
  }

  if (text.includes('invalid_argument') || text.includes('unsupported mime')) {
    return { status: 400, retryAfterSeconds: null, message: 'Gemini no pudo procesar este vídeo. Comprueba que sea público o sube el archivo manualmente.' };
  }

  return {
    status: 500,
    retryAfterSeconds: null,
    message: error.message || 'Error interno del servidor.'
  };
};

const githubHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28'
});

const GITHUB_APP_INSTALL_URL = 'https://github.com/apps/aeterna-transcripts-connector/installations/new';
const githubSessions = new Map();
const githubAuthStates = new Map();
const githubAppConfigured = () => !!(process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET);
const githubCallbackUrl = () => `${process.env.PUBLIC_BACKEND_URL || 'https://aeterna-pro-backend.onrender.com'}/api/github-auth/callback`;
const githubFrontendUrl = () => process.env.PUBLIC_FRONTEND_URL || 'https://gusl1ght.github.io/AETERNA-PRO/';

const githubTokenRequest = async (params) => {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) throw new Error('GitHub no pudo completar la conexión. Vuelve a intentarlo.');
  return data;
};

const sessionFromId = async (sessionId) => {
  const session = openSession(sessionId, 'github') || (sessionId && githubSessions.get(sessionId));
  if (!session) return null;
  if (session.expiresAt && Date.now() > session.expiresAt - 60000) {
    if (!session.refreshToken || !githubAppConfigured()) {
      githubSessions.delete(sessionId);
      return null;
    }
    try {
      const refreshed = await githubTokenRequest({
        client_id: process.env.GITHUB_APP_CLIENT_ID,
        client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken
      });
      session.accessToken = refreshed.access_token;
      session.refreshToken = refreshed.refresh_token || null;
      session.expiresAt = refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : null;
      session.renewedSessionId = sealSession('github', {
        login: session.login, accessToken: session.accessToken,
        refreshToken: session.refreshToken, expiresAt: session.expiresAt
      }, PERSISTENT_SESSION_MS);
    } catch (_) {
      githubSessions.delete(sessionId);
      return null;
    }
  }
  return session;
};
const sessionFromRequest = async (req, res) => {
  const token = /^Bearer (.+)$/.exec(req.get('Authorization') || '')?.[1];
  const session = await sessionFromId(token);
  if (session?.renewedSessionId && res) res.set('X-Aeterna-Github-Session', session.renewedSessionId);
  return session;
};

const githubGet = async (path, token) => {
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(token) });
  if (!response.ok) throw new Error(`GitHub no pudo consultar los repositorios (${response.status}).`);
  return response.json();
};

const githubRepositories = async (session) => {
  const installations = [];
  for (let page = 1; page <= 10; page++) {
    const data = await githubGet(`/user/installations?per_page=100&page=${page}`, session.accessToken);
    installations.push(...(data.installations || []));
    if ((data.installations || []).length < 100) break;
  }
  const repositories = [];
  for (const installation of installations) {
    if (installation.permissions?.contents !== 'write') continue;
    for (let page = 1; page <= 10; page++) {
      const data = await githubGet(`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`, session.accessToken);
      repositories.push(...(data.repositories || []).filter(repo =>
        repo.owner?.login?.toLowerCase() === session.login.toLowerCase() &&
        (repo.permissions?.push || repo.permissions?.admin)
      ).map(repo => ({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch || 'main',
        private: !!repo.private
      })));
      if ((data.repositories || []).length < 100) break;
    }
  }
  return [...new Map(repositories.map(repo => [repo.fullName.toLowerCase(), repo])).values()]
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
};

const sanitizeSlug = (value) => {
  return String(value || 'transcripcion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'transcripcion';
};

const cleanText = (value) => String(value || '').replace(/\r\n/g, '\n').trim();

const normalizeKnownTerms = (value) => {
  return cleanText(value);
};

const isWeakTitle = (value) => {
  const text = cleanText(value).toLowerCase();
  if (!text) return true;

  return (
    text.includes('snaptik') ||
    text.includes('y2mate') ||
    text.includes('videoplayback') ||
    text.includes('download') ||
    text.includes('tiktok') ||
    /^\d+$/.test(text) ||
    text.length < 8
  );
};

const titleCaseSoft = (value) => {
  const text = cleanText(value)
    .replace(/\s+/g, ' ')
    .replace(/["“”]/g, '')
    .slice(0, 90)
    .trim();

  if (!text) return 'Transcripción AETERNA';
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const fallbackTitleFromTranscript = (transcription) => {
  const raw = normalizeKnownTerms(transcription);
  const text = raw.toLowerCase();

  if (text.includes('spacex') && (text.includes('nasdaq') || text.includes('índice') || text.includes('indices') || text.includes('mercado'))) {
    return 'SpaceX, Nasdaq y posible caída de mercado';
  }

  if (text.includes('semiconductores') && (text.includes('etf') || text.includes('nasdaq') || text.includes('caída'))) {
    return 'Riesgo de caída en semiconductores y Nasdaq';
  }

  if (text.includes('kirby') && text.includes('papelera')) {
    return 'Personalizar la papelera de Windows con Kirby';
  }

  if (text.includes('windhawk') || text.includes('windhook')) {
    return 'Cambiar el menú Inicio de Windows 11 con Windhawk';
  }

  if (text.includes('pinokio') || text.includes('pinocho') || text.includes('pinocchio') || text.includes('voicebox') || text.includes('elevenlabs')) {
    return 'Instalar herramientas de IA local con Pinokio';
  }

  if (text.includes('windows 11') && text.includes('menú')) {
    return 'Tutorial de personalización de Windows 11';
  }

  if (text.includes('discord')) {
    return 'Idea o tutorial relacionado con Discord';
  }

  if (text.includes('github')) {
    return 'Idea o tutorial relacionado con GitHub';
  }

  const firstSentence = raw
    .split(/[.!?\n]/)
    .map(part => cleanText(part))
    .find(part => part.length >= 20 && !isWeakTitle(part));

  if (firstSentence) return titleCaseSoft(firstSentence);

  return 'Transcripción AETERNA';
};

const parseJsonObject = (text) => {
  const raw = cleanText(text);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch (_) {
    return null;
  }
};

const buildFallbackTermAudit = (transcription) => {
  const text = cleanText(transcription);
  const lower = text.toLowerCase();
  const suspicious = [];

  const add = (seen, suggestion, reason) => {
    suspicious.push({ seen, suggestion, reason });
  };

  if (lower.includes('pinocho') || lower.includes('pinocchio') || lower.includes('pinoccio')) {
    add('Pinocho / Pinocchio', 'Pinokio', 'El contexto parece hablar de una herramienta de IA/software, no del personaje.');
  }

  if (lower.includes('windhook') || lower.includes('wind hook') || lower.includes('windhawk')) {
    add('Windhook / WindHawk', 'Windhawk', 'El contexto parece hablar de personalización de Windows.');
  }

  const genericNamePattern = /\b(app|programa|herramienta|web|ia|modelo|plugin|extensi[oó]n|repositorio|github|windows|python|terminal)\b/i;
  if (genericNamePattern.test(text) && suspicious.length === 0) {
    add('Nombres propios técnicos', 'Revisión manual', 'El contenido menciona software/herramientas; revisar posibles nombres propios antes de convertirlo en guía o tarea.');
  }

  return {
    technicalConfidence: suspicious.length ? 'media' : 'alta',
    doubtfulTerms: suspicious,
    note: suspicious.length
      ? 'Fuente útil, pero revisar nombres propios de herramientas antes de convertirla en guía o tarea.'
      : 'No se han detectado dudas técnicas evidentes automáticamente.'
  };
};

const generateKnowledgeMetadata = async ({ title, transcription }, ai, models = OWNER_GEMINI_MODELS) => {
  const normalizedTranscript = normalizeKnownTerms(transcription);
  const fallbackTitle = isWeakTitle(title) ? fallbackTitleFromTranscript(normalizedTranscript) : normalizeKnownTerms(title);
  const fallbackAudit = buildFallbackTermAudit(transcription);

  const fallback = {
    title: fallbackTitle,
    summary: 'Pendiente de revisar.',
    tags: ['aeterna', 'transcripcion'],
    ideas: ['Revisar la transcripción y decidir si se convierte en guía, mejora o tarea.'],
    technicalConfidence: fallbackAudit.technicalConfidence,
    doubtfulTerms: fallbackAudit.doubtfulTerms,
    technicalNote: fallbackAudit.note
  };

  try {
    const input = normalizedTranscript.slice(0, 6000);
    const response = await ai.models.generateContent({
      model: models.find(model => model.includes('flash-lite')) || models[0],
      contents: `Analiza esta transcripción y devuelve SOLO JSON válido con esta forma exacta:
{
  "title": "título útil y corto en español de España",
  "summary": "resumen de 1 frase",
  "tags": ["tag1", "tag2", "tag3"],
  "ideas": ["idea práctica 1", "idea práctica 2"],
  "technicalConfidence": "alta | media | baja",
  "doubtfulTerms": [
    { "seen": "término transcrito", "suggestion": "posible término correcto", "reason": "motivo breve" }
  ],
  "technicalNote": "nota breve sobre fiabilidad de nombres técnicos"
}

Reglas:
- El título debe describir lo que enseña o propone el vídeo.
- No uses nombres basura de archivo como snaptik, y2mate, videoplayback o números.
- Si no estás seguro de un nombre de programa, no inventes: añádelo a doubtfulTerms.
- Los tags deben ser simples, en minúsculas y útiles para buscar.
- Devuelve solo JSON.

Transcripción:
${input}`
    });

    const parsed = parseJsonObject(response.text || '');
    if (!parsed) return fallback;

    const generatedTitle = normalizeKnownTerms(parsed.title);
    const parsedDoubtfulTerms = Array.isArray(parsed.doubtfulTerms)
      ? parsed.doubtfulTerms.map((term) => ({
          seen: normalizeKnownTerms(term?.seen || ''),
          suggestion: normalizeKnownTerms(term?.suggestion || ''),
          reason: cleanText(term?.reason || '')
        })).filter(term => term.seen || term.suggestion || term.reason).slice(0, 10)
      : [];

    const mergedDoubtfulTerms = [...fallbackAudit.doubtfulTerms, ...parsedDoubtfulTerms]
      .filter((term, index, array) => array.findIndex(other => `${other.seen}|${term.suggestion}` === `${term.seen}|${term.suggestion}`) === index)
      .slice(0, 10);

    return {
      title: isWeakTitle(generatedTitle) ? fallback.title : generatedTitle,
      summary: normalizeKnownTerms(parsed.summary) || fallback.summary,
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.map(tag => sanitizeSlug(tag)).filter(Boolean).slice(0, 8) : fallback.tags,
      ideas: Array.isArray(parsed.ideas) && parsed.ideas.length ? parsed.ideas.map(normalizeKnownTerms).filter(Boolean).slice(0, 5) : fallback.ideas,
      technicalConfidence: cleanText(parsed.technicalConfidence) || fallback.technicalConfidence,
      doubtfulTerms: mergedDoubtfulTerms,
      technicalNote: normalizeKnownTerms(parsed.technicalNote) || fallback.technicalNote
    };
  } catch (_) {
    return fallback;
  }
};

const renderDoubtfulTerms = (terms) => {
  if (!Array.isArray(terms) || terms.length === 0) {
    return '- No se han detectado dudas técnicas evidentes automáticamente.';
  }

  return terms.map((term) => {
    const seen = cleanText(term.seen) || 'Término no especificado';
    const suggestion = cleanText(term.suggestion) || 'Revisar manualmente';
    const reason = cleanText(term.reason) || 'Posible nombre propio o herramienta técnica.';
    return `- "${seen}" → posible: "${suggestion}". Motivo: ${reason}`;
  }).join('\n');
};

const buildTranscriptMarkdown = ({ title, platform, project, transcription, model, fileName, sourceUrl, metadata }) => {
  const now = new Date().toISOString();
  const cleanTitle = normalizeKnownTerms(metadata?.title || title) || 'Transcripción AETERNA';
  const cleanPlatform = cleanText(platform) || 'No especificada';
  const cleanProject = cleanText(project) || 'Sin proyecto asignado';
  const cleanFileName = cleanText(fileName) || 'No especificado';
  const cleanModel = cleanText(model) || 'No especificado';
  const cleanSourceUrl = cleanText(sourceUrl) || 'No especificada';
  const cleanTranscript = normalizeKnownTerms(transcription);
  const cleanSummary = normalizeKnownTerms(metadata?.summary) || 'Pendiente de revisar.';
  const cleanTags = Array.isArray(metadata?.tags) && metadata.tags.length ? metadata.tags.join(', ') : 'aeterna, transcripcion';
  const cleanIdeas = Array.isArray(metadata?.ideas) && metadata.ideas.length
    ? metadata.ideas.map((idea) => `- ${normalizeKnownTerms(idea)}`).join('\n')
    : '- Revisar la transcripción y decidir si se convierte en guía, mejora o tarea.';
  const technicalConfidence = cleanText(metadata?.technicalConfidence) || 'media';
  const technicalNote = normalizeKnownTerms(metadata?.technicalNote) || 'Revisar nombres propios antes de convertir esta fuente en una guía o tarea.';
  const doubtfulTerms = renderDoubtfulTerms(metadata?.doubtfulTerms);

  return `# ${cleanTitle}

## Metadatos

- Fecha: ${now}
- Plataforma: ${cleanPlatform}
- Proyecto relacionado: ${cleanProject}
- Archivo original: ${cleanFileName}
- URL original: ${cleanSourceUrl}
- Modelo de transcripción: ${cleanModel}
- Estado: pendiente
- Confianza técnica: ${technicalConfidence}
- Etiquetas: ${cleanTags}

## Auditoría técnica de términos

${technicalNote}

### Términos dudosos detectados

${doubtfulTerms}

## Resumen automático

${cleanSummary}

## Ideas detectadas

${cleanIdeas}

## Uso previsto

Fuente capturada con AETERNA para revisión posterior, auditoría de ideas, generación de guías o posible conversión en tareas de proyecto.

## Transcripción literal

${cleanTranscript}
`;
};

const inferPlatformFromUrl = (url) => {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('tiktok.com')) return 'TikTok';
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'YouTube';
  if (lower.includes('instagram.com')) return 'Instagram';
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'X';
  return 'URL';
};

const inferMimeType = (filePath, audioOnly = false) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return audioOnly ? 'audio/webm' : 'video/webm';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
};

// Render can reuse an old bundled binary. A pinned official release avoids
// GitHub's unauthenticated API rate limit during service startup.
const EXTRACTOR_URL = 'https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/2026.10.10.233141/yt-dlp_linux';
const EXTRACTOR_SHA256 = '60606cef1a65d70f6639a85b45ebb7acf08dbb81831e134dd93939e23ca2b792';
let extractor = ytdlp;
let extractorStatus = 'preparando';
const extractorReady = (async () => {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    extractorStatus = 'extractor incluido en la instalación';
    return true;
  }
  const target = path.join(os.tmpdir(), 'aeterna-yt-dlp-2026.10.10');
  if (!fs.existsSync(target)) {
    const response = await fetch(EXTRACTOR_URL, { signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error(`Descarga HTTP ${response.status}`);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
      const digest = crypto.createHash('sha256').update(await fs.promises.readFile(temporary)).digest('hex');
      if (digest !== EXTRACTOR_SHA256) throw new Error('Hash del extractor incorrecto');
      await fs.promises.chmod(temporary, 0o755);
      await fs.promises.rename(temporary, target);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
  }
  extractor = ytdlp.create(target);
  extractorStatus = 'nightly@2026.10.10 verificado';
  return true;
})().catch((error) => {
  extractorStatus = 'extractor incluido; descarga externa no disponible';
  console.error('No se pudo preparar yt-dlp:', error.message);
  return true;
});

const runMediaDownload = (sourceUrl, outputTemplate, userAgent, audioOnly = false) => extractor(sourceUrl, {
  output: outputTemplate,
  format: audioOnly ? 'bestaudio/best' : new URL(sourceUrl).hostname.endsWith('tiktok.com')
    ? 'best[vcodec^=h264]/best[ext=mp4]/best/bestaudio'
    : 'best[height<=480]/best[height<=720]/bestaudio/best',
  noPlaylist: true,
  restrictFilenames: true,
  maxFilesize: '100M',
  noWarnings: true,
  jsRuntimes: `node:${process.execPath}`,
  remoteComponents: 'ejs:github',
  ...(userAgent ? { userAgent } : {})
});

const downloadMediaFromUrl = async (sourceUrl) => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aeterna-url-'));
  const outputTemplate = path.join(tempDir, 'source.%(ext)s');
  const isTikTok = new URL(sourceUrl).hostname.endsWith('tiktok.com');
  const attempts = isTikTok
    ? [
        { audioOnly: false }, { audioOnly: false, userAgent: 'abc' },
        { audioOnly: true }, { audioOnly: true, userAgent: 'abc' }
      ]
    : [{ audioOnly: false }, { audioOnly: true }];
  try {
    await extractorReady;
    let lastError;
    for (const attempt of attempts) {
      try {
        await runMediaDownload(sourceUrl, outputTemplate, attempt.userAgent, attempt.audioOnly);
        const files = await fs.promises.readdir(tempDir);
        const downloaded = files.map(file => path.join(tempDir, file))
          .find(file => fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0);
        if (!downloaded) throw new Error('No se descargó ningún archivo utilizable.');
        return { tempDir, filePath: downloaded, fileName: path.basename(downloaded), mimeType: inferMimeType(downloaded, attempt.audioOnly) };
      } catch (error) {
        lastError = error;
        for (const file of await fs.promises.readdir(tempDir)) {
          await fs.promises.rm(path.join(tempDir, file), { force: true, recursive: true });
        }
      }
    }
    throw lastError;
  } catch (error) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    const details = stringifyError(error).toLowerCase();
    if (details.includes('impersonat') || details.includes('extract') || details.includes('unsupported url')) {
      throw new Error('La plataforma ha rechazado este enlace. Comprueba que la publicación sea pública e inténtalo de nuevo.');
    }
    if (details.includes('file is larger') || details.includes('max-filesize')) {
      throw new Error('El archivo supera el límite de 100 MB.');
    }
    throw new Error('No se pudo abrir este enlace. Comprueba que sea público e inténtalo de nuevo.');
  }
};

const transcriptionPrompt = `Transcribe todo lo que se dice en el audio o vídeo. Devuelve siempre el texto en español de España.

Reglas obligatorias:
- No resumas.
- Si se habla en otro idioma, traduce fielmente al español cada frase, sin resumir ni añadir contenido. No devuelvas la transcripción en el idioma original.
- Si se habla en español, conserva literalmente las palabras pronunciadas.
- No reescribas ni corrijas lo que se dice, salvo lo necesario para traducir otro idioma.
- No mejores el estilo.
- No conviertas la transcripción en una explicación.
- Mantén el orden exacto del discurso.
- Conserva nombres propios, marcas, herramientas, menús, programas y términos técnicos tal como se oigan.
- Si el archivo es vídeo, lee también cada pantalla o diapositiva con información escrita. Añade ese texto en su orden de aparición, con la marca aproximada [mm:ss], una sola vez por pantalla. Ignora subtítulos automáticos y elementos de la interfaz. Si no es legible, escribe [ilegible]; nunca lo inventes.
- No sustituyas un nombre por otro programa parecido ni completes palabras a partir de conocimientos externos.
- Si no puedes distinguir una palabra o un nombre, escribe [inaudible] en ese punto; no adivines.
- No añadas títulos, introducciones, conclusiones, notas ni comentarios.
- Devuelve únicamente la transcripción.`;

const visualTextPrompt = `Extrae exclusivamente la información escrita que aparece en las imágenes de este vídeo. Ignora por completo la voz, la música, los subtítulos automáticos y el texto de la interfaz de la plataforma.

Reglas obligatorias:
- Recorre el vídeo en orden temporal. Lee cada pantalla, diapositiva o imagen informativa visible, incluidas las que aparecen brevemente si son legibles.
- Conserva literalmente el idioma, los nombres propios, los números y el orden del texto. No traduzcas, resumas, corrijas ni completes con conocimientos externos.
- Agrupa el texto por pantalla con una marca de tiempo aproximada [mm:ss]. Si una pantalla permanece igual o reaparece sin cambios, no repitas su contenido.
- Incluye solo texto que puedas ver. Si una parte no se distingue, escribe [ilegible] en su posición. No inventes palabras ni describas imágenes sin texto.
- Si no hay ningún texto informativo legible, devuelve exactamente [SIN_TEXTO_VISUAL].
- Devuelve únicamente el texto extraído y sus marcas de tiempo.`;

const visualPhotoPrompt = `Lee exclusivamente el texto visible en estas imágenes de una publicación de TikTok, en el orden recibido.

Reglas obligatorias:
- Separa cada imagen como «Imagen N», con el número indicado al final de este mensaje.
- Conserva literalmente el idioma, los nombres propios, los números y el orden de lectura. No traduzcas, resumas, corrijas ni completes con conocimientos externos.
- No leas la voz, la música ni elementos de la interfaz de TikTok. No describas imágenes sin texto.
- Si una parte no se distingue, escribe [ilegible]; no inventes palabras.
- Si ninguna imagen contiene texto informativo legible, devuelve exactamente [SIN_TEXTO_VISUAL].
- Devuelve únicamente el texto extraído, sin introducción.`;

const generateTranscription = async (ai, mediaPart, mode = 'audio', promptOverride = null, models = OWNER_GEMINI_MODELS) => {
  let lastError = null;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: createUserContent([
          ...(Array.isArray(mediaPart) ? mediaPart : [mediaPart]),
          promptOverride || (mode === 'visual' ? visualTextPrompt : transcriptionPrompt)
        ]),
        config: { temperature: 0 }
      });

      return {
        model,
        transcription: mode === 'visual' ? cleanText(response.text || '') : normalizeKnownTerms(response.text || '')
      };
    } catch (error) {
      lastError = error;
      if (isModelUnavailableError(error)) continue;
      if (isTemporaryGeminiError(error)) continue;
      throw error;
    }
  }

  throw lastError || new Error('Gemini no ha respondido.');
};

const transcribeWithGeminiFile = async (ai, { filePath, mimeType, mode = 'audio' }, models = OWNER_GEMINI_MODELS) => {
  const uploadResult = await ai.files.upload({
    file: filePath,
    config: { mimeType }
  });

  let fileState = await ai.files.get({ name: uploadResult.name });
  while (fileState.state === 'PROCESSING') {
    await sleep(3000);
    fileState = await ai.files.get({ name: uploadResult.name });
  }
  if (fileState.state !== 'ACTIVE') throw new Error(`El archivo falló con estado: ${fileState.state}`);
  return generateTranscription(ai, createPartFromUri(uploadResult.uri, uploadResult.mimeType), mode, null, models);
};

const tikTokPhotoMatch = (value) => {
  const url = new URL(value);
  if (!(url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'))) return null;
  return /^\/@[\w.-]+\/photo\/(\d+)(?:\/)?$/.exec(url.pathname);
};

const resolveTikTokShortUrl = async (sourceUrl) => {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  if (!['vm.tiktok.com', 'vt.tiktok.com'].includes(hostname)) return sourceUrl;
  let response = await fetch(sourceUrl, {
    method: 'HEAD',
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000)
  });
  if (response.status === 405 || response.status === 501) {
    response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    });
  }
  if (!response.ok) throw new Error('No se ha podido abrir este enlace corto de TikTok.');
  const finalUrl = new URL(response.url);
  if (!['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(finalUrl.hostname.toLowerCase())) {
    throw new Error('El enlace corto no lleva a una publicación de TikTok válida.');
  }
  return finalUrl.href;
};

const fetchTikTokPhotoImages = async (sourceUrl) => {
  const match = tikTokPhotoMatch(sourceUrl);
  if (!match) throw new Error('Enlace de fotos de TikTok no válido.');
  const detailUrl = new URL(sourceUrl);
  detailUrl.pathname = detailUrl.pathname.replace('/photo/', '/video/');
  detailUrl.search = '';
  const response = await fetch(detailUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error('TikTok no ha permitido acceder a las imágenes de esta publicación.');
  const html = await response.text();
  const embedded = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!embedded) throw new Error('TikTok no ha entregado los datos de esta publicación de fotos.');
  const post = JSON.parse(embedded[1])?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
  const images = post?.imagePost?.images;
  if (String(post?.id) !== match[1] || !Array.isArray(images) || !images.length || images.length > 35) {
    throw new Error('No se ha podido obtener una lista válida de imágenes de esta publicación.');
  }
  return images.map((image) => {
    const candidate = image?.imageURL?.urlList?.[0];
    const imageUrl = new URL(candidate);
    if (imageUrl.protocol !== 'https:' || !/(^|\.)tiktokcdn(?:-[a-z0-9]+)?\.com$/.test(imageUrl.hostname)) {
      throw new Error('TikTok ha enviado una dirección de imagen no válida.');
    }
    return imageUrl.href;
  });
};

const readTikTokImagePart = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error('No se ha podido descargar una de las imágenes de TikTok.');
  }
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 5_000_000) throw new Error('Una imagen de TikTok supera el límite de 5 MB.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 5_000_000) throw new Error('Una imagen de TikTok supera el límite de 5 MB.');
  return { inlineData: { mimeType, data: buffer.toString('base64') } };
};

const readTikTokPhotoText = async (ai, sourceUrl, models = OWNER_GEMINI_MODELS) => {
  const imageUrls = await fetchTikTokPhotoImages(sourceUrl);
  const sections = [];
  let model = '';
  let parts = [];
  let firstImage = 1;
  let encodedBytes = 0;
  const processBatch = async () => {
    if (!parts.length) return;
    const result = await generateTranscription(ai, parts, 'visual', `${visualPhotoPrompt}\nEstas son las imágenes ${firstImage} a ${firstImage + parts.length - 1}.`, models);
    model = result.model;
    if (result.transcription && !result.transcription.includes('[SIN_TEXTO_VISUAL]')) sections.push(result.transcription);
    firstImage += parts.length;
    parts = [];
    encodedBytes = 0;
  };
  for (const imageUrl of imageUrls) {
    const part = await readTikTokImagePart(imageUrl);
    if (parts.length >= 6 || (parts.length && encodedBytes + part.inlineData.data.length > 15_000_000)) await processBatch();
    parts.push(part);
    encodedBytes += part.inlineData.data.length;
  }
  await processBatch();
  return { model, transcription: sections.join('\n\n') };
};

const isYouTubeUrl = (value) => {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
};

const canonicalYouTubeUrl = (value) => {
  const url = new URL(value);
  const parts = url.pathname.split('/').filter(Boolean);
  const id = url.hostname.toLowerCase() === 'youtu.be' ? parts[0]
    : parts[0] === 'shorts' || parts[0] === 'live' ? parts[1]
      : url.searchParams.get('v');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) return null;
  return `https://www.youtube.com/watch?v=${id}`;
};

const removePathSafe = async (targetPath) => {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  await fs.promises.rm(targetPath, { recursive: true, force: true });
};

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'AETERNA backend activo', version: 'beta-v1.2', extractorStatus });
});

app.get('/api/github-auth/config', (req, res) => {
  res.json({ configured: githubAppConfigured(), installUrl: GITHUB_APP_INSTALL_URL });
});

app.get('/api/github-auth/start', (req, res) => {
  if (!githubAppConfigured()) return res.status(503).send('La conexión con GitHub aún no está configurada.');
  const state = crypto.randomBytes(32).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  githubAuthStates.set(state, { verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_APP_CLIENT_ID);
  url.searchParams.set('redirect_uri', githubCallbackUrl());
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

app.get('/api/github-auth/callback', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const state = String(req.query.state || '');
  const pending = githubAuthStates.get(state);
  githubAuthStates.delete(state);
  if (!pending || pending.expiresAt < Date.now() || !req.query.code) return res.status(400).send('La conexión ha caducado. Vuelve a AETERNA e inténtalo de nuevo.');
  try {
    const token = await githubTokenRequest({
      client_id: process.env.GITHUB_APP_CLIENT_ID,
      client_secret: process.env.GITHUB_APP_CLIENT_SECRET,
      code: String(req.query.code),
      redirect_uri: githubCallbackUrl(),
      code_verifier: pending.verifier
    });
    const userResponse = await fetch('https://api.github.com/user', { headers: githubHeaders(token.access_token) });
    const user = await userResponse.json();
    if (!userResponse.ok || !user.login) return res.status(502).send('GitHub no pudo verificar la cuenta.');
    const sessionData = {
      login: user.login,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : null
    };
    const sessionId = sealSession('github', sessionData, PERSISTENT_SESSION_MS) || crypto.randomBytes(32).toString('hex');
    if (/^[a-f0-9]{64}$/.test(sessionId)) githubSessions.set(sessionId, sessionData);
    const frontend = new URL(githubFrontendUrl());
    frontend.hash = `github_session=${sessionId}`;
    res.redirect(frontend.toString());
  } catch (error) {
    console.error('Error de conexión con GitHub:', error.message);
    res.status(502).send('No se pudo conectar con GitHub. Vuelve a AETERNA e inténtalo de nuevo.');
  }
});

app.get('/api/github-auth/status', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const session = await sessionFromRequest(req, res);
  if (!session) return res.status(401).json({ connected: false });
  res.json({ connected: true, login: session.login });
});

app.get('/api/github-auth/repositories', async (req, res) => {
  try {
    const session = await sessionFromRequest(req, res);
    if (!session) return res.status(401).json({ error: 'Conecta tu cuenta de GitHub.' });
    res.set('Cache-Control', 'no-store');
    res.json({ repositories: await githubRepositories(session), installUrl: GITHUB_APP_INSTALL_URL });
  } catch (error) {
    console.error('Error consultando repositorios de GitHub:', error.message);
    res.status(502).json({ error: 'No se pudieron cargar los repositorios. Inténtalo de nuevo.' });
  }
});

app.post('/api/github-auth/logout', (req, res) => {
  const sessionId = /^Bearer (.+)$/.exec(req.get('Authorization') || '')?.[1];
  if (sessionId) githubSessions.delete(sessionId);
  res.json({ success: true });
});

app.post('/api/transcribe', requireGeminiSession, upload.single('file'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se ha seleccionado ningún archivo.' });
    }

    filePath = req.file.path;
    const mimeType = req.file.mimetype || 'video/mp4';
    const mode = req.body?.mode === 'visual' ? 'visual' : 'audio';
    if (mode === 'visual' && !mimeType.startsWith('video/')) {
      return res.status(400).json({ success: false, error: 'Para extraer texto visual, selecciona un archivo de vídeo.' });
    }
    const result = await transcribeWithGeminiFile(req.geminiAi, { filePath, mimeType, mode }, req.geminiModels);
    if (mode === 'visual' && (!result.transcription || result.transcription.includes('[SIN_TEXTO_VISUAL]'))) {
      return res.status(422).json({ success: false, error: 'No se ha encontrado texto visual legible en este vídeo.' });
    }
    const suggestedTitle = fallbackTitleFromTranscript(result.transcription);

    res.json({
      success: true,
      model: result.model,
      fileName: req.file.originalname,
      mode,
      suggestedTitle,
      transcription: result.transcription
    });
  } catch (error) {
    console.error(error);
    const publicError = buildPublicGeminiError(error);
    res.status(publicError.status).json({
      success: false,
      error: publicError.message,
      retryAfterSeconds: publicError.retryAfterSeconds
    });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.post('/api/transcribe-url', requireGeminiSession, async (req, res) => {
  let tempDir = null;

  try {
    const sourceUrl = cleanText(req.body?.url || '');
    const mode = req.body?.mode === 'visual' ? 'visual' : 'audio';
    if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
      return res.status(400).json({ success: false, error: 'Pega una URL válida de TikTok, YouTube u otra plataforma compatible.' });
    }
    try { new URL(sourceUrl); } catch (_) {
      return res.status(400).json({ success: false, error: 'La URL no es válida.' });
    }

    const resolvedUrl = await resolveTikTokShortUrl(sourceUrl);
    if (tikTokPhotoMatch(resolvedUrl)) {
      const result = await readTikTokPhotoText(req.geminiAi, resolvedUrl, req.geminiModels);
      if (!result.transcription) {
        return res.status(422).json({ success: false, error: 'No se ha encontrado texto visual legible en estas imágenes.' });
      }
      return res.json({
        success: true,
        model: result.model,
        fileName: 'Fotos de TikTok',
        sourceUrl,
        platform: 'TikTok',
        mode: 'visual',
        visualVerification: true,
        suggestedTitle: fallbackTitleFromTranscript(result.transcription),
        transcription: result.transcription
      });
    }

    if (isYouTubeUrl(resolvedUrl)) {
      const canonicalUrl = canonicalYouTubeUrl(sourceUrl);
      if (!canonicalUrl) return res.status(400).json({ success: false, error: 'No se ha encontrado un identificador de vídeo de YouTube válido.' });
      const result = await generateTranscription(req.geminiAi, { fileData: { fileUri: canonicalUrl, mimeType: 'video/*' } }, mode, null, req.geminiModels);
      if (mode === 'visual' && (!result.transcription || result.transcription.includes('[SIN_TEXTO_VISUAL]'))) {
        return res.status(422).json({ success: false, error: 'No se ha encontrado texto visual legible en este vídeo.' });
      }
      return res.json({
        success: true,
        model: result.model,
        fileName: 'YouTube',
        sourceUrl,
        platform: 'YouTube',
        mode,
        visualVerification: true,
        suggestedTitle: fallbackTitleFromTranscript(result.transcription),
        transcription: result.transcription
      });
    }

    const downloaded = await downloadMediaFromUrl(resolvedUrl);
    tempDir = downloaded.tempDir;

    if (mode === 'visual' && !downloaded.mimeType.startsWith('video/')) {
      return res.status(422).json({ success: false, error: 'Solo se ha podido obtener audio de este enlace. Para leer las imágenes, sube el archivo de vídeo.' });
    }

    const result = await transcribeWithGeminiFile(req.geminiAi, { filePath: downloaded.filePath, mimeType: downloaded.mimeType, mode }, req.geminiModels);
    if (mode === 'visual' && (!result.transcription || result.transcription.includes('[SIN_TEXTO_VISUAL]'))) {
      return res.status(422).json({ success: false, error: 'No se ha encontrado texto visual legible en este vídeo.' });
    }
    const suggestedTitle = fallbackTitleFromTranscript(result.transcription);

    res.json({
      success: true,
      model: result.model,
      fileName: downloaded.fileName,
      sourceUrl,
      platform: inferPlatformFromUrl(sourceUrl),
      mode,
      visualVerification: downloaded.mimeType.startsWith('video/'),
      suggestedTitle,
      transcription: result.transcription
    });
  } catch (error) {
    console.error(error);
    const publicError = buildPublicGeminiError(error);
    res.status(publicError.status).json({
      success: false,
      error: publicError.message,
      retryAfterSeconds: publicError.retryAfterSeconds
    });
  } finally {
    await removePathSafe(tempDir);
  }
});

// Optional second pass. The original transcription is never changed or saved here.
app.post('/api/create-guide', requireGeminiSession, async (req, res) => {
  const transcription = cleanText(req.body?.transcription);
  if (transcription.length < 40) {
    return res.status(400).json({ success: false, error: 'La transcripción es demasiado corta para crear una guía.' });
  }
  if (transcription.length > 120_000) {
    return res.status(413).json({ success: false, error: 'Esta transcripción es demasiado larga para crear una guía de una sola vez.' });
  }

  const title = cleanText(req.body?.title).slice(0, 160);
  const sourceUrl = cleanText(req.body?.sourceUrl);
  const validSourceUrl = /^https:\/\//i.test(sourceUrl) && sourceUrl.length <= 2000 ? sourceUrl : '';
  const visualOnly = req.body?.mode === 'visual';
  const prompt = `Analiza esta ${visualOnly ? 'lectura de texto de imágenes: no contiene audio ni instrucciones habladas' : 'transcripción'} y devuelve SOLO JSON válido: {"title":"...","type":"procedure|catalogue","steps":["..."],"resources":[{"name":"...","kind":"github|website","url":"","note":"..."}]}. Si explica una secuencia real de acciones, type=procedure y hasta 6 pasos breves. Si solo enumera programas, consejos o imágenes, type=catalogue, steps=[] y pon cada programa nombrado en resources con una nota de hasta 80 caracteres basada solo en el texto visible. No conviertas cada programa en un paso, no añadas acciones ni objetivos no presentes, y no uses un título de la última imagen como título general. Hasta 8 recursos. URLs solo si aparecen literalmente; el servidor buscará las demás. Omitir cifras irrelevantes. Título sugerido: ${title || 'Contenido del vídeo'}. Material de referencia: ${transcription}`;

  try {
    const models = [...new Set(req.geminiModels || [])].sort((a, b) => Number(b.includes('lite')) - Number(a.includes('lite')));
    let lastError;
    for (const [modelIndex, model] of models.slice(0, 3).entries()) {
      try {
        let response;
        for (let attempt = 0; attempt < (modelIndex === 0 ? 2 : 1); attempt++) {
          try {
            response = await req.geminiAi.models.generateContent({
              model,
              contents: createUserContent(prompt),
              config: { temperature: 0, maxOutputTokens: 1600, responseMimeType: 'application/json' }
            });
            break;
          } catch (error) {
            const overloaded = /503|unavailable|overloaded/i.test(stringifyError(error));
            if (overloaded && attempt === 0 && modelIndex === 0) {
              await sleep(1500);
              continue;
            }
            throw error;
          }
        }
        const generated = JSON.parse(cleanText(response.text));
        const steps = Array.isArray(generated.steps) ? generated.steps.filter(step => typeof step === 'string').slice(0, 6).map(step => cleanText(step).slice(0, 160)) : [];
        const catalogue = generated.type === 'catalogue';
        if (!steps.length && !catalogue) {
          return res.status(422).json({ success: false, error: 'Este contenido no explica pasos suficientes para crear una guía fiable.' });
        }
        if (catalogue && (!Array.isArray(generated.resources) || !generated.resources.length)) {
          return res.status(422).json({ success: false, error: 'No se han podido distinguir programas concretos en estas imágenes.' });
        }
        const resources = [];
        for (const item of (Array.isArray(generated.resources) ? generated.resources : []).slice(0, 8)) {
          const name = cleanText(item?.name).slice(0, 80);
          if (!name) continue;
          let url = cleanText(item?.url);
          if (!/^https:\/\//i.test(url) || !transcription.includes(url)) url = '';
          if (!url) {
            try {
              const search = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(name)}&per_page=5`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AETERNA-PRO' }, signal: AbortSignal.timeout(7000) });
              if (search.ok) {
                const hits = (await search.json()).items || [];
                const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const wanted = normalize(name.split('/').pop());
                const match = hits.find(hit => normalize(hit.name) === wanted && (!name.includes('/') || normalize(hit.full_name) === normalize(name)));
                if (match) {
                  url = match.html_url;
                  if (item?.kind === 'website' && match.stargazers_count >= 30) {
                    const homepage = cleanText(match.homepage);
                    const description = cleanText(match.description);
                    try {
                      const parsed = new URL(homepage);
                      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && description.toLowerCase().includes(parsed.hostname.toLowerCase())) url = parsed.href;
                    } catch (_) { /* Keep the matching source repository. */ }
                  }
                }
              }
            } catch (_) { /* An unavailable search never becomes a guessed link. */ }
          }
          resources.push({ name, url, note: cleanText(item?.note).slice(0, 100) });
        }
        const missingWebsites = resources.filter(item => !item.url);
        let lookupLimited = false;
        if (missingWebsites.length && models.includes('gemini-2.5-flash-lite')) {
          try {
            const names = missingWebsites.map(item => item.name);
            const lookup = await req.geminiAi.models.generateContent({
              model: 'gemini-2.5-flash-lite',
              contents: createUserContent(`Busca la página oficial de descarga o la ficha oficial del fabricante para estos programas: ${JSON.stringify(names)}. Responde solo una línea por programa con formato NOMBRE | URL HTTPS. No uses portales de terceros, resultados de búsqueda ni URLs inventadas. Si no la encuentras, omite esa línea.`),
              config: { tools: [{ googleSearch: {} }], temperature: 0, maxOutputTokens: 500 }
            });
            const grounded = lookup.candidates?.[0]?.groundingMetadata;
            if (grounded?.webSearchQueries?.length && grounded?.groundingChunks?.length) {
              const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              for (const line of cleanText(lookup.text).split('\n')) {
                const [foundName, rawUrl] = line.split('|').map(part => part?.trim());
                const item = missingWebsites.find(entry => normalize(entry.name) === normalize(foundName));
                if (!item || !rawUrl) continue;
                try {
                  const candidate = new URL(rawUrl);
                  if (candidate.protocol !== 'https:' || candidate.username || candidate.password || candidate.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(candidate.hostname)) continue;
                  if (/(google\.|bing\.|duckduckgo\.|softonic\.|uptodown\.)/i.test(candidate.hostname)) continue;
                  const source = grounded.groundingChunks.some(chunk => {
                    const title = cleanText(chunk.web?.title);
                    return normalize(title).includes(normalize(item.name));
                  });
                  if (source) item.url = candidate.href;
                } catch (_) { /* Ignore malformed search results. */ }
              }
            }
          } catch (error) {
            lookupLimited = /429|resource_exhausted|quota|rate limit/i.test(stringifyError(error));
            console.warn('No se pudo completar la búsqueda web de la guía:', error.message);
          }
        }
        const linked = new Set();
        const stepText = steps.map((step, index) => {
          const resource = resources.find(item => item.url && !linked.has(item.name) && step.toLowerCase().includes(item.name.toLowerCase()));
          if (resource) linked.add(resource.name);
          return `${index + 1}. ${step}${resource ? ` ${resource.url}` : ''}`;
        }).join('\n');
        const remaining = resources.filter(item => item.url && !linked.has(item.name));
        const noLinkReason = lookupLimited ? 'búsqueda temporalmente limitada por Gemini' : 'enlace no encontrado con seguridad';
        const catalogueText = resources.map(item => `${item.name}${item.note ? ` — ${item.note}` : ''}${item.url ? ` ${item.url}` : ` (${noLinkReason})`}`).join('\n');
        const guide = `${cleanText(generated.title || title || 'Guía paso a paso').slice(0, 100)}\n\n${catalogue ? `Programas mencionados\n${catalogueText}` : `${stepText}${remaining.length ? `\n\nEnlaces\n${remaining.map(item => `${item.name}: ${item.url}`).join('\n')}` : ''}${resources.some(item => !item.url) ? `\n\n${resources.filter(item => !item.url).map(item => `${item.name}: ${noLinkReason}`).join('\n')}` : ''}`}${validSourceUrl ? `\n\nVídeo original: ${validSourceUrl}` : ''}`.trim();
        return res.json({ success: true, guide, model, type: catalogue ? 'catalogue' : 'procedure' });
      } catch (error) {
        lastError = error;
        if (isModelUnavailableError(error) || /503|unavailable|overloaded/i.test(stringifyError(error))) continue;
        throw error;
      }
    }
    throw lastError || new Error('No hay un modelo de Gemini disponible para crear la guía.');
  } catch (error) {
    console.error('No se pudo crear la guía:', error.message);
    const publicError = buildPublicGeminiError(error);
    return res.status(publicError.status).json({ success: false, error: publicError.message });
  }
});

app.post('/api/save-transcript-to-github', requireGeminiSession, async (req, res) => {
  try {
    const session = await sessionFromRequest(req, res);
    if (!session) return res.status(401).json({ success: false, error: 'Conecta tu cuenta de GitHub para guardar la transcripción.' });
    const token = session.accessToken;
    const selectedRepository = cleanText(req.body?.repository || '');
    const repository = (await githubRepositories(session)).find(item => item.fullName.toLowerCase() === selectedRepository.toLowerCase());
    if (!repository) return res.status(403).json({ success: false, error: 'Elige un repositorio autorizado para guardar.' });
    const [owner, repo] = repository.fullName.split('/');
    const branch = repository.defaultBranch;
    const basePath = 'transcripts';

    const { title, platform, project, transcription, model, fileName, sourceUrl } = req.body || {};

    if (!transcription || !String(transcription).trim()) {
      return res.status(400).json({ success: false, error: 'No hay transcripción para guardar.' });
    }

    const metadata = await generateKnowledgeMetadata({ title, transcription }, req.geminiAi, req.geminiModels);

    const now = new Date();
    const datePrefix = now.toISOString().slice(0, 10);
    const timePrefix = now.toISOString().slice(11, 19).replace(/:/g, '');
    const slug = sanitizeSlug(metadata.title || title || 'transcripcion-aeterna');
    const savePath = `${basePath}/${datePrefix.slice(0, 4)}/${datePrefix.slice(5, 7)}/${datePrefix}_${timePrefix}_${slug}_${crypto.randomBytes(3).toString('hex')}.md`;

    const markdown = buildTranscriptMarkdown({ title, platform, project, transcription, model, fileName, sourceUrl, metadata });
    const content = Buffer.from(markdown, 'utf8').toString('base64');

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(savePath).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: githubHeaders(token),
      body: JSON.stringify({
        message: `Add AETERNA transcript ${datePrefix} ${slug}`,
        content,
        branch
      })
    });

    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        return res.status(403).json({ success: false, error: 'GitHub no permite escribir en este repositorio. Comprueba el acceso de la aplicación.' });
      }
      throw new Error(data?.message || `GitHub respondió con estado ${response.status}`);
    }

    res.json({
      success: true,
      repository: repository.fullName,
      path: savePath,
      url: data?.content?.html_url || null,
      commit: data?.commit?.sha || null,
      title: metadata.title,
      summary: metadata.summary,
      tags: metadata.tags,
      technicalConfidence: metadata.technicalConfidence,
      doubtfulTerms: metadata.doubtfulTerms
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message || 'Error guardando en GitHub.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor AETERNA beta v1.2 activo en puerto ${PORT}`);
});
