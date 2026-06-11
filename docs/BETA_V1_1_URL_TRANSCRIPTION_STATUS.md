# AETERNA Beta v1.1 URL Transcription Status

## Rama de trabajo

`beta-v1.1-url-whisper`

## Rama estable protegida

`beta-v1.0-estable`

No modificar esta rama para pruebas de URL, yt-dlp o Whisper.

## Objetivo de Beta v1.1

Eliminar el paso manual de descargar un vídeo al dispositivo del usuario y volverlo a subir a AETERNA.

Flujo objetivo:

```text
Pegar URL
↓
Backend descarga audio/vídeo temporalmente con yt-dlp
↓
Gemini transcribe
↓
AETERNA guarda el Markdown en GitHub
↓
Backend borra temporales
```

## Cambios aplicados

### Backend

Archivo nuevo:

`backend/server-v11.js`

Incluye:

- Endpoint existente conservado: `POST /api/transcribe`
- Endpoint nuevo: `POST /api/transcribe-url`
- Descarga temporal con `yt-dlp-exec`
- Borrado de temporales con `fs.promises.rm`
- Soporte para `sourceUrl` en el Markdown