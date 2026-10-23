# AETERNA PRO

Aplicación web y PWA para transcribir enlaces de vídeos o publicaciones y, opcionalmente, guardar la transcripción en GitHub.

## Estado

- La interfaz Beta v1.2 y la transcripción por URL se despliegan desde `beta-v1.1-url-whisper` (nombre histórico de la rama configurada en Pages y Render).
- `main` contiene una versión anterior que solo admite archivos.
- El backend de Beta v1.2 arranca con `backend/server-v11.js` según `backend/package.json`.
- El usuario elige un repositorio autorizado para guardar las transcripciones. En la instalación actual, la GitHub App es privada y solo funciona con la cuenta GUSL1GHT; [AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS) es la biblioteca elegida. `sources/aeterna/inbox/` conserva fuentes históricas.

## Probar en Windows

1. Instalar Node.js 22 o superior y las dependencias de `backend/` (`npm install` o `pnpm install`).
2. Configurar `GEMINI_API_KEY` en el entorno local para transcribir. Para iniciar sesión con GitHub se requieren `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` y una GitHub App instalada solo en `AETERNA-TRANSCRIPTS` con permiso Contents de escritura.
3. Ejecutar `tools/run-dev.ps1`. Abre la web en `http://127.0.0.1:8080/` y la API en `http://127.0.0.1:3000/`.
4. Consultar `tools/check-dev.ps1` y detener con `tools/stop-dev.ps1`.

No se guardan credenciales en el repositorio. Sin clave de Gemini se puede verificar la interfaz y la conexión con la API, pero no una transcripción real.

## Instalar como aplicación

La web pública es una PWA con icono propio. En Chrome para Android, abrir la URL de AETERNA y elegir **Instalar aplicación** en el menú del navegador, o pulsar **Instalar app** cuando aparezca en el pie de la interfaz. En Chrome de escritorio, usar **Instalar** en la barra de direcciones o en el menú. La instalación crea un icono y abre AETERNA en una ventana independiente; las transcripciones siguen necesitando Internet y el backend. No hace falta una APK para este uso. Una APK requeriría un empaquetado Android y firma adicionales.

## Despliegue y limpieza

GitHub Pages sirve la interfaz; Render sirve el backend. La URL pública es [AETERNA PRO](https://gusl1ght.github.io/AETERNA-PRO/). Los vídeos públicos de YouTube se envían directamente a Gemini; otras plataformas usan un extractor `yt-dlp` verificado. Se procesa vídeo cuando está disponible para comprobar los nombres visibles; si solo puede obtener audio, la interfaz lo indica. La interfaz acepta enlaces únicamente; el backend conserva su ruta de archivos sin exponerla en la web. La conexión GitHub usa autorización de usuario con PKCE: el token de GitHub permanece en memoria del backend y el navegador conserva un identificador de sesión temporal. El servidor deja de aceptar escrituras anónimas con su antiguo `GITHUB_TOKEN`.

La URL se vacía después de una transcripción correcta y se conserva si falla, para permitir el reintento. Durante la transcripción por URL, la barra sustituye los botones y muestra un porcentaje **estimado**: se ajusta con las últimas cinco duraciones satisfactorias del mismo tipo de plataforma, guardadas solo en el navegador. El backend no facilita avance real, por lo que la barra se limita al 95 % hasta recibir el resultado.

El botón **Extraer texto visible del vídeo** usa un modo independiente para vídeos con pantallas o diapositivas informativas. Solicita texto visible en orden temporal, con marcas de tiempo aproximadas, sin usar la voz ni traducir el contenido. Las publicaciones de fotos de TikTok (`/photo/`) siguen una ruta específica: se recuperan las imágenes originales en orden y se envían a Gemini en grupos de hasta seis. `yt-dlp` no admite ese tipo de enlace. Si el extractor de un vídeo solo obtiene audio, la extracción visual informa de que no hay imágenes disponibles para ese enlace. El botón original **Transcribir URL** mantiene su comportamiento y avisa cuando recibe una publicación de fotos. El modo visual depende de la calidad de las imágenes o fotogramas; hay que revisar textos rápidos, pequeños o marcados como `[ilegible]`. Los PDF no están admitidos. Para retirarlo, basta con volver a la rama `codex/recover-v11`.

Tras obtener un resultado, **Compartir** usa el menú de compartir del dispositivo cuando existe; en otros navegadores copia el texto para pegarlo en otra aplicación. En local, la web y la API deben arrancarse juntas con `tools/run-dev.ps1`; abrir solo `127.0.0.1:8080` produce un error de conexión.

La interfaz ocupa la altura disponible de la ventana. Las transcripciones largas se desplazan dentro del panel de texto, mientras que los botones TXT y Compartir permanecen visibles. Solo **Transcribir y guardar en GitHub** guarda automáticamente en el repositorio elegido; **Transcribir URL** y **Extraer texto visible del vídeo** no guardan. En pantallas pequeñas se muestra primero el resultado y se puede volver al formulario con el botón superior.

Antes de limpiar ramas o archivos en GitHub, comprobar qué rama alimenta Pages y qué comando de inicio usa Render. No eliminar `backend/server.js` ni `backend/server-v11.js` hasta consolidar ambos despliegues. Las ramas beta y las transcripciones históricas siguen siendo datos útiles.
