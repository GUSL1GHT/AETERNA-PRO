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

const buildTranscriptMarkdown = ({ title, sourceUrl, platform, project, transcription, model, fileName }) => {
  const now = new Date().toISOString();
  const cleanTitle = cleanText(title) || 'Transcripción AETERNA';
  const cleanPlatform = cleanText(platform) || 'No especificada';
  const cleanProject = cleanText(project) || 'Sin proyecto asignado';
  const cleanSourceUrl = cleanText(sourceUrl) || 'No especificada';
  const cleanFileName = cleanText(fileName) || 'No especificado';
  const cleanModel = cleanText(model) || 'No especificado';
  const cleanTranscript = cleanText(transcription);

  return `# ${cleanTitle}

## Metadatos

- Fecha: ${now}
- Plataforma: ${cleanPlatform}
- URL original: ${cleanSourceUrl}
- Proyecto relacionado: ${cleanProject}
- Archivo original: ${cleanFileName}
- Modelo de transcripción: ${cleanModel}
- Estado: pendiente

## Uso previsto

Fuente capturada con AETERNA para revisión posterior, auditoría de ideas, generación de guías o posible conversión en tareas de proyecto.

## Transcripción literal

${cleanTranscript}
`;
};

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'AETERNA backend activo' });
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

          return res.json({
            success: true,
            model,
            fileName: req.file.originalname,
            transcription: (response.text || '').trim()
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

    const { title, sourceUrl, platform, project, transcription, model, fileName } = req.body || {};

    if (!transcription || !String(transcription).trim()) {
      return res.status(400).json({
        success: false,
        error: 'No hay transcripción para guardar.'
      });
    }

    const now = new Date();
    const datePrefix = now.toISOString().slice(0, 10);
    const timePrefix = now.toISOString().slice(11, 19).replace(/:/g, '');
    const slug = sanitizeSlug(title || fileName || 'transcripcion-aeterna');
    const path = `${basePath}/${datePrefix}_${timePrefix}_${slug}.md`;

    const markdown = buildTranscriptMarkdown({
      title,
      sourceUrl,
      platform,
      project,
      transcription,
      model,
      fileName
    });

    const content = Buffer.from(markdown, 'utf8').toString('base64');

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
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
      commit: data?.commit?.sha || null
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
