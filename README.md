# AETERNA PRO

Aplicación web y PWA para transcribir enlaces de vídeos o publicaciones y, opcionalmente, guardar la transcripción en GitHub.

## Estado

- La interfaz Beta v1.2 y la transcripción por URL se despliegan desde `beta-v1.1-url-whisper` (nombre histórico de la rama configurada en Pages y Render).
- `main` contiene una versión anterior que solo admite archivos.
- El backend de Beta v1.2 arranca con `backend/server-v11.js` según `backend/package.json`.
- Cada persona elige un repositorio personal autorizado para guardar sus transcripciones. La GitHub App es pública e instalable en otras cuentas, pero la instalación de GUSL1GHT sigue limitada a [AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS). `sources/aeterna/inbox/` conserva fuentes históricas.

## Probar en Windows

1. Instalar Node.js 22 o superior y las dependencias de `backend/` (`npm install` o `pnpm install`).
2. Abrir la interfaz y pulsar **Conectar Gemini** para introducir la clave propia. Para iniciar sesión con GitHub se requieren `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` y una GitHub App instalada solo en `AETERNA-TRANSCRIPTS` con permiso Contents de escritura.
3. Ejecutar `tools/run-dev.ps1`. Abre la web en `http://127.0.0.1:8080/` y la API en `http://127.0.0.1:3000/`.
4. Consultar `tools/check-dev.ps1` y detener con `tools/stop-dev.ps1`.

No se guardan credenciales en el repositorio. Cada usuario externo necesita su propia clave de Gemini para transcribir. La clave introducida se envía al backend por HTTPS y queda únicamente en memoria del proceso; el navegador recuerda solo un identificador de sesión. Tras reiniciar o dormir Render habrá que conectarla de nuevo. La `GEMINI_API_KEY` ya configurada en Render solo se usa para la cuenta GUSL1GHT tras verificar su sesión de GitHub; otras cuentas nunca acceden a esa cuota. Cada persona instala la GitHub App únicamente en los repositorios que elija.

Al conectar una clave de Gemini, el backend consulta los modelos disponibles para esa clave. Prefiere los modelos Flash actuales en cuentas nuevas y conserva la preferencia por los modelos 2.5 en la cuenta propietaria, con alternativas si un modelo deja de estar disponible.

## Instalar como aplicación

La web pública es una PWA con icono propio. En Chrome para Android, abrir la URL de AETERNA y elegir **Instalar aplicación** en el menú del navegador, o pulsar **Instalar app** cuando aparezca en el pie de la interfaz. En Chrome de escritorio, usar **Instalar** en la barra de direcciones o en el menú. La instalación crea un icono y abre AETERNA en una ventana independiente; las transcripciones siguen necesitando Internet y el backend. No hace falta una APK para este uso. Una APK requeriría un empaquetado Android y firma adicionales.

## Despliegue y limpieza

GitHub Pages sirve la interfaz; Render sirve el backend. La URL pública es [AETERNA PRO](https://gusl1ght.github.io/AETERNA-PRO/). Los vídeos públicos de YouTube se envían directamente a Gemini; otras plataformas usan un extractor `yt-dlp` verificado. Se procesa vídeo cuando está disponible para comprobar los nombres visibles; si solo puede obtener audio, la interfaz lo indica. La interfaz acepta enlaces únicamente; el backend conserva su ruta de archivos sin exponerla en la web. La conexión GitHub usa autorización de usuario con PKCE: el token de GitHub permanece en memoria del backend y el navegador conserva un identificador de sesión temporal. El servidor deja de aceptar escrituras anónimas con su antiguo `GITHUB_TOKEN`.

La URL se vacía después de una transcripción correcta y se conserva si falla, para permitir el reintento. Durante la transcripción por URL, la barra sustituye los botones y muestra un porcentaje **estimado**: se ajusta con las últimas cinco duraciones satisfactorias del mismo tipo de plataforma, guardadas solo en el navegador. El backend no facilita avance real, por lo que la barra se limita al 95 % hasta recibir el resultado.

**Transcribir vídeo** procesa el audio y el texto informativo visible en una sola acción. Los enlaces cortos de TikTok se resuelven antes de elegir la ruta: si llevan a una publicación de imágenes, estas se envían a Gemini en orden sin intentar descargarlas como vídeo. Las imágenes se agrupan en lotes de hasta seis. El texto pequeño o fugaz puede aparecer como `[ilegible]` y requiere revisión. Los PDF no están admitidos.

Tras obtener un resultado, **Compartir** usa el menú de compartir del dispositivo cuando existe; en otros navegadores copia el texto para pegarlo en otra aplicación. En local, la web y la API deben arrancarse juntas con `tools/run-dev.ps1`; abrir solo `127.0.0.1:8080` produce un error de conexión.

La interfaz ocupa la altura disponible de la ventana. Las transcripciones largas se desplazan dentro del panel de texto, mientras que los botones Descargar archivo y Compartir permanecen visibles. Guardar en GitHub requiere activar explícitamente la casilla junto al repositorio elegido antes de transcribir. En pantallas pequeñas se muestra primero el resultado y se puede volver al formulario con el botón superior.

Después de transcribir, **Crear guía paso a paso** hace una petición de texto adicional a Gemini solo si se pulsa. Prefiere un modelo Flash-Lite disponible para reducir consumo. La guía aparece en una pestaña separada y la transcripción original se conserva; Descargar archivo y Compartir actúan sobre la pestaña visible. Si el vídeo no ofrece pasos suficientes, no se fabrica una guía. Los enlaces solo se incluyen si aparecen completos en la transcripción; los pasos ausentes se marcan para revisión. El punto de retorno anterior a esta función es la etiqueta `aeterna-v1.2-before-guides-20261024`.

Antes de limpiar ramas o archivos en GitHub, comprobar qué rama alimenta Pages y qué comando de inicio usa Render. No eliminar `backend/server.js` ni `backend/server-v11.js` hasta consolidar ambos despliegues. Las ramas beta y las transcripciones históricas siguen siendo datos útiles.
