const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
    const mimeType = req.file.mimetype || 'audio/mp3';

    const uploadResult = await ai.files.upload({
      file: filePath,
      mimeType
    });

    let fileState = await ai.files.get({ name: uploadResult.name });

    while (fileState.state === 'PROCESSING') {
      await new Promise(resolve => setTimeout(resolve, 3000));
      fileState = await ai.files.get({ name: uploadResult.name });
    }

    if (fileState.state !== 'ACTIVE') {
      throw new Error(`El archivo falló con estado: ${fileState.state}`);
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        uploadResult,
        {
          text: 'Transcribe el archivo adjunto. Solo devuelve el texto literal, sin frases introductorias ni aclaraciones.'
        }
      ]
    });

    res.json({
      success: true,
      transcription: (response.text || '').trim()
    });

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
