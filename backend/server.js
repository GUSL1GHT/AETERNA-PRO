const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { GoogleGenAI, createUserContent, createPartFromUri } = require('@google/genai');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isTemporaryGeminiError = (error) => {
  const text = JSON.stringify(error || {}).toLowerCase() + ' ' + String(error?.message || '').toLowerCase();
  return text.includes('503') || text.includes('unavailable') || text.includes('overloaded') || text.includes('try again later');
};

const githubHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28'
});

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
  return cleanText(value)
    .replace(/\bWind\s*Hook\b/gi, 'Windhawk')
    .replace(/\bWindhook\b/gi, 'Windhawk')
    .replace(/\bWindHawk\b/g, 'Windhawk')
    .replace(/\bPinokio\b/gi, 'Pinokio')
    .replace(/\bVoicebox\b/gi, 'Voicebox')
    .replace(/\bEleven\s*Labs\b/gi, 'ElevenLabs')
    .replace(/\bAce\s*Jam\b/gi, 'Ace Jam')
    .replace(/\bReclip\b/gi, 'Reclip');
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

const fallbackTitleFromTranscript = (transcription, fileName) => {
  const text = cleanText(transcription).toLowerCase();

  if (text.includes('windhawk') || text.includes('windhook')) {
    return 'Cambiar el menú Inicio de Windows 11 con Windhawk';
  }

  if (text.includes('pinokio') || text.includes('voicebox') || text.includes('elevenlabs')) {
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

  return cleanText(fileName).replace(/\.[^/.]+$/, '') || 'Transcripción AETERNA';
};

const generateKnowledgeMetadata = async ({ title, transcription, fileName }) => {
  const normalizedTranscript = normalizeKnownTerms(transcription);
  const fallbackTitle = isWeakTitle(title) ? fallbackTitleFromTranscript(normalizedTranscript, fileName) : normalizeKnownTerms(title);

  const fallback = {
    title: fallbackTitle,
    summary: 'Pendiente de revisar.',
    tags: ['aeterna', 'transcripcion'],
    ideas: ['Revisar la transcripción y decidir si se convierte en guía, mejora o tarea.']
  };

  try {
    const input = normalizedTranscript.slice(0, 6000);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: `Analiza esta transcripción y devuelve SOLO JSON válido con esta forma exacta:
{
  "title": "título útil y corto en español de España",
  "summary": "resumen de 1 frase",
  "tags": ["tag1", "tag2", "tag3"],
  "ideas": ["idea práctica 1", "idea práctica 2"]
}

Reglas:
- El título debe describir lo que enseña o propone el vídeo.
- No uses nombres basura de archivo como snaptik, y2mate, videoplayback o números.
- Si aparece Windhook, WindHook o WindHawk, corrígelo como Windhawk.
- Si aparece Pinokio, Voicebox, ElevenLabs, Ace Jam o Reclip, respeta esos nombres.
- Los tags deben ser simples, en minúsculas y útiles para buscar.
- Devuelve solo JSON.

Transcripción:
${input}`
    });

    const parsed = parseJsonObject(response.text || '');
    if (!parsed) return fallback;

    const generatedTitle = normalizeKnownTerms(parsed.title);
    return {
      title: isWeakTitle(generatedTitle) ? fallback.title : generatedTitle,
      summary: normalizeKnownTerms(parsed.summary) || fallback.summary,
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.map(tag => sanitizeSlug(tag)).filter(Boolean).slice(0, 8) : fallback.tags,
      ideas: Array.isArray(parsed.ideas) && parsed.ideas.length ? parsed.ideas.map(normalizeKnownTerms).filter(Boolean).slice(0, 5) : fallback.ideas
    };
  } catch (_) {
    return fallback;
  }
};

