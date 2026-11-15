# Estado actual de AETERNA-PRO

- Fecha: 2026-11-15.
- Última IA: Claude Code (sesión de evolución de AETERNA-PRO).

## Hecho hoy

- Auditoría: `codex/visual-text-extraction` y `beta-v1.1-url-whisper` tenían el mismo código; solo diferían en esta ficha. Web en GitHub Pages; backend en Render (`server-v11.js`), por lo que consta en la documentación probablemente en el plan gratuito, sin disco persistente. `GUSL1GHT/AETERNA-TRANSCRIPTS` es público.
- **Cola en segundo plano**: compartir guarda la URL al instante en el dispositivo (IndexedDB, `outbox.js`) y la envía a `POST /api/jobs`; el service worker la reenvía con Background Sync si falla. El backend apunta el trabajo en `cola/<id>.json` del repositorio de la biblioteca, lo procesa de uno en uno con reintentos (30 s, 2 min, 5 min) y publica el resultado en un solo commit. `GET /api/jobs` lista la cola y retoma los pendientes que quedaron a medias por un reinicio; `POST /api/jobs/:id/retry` reintenta los errores.
- **Formato legible**: segunda pasada de texto de Gemini (`formatForLibrary`) al formato de AETERNA-TRANSCRIPTS. El archivo va a `<Tema>/AAAA-MM-DD · Título.md` con su fila en el `Índice.md` y el contador del README. Si el tema es dudoso o la comprobación falla, se guarda en `transcripts/AAAA/MM/` con el texto original, para revisión. Reglas de la comprobación, acordadas con la sesión que mantiene la biblioteca: URLs, `usuario/repositorio`, cifras y palabras con mayúsculas internas obligatorias; palabras solo en mayúsculas como aviso; al menos el 45 % de las palabras. Sobre los 73 pares reales de la biblioteca coincide en 66; los 7 restantes irían a revisión.
- A petición del usuario, con la cola disponible (Gemini, GitHub y repositorio) solo queda el botón «Guardar en la cola»: compartir y volver a TikTok. La transcripción inmediata solo aparece si GitHub no está conectado. `/api/transcribe-url` se refactorizó a `transcribeFromUrl` sin cambiar sus respuestas.
- `tools/check-dev.ps1` funciona también en Windows PowerShell 5.

## Pruebas

- `npm test` en `backend/`: 19 de 19 (incluye `library-format.test.js` y `job-queue.test.js`).
- De principio a fin en local con GitHub y Gemini **simulados** sobre una copia de la biblioteca (script en el scratchpad de la sesión, no versionado): compartir → «Guardado ✓» al instante → Procesando → Hecho; archivo, índice, README y estado en un único commit; servidor apagado → el enlace queda en el móvil y se envía al reabrir; trabajo pendiente tras reinicio → se retoma; error → Reintentar → Hecho. Vista móvil comprobada.
- **Sin comprobar**: el service worker y Background Sync en un Chrome real (el navegador integrado no admite service workers; el script carga sin errores en una simulación); la calidad del formato con Gemini real; el flujo en Render.

## Segunda ronda (15/11, tras la primera prueba real)

- Los 2 primeros vídeos reales (`vm.tiktok.com`, @ia.cadasemana) quedaron «Para revisar» como «Vídeo sin título»: falló la segunda pasada de Gemini y el motivo no quedaba registrado. Corregido: Flash-Lite primero (más cuota y distinto del modelo que transcribe), los fallos temporales al ordenar se reintentan sin volver a transcribir, el motivo se anota en Notas y el título provisional sale de la transcripción. Causa exacta sin confirmar (sin acceso a los registros de Render); lo más probable es el límite de peticiones de la cuota gratuita.
- Pegar un enlace en la casilla lo guarda solo (también con Intro); ya no hay botón «Guardar en la cola».
- Nueva sección «Descripción del creador» con la descripción del vídeo tal cual (yt-dlp, sin coste de Gemini) y el enlace al perfil del creador; también se pasa a Gemini como contexto para el título y el tema. Comprobado en local con TikTok y YouTube reales; en Render, YouTube puede bloquear la lectura (el vídeo se procesa igual sin ella). Aviso enviado a la sesión de AETERNA-TRANSCRIPTS.
- Causa real de «Para revisar» (anotada por la propia app): Render instala `@google/genai` 3.x, que usa la API v1 sin modo JSON. Corregido fijando `v1beta` (comprobado con la 3.3.0). El service worker pide los archivos con no-cache para no servir la versión anterior.
- Retirada «Crear guía paso a paso» (botón y `/api/create-guide`) a petición del usuario.
- Pendiente (propuesta 4): sugerir vídeos relacionados del canal del creador, sin transcribir nada sin permiso.

## Publicación

- Con autorización del usuario, `4ef2905`, `3cec077` y `81fd405` se subieron a `beta-v1.1-url-whisper` (despliegue) y a `codex/visual-text-extraction` el 15/11/2026.

## Siguiente paso

1. Compartir un vídeo real desde el móvil y revisar el archivo publicado en AETERNA-TRANSCRIPTS.
2. Si Gemini resume demasiado, ajustar el prompt de `formatForLibrary` (los vídeos irían a `transcripts/` para revisión, sin pérdida).

## Bloqueos

- Riesgo conocido: en el plan gratuito de Render, un vídeo interrumpido por un reinicio espera hasta la próxima vez que se abra la app.
