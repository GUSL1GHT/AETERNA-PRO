const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { GoogleGenAI, createUserContent, createPartFromUri } = require('@google/genai');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isTemporaryGeminiError = (error) => {
  const text = JSON.stringify(error || {}).toLowerCase() + ' ' + String(error?.message || '').toLowerCase();
  return text.includes('503') || text.includes('unavailable') || text.includes('overloaded') || text.includes('try again later');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor AETERNA activo en puerto ${PORT}`);
});