const buildTranscriptMarkdown = ({ title, platform, project, transcription, model, fileName, metadata }) => {
  const now = new Date().toISOString();
  const cleanTitle = normalizeKnownTerms(metadata?.title || title) || 'Transcripción AETERNA';
  const cleanPlatform = cleanText(platform) || 'No especificada';
  const cleanProject = cleanText(project) || 'Sin proyecto asignado';
  const cleanFileName = cleanText(fileName) || 'No especificado';
  const cleanModel = cleanText(model) || 'No especificado';
  const cleanTranscript = normalizeKnownTerms(transcription);
  const cleanSummary = normalizeKnownTerms(metadata?.summary) || 'Pendiente de revisar.';
  const cleanTags = Array.isArray(metadata?.tags) && metadata.tags.length ? metadata.tags.join(', ') : 'aeterna, transcripcion';
  const cleanIdeas = Array.isArray(metadata?.ideas) && metadata.ideas.length
    ? metadata.ideas.map((idea) => `- ${normalizeKnownTerms(idea)}`).join('\n')
    : '- Revisar la transcripción y decidir si se convierte en guía, mejora o tarea.';

  return `# ${cleanTitle}

## Metadatos

- Fecha: ${now}
- Plataforma: ${cleanPlatform}
- Proyecto relacionado: ${cleanProject}
- Archivo original: ${cleanFileName}
- Modelo de transcripción: ${cleanModel}
- Estado: pendiente
- Etiquetas: ${cleanTags}

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

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'AETERNA backend activo' });
});

app.get('/api/github-repos', async (req, res) => {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'Falta configurar GITHUB_TOKEN en Render.'
      });
    }

    const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {
      headers: githubHeaders(token)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || `GitHub respondió con estado ${response.status}`);
    }

    const repos = data
      .filter(repo => repo && repo.name)
      .map(repo => ({
        name: repo.name,
        fullName: repo.full_name,
        private: !!repo.private,
        updatedAt: repo.updated_at || null
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, repos });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error cargando repositorios de GitHub.'
    });
  }
});

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  let filePath = null;

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Falta configurar GEMINI_API_KEY en el servidor.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No se ha seleccionado ningún archivo.'
      });
    }

    filePath = req.file.path;
    const mimeType = req.file.mimetype || 'video/mp4';

    const uploadResult = await ai.files.upload({
      file: filePath,
      config: {
        mimeType: mimeType
      }
    });

    let fileState = await ai.files.get({ name: uploadResult.name });

    while (fileState.state === 'PROCESSING') {
      await sleep(3000);
      fileState = await ai.files.get({ name: uploadResult.name });
    }

    if (fileState.state !== 'ACTIVE') {
      throw new Error(`El archivo falló con estado: ${fileState.state}`);
    }

    const prompt = `Transcribe el audio o vídeo de forma literal, completa y en español de España.

Reglas obligatorias:
- No resumas.
- No reescribas.
- No mejores el estilo.
- No conviertas la transcripción en una explicación.
- No elimines repeticiones, muletillas, pausas naturales ni frases incompletas si se escuchan.
- Mantén el orden exacto del discurso.
- Conserva nombres propios, marcas, herramientas, menús, programas y términos técnicos tal como se oigan.
- Si oyes Windhook, WindHook o WindHawk y el contexto es Windows/mods/personalización, escribe Windhawk.
- Mantén expresiones coloquiales si aparecen en el audio.
- Si una palabra no se entiende, escribe [inaudible].
- Si dudas entre dos palabras, usa la más probable por contexto.
- No añadas títulos, introducciones, conclusiones, notas ni comentarios.
- Devuelve únicamente la transcripción.`;

    const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    let lastError = null;

    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: createUserContent([
              createPartFromUri(uploadResult.uri, uploadResult.mimeType),
              prompt
            ])
          });

          const transcription = normalizeKnownTerms(response.text || '');
          const metadata = await generateKnowledgeMetadata({
            title: '',
            transcription,
            fileName: req.file.originalname
          });

          return res.json({
            success: true,
            model,
            fileName: req.file.originalname,
            suggestedTitle: metadata.title,
            transcription
          });
        } catch (error) {
          lastError = error;

          if (!isTemporaryGeminiError(error)) {
            throw error;
          }

          await sleep(3000 * attempt);
        }
      }
    }

    throw lastError || new Error('Gemini no ha respondido después de varios intentos.');

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error interno del servidor.'
    });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

app.post('/api/save-transcript-to-github', async (req, res) => {
  try {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'GUSL1GHT';
    const repo = process.env.GITHUB_REPO || 'AETERNA-PRO';
    const branch = process.env.GITHUB_BRANCH || 'main';
    const basePath = (process.env.GITHUB_TRANSCRIPTS_PATH || 'sources/aeterna/inbox').replace(/^\/+|\/+$/g, '');

    if (!token) {
      return res.status(500).json({
        success: false,
        error: 'Falta configurar GITHUB_TOKEN en Render.'
      });
    }

    const { title, platform, project, transcription, model, fileName } = req.body || {};

    if (!transcription || !String(transcription).trim()) {
      return res.status(400).json({
        success: false,
        error: 'No hay transcripción para guardar.'
      });
    }

    const metadata = await generateKnowledgeMetadata({ title, transcription, fileName });

    const now = new Date();
    const datePrefix = now.toISOString().slice(0, 10);
    const timePrefix = now.toISOString().slice(11, 19).replace(/:/g, '');
    const slug = sanitizeSlug(metadata.title || title || fileName || 'transcripcion-aeterna');
    const path = `${basePath}/${datePrefix}_${timePrefix}_${slug}.md`;

    const markdown = buildTranscriptMarkdown({
      title,
      platform,
      project,
      transcription,
      model,
      fileName,
      metadata
    });

    const content = Buffer.from(markdown, 'utf8').toString('base64');

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
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
      throw new Error(data?.message || `GitHub respondió con estado ${response.status}`);
    }

    res.json({
      success: true,
      path,
      url: data?.content?.html_url || null,
      commit: data?.commit?.sha || null,
      title: metadata.title,
      summary: metadata.summary,
      tags: metadata.tags
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error guardando en GitHub.'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor AETERNA activo en puerto ${PORT}`);
});
