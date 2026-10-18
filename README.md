# AETERNA PRO

Aplicación web y PWA para transcribir enlaces o archivos de audio y vídeo y guardar la transcripción en GitHub.

## Estado

- La interfaz Beta v1.1 y la transcripción por URL están en `beta-v1.1-url-whisper`.
- `main` contiene una versión anterior que solo admite archivos.
- El backend de Beta v1.1 arranca con `backend/server-v11.js` según `backend/package.json`.
- Las nuevas transcripciones se guardan en [AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS). `sources/aeterna/inbox/` conserva fuentes históricas.

## Probar en Windows

1. Instalar Node.js 22 o superior y las dependencias de `backend/` (`npm install` o `pnpm install`).
2. Configurar `GEMINI_API_KEY` en el entorno local para transcribir. Para iniciar sesión con GitHub se requieren `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` y una GitHub App instalada solo en `AETERNA-TRANSCRIPTS` con permiso Contents de escritura.
3. Ejecutar `tools/run-dev.ps1`. Abre la web en `http://127.0.0.1:8080/` y la API en `http://127.0.0.1:3000/`.
4. Consultar `tools/check-dev.ps1` y detener con `tools/stop-dev.ps1`.

No se guardan credenciales en el repositorio. Sin clave de Gemini se puede verificar la interfaz y la conexión con la API, pero no una transcripción real.

## Despliegue y limpieza

GitHub Pages sirve la interfaz; Render sirve el backend. La URL pública es [AETERNA PRO](https://gusl1ght.github.io/AETERNA-PRO/). Los vídeos públicos de YouTube se envían directamente a Gemini; otras plataformas usan un extractor `yt-dlp` verificado. Se procesa vídeo cuando está disponible para comprobar los nombres visibles; si solo puede obtener audio, la interfaz lo indica. Si falla un enlace, el archivo manual permanece disponible. La conexión GitHub usa autorización de usuario con PKCE: el token de GitHub permanece en memoria del backend y el navegador solo conserva un identificador de sesión temporal. El servidor deja de aceptar escrituras anónimas con su antiguo `GITHUB_TOKEN`.

La URL se vacía después de una transcripción correcta y se conserva si falla, para permitir el reintento. Durante la transcripción por URL, la barra sustituye los botones y muestra un porcentaje **estimado**: se ajusta con las últimas cinco duraciones satisfactorias del mismo tipo de plataforma, guardadas solo en el navegador. El backend no facilita avance real, por lo que la barra se limita al 95 % hasta recibir el resultado. La subida manual queda plegada como respaldo y muestra su porcentaje real; al 100 % todavía puede quedar procesamiento.

La interfaz ocupa la altura disponible de la ventana. Las transcripciones largas se desplazan dentro del panel de texto, mientras que los campos y los botones Copiar, TXT y GitHub permanecen visibles. En pantallas pequeñas se muestra primero el resultado y se puede volver al formulario con el botón superior.

Antes de limpiar ramas o archivos en GitHub, comprobar qué rama alimenta Pages y qué comando de inicio usa Render. No eliminar `backend/server.js` ni `backend/server-v11.js` hasta consolidar ambos despliegues. Las ramas beta y las transcripciones históricas siguen siendo datos útiles.
