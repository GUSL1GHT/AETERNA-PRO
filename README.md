# AETERNA PRO

Aplicación web y PWA para transcribir enlaces o archivos de audio y vídeo y guardar la transcripción en GitHub.

## Estado

- La interfaz Beta v1.1 y la transcripción por URL están en `beta-v1.1-url-whisper`.
- `main` contiene una versión anterior que solo admite archivos.
- El backend de Beta v1.1 arranca con `backend/server-v11.js` según `backend/package.json`.
- `sources/aeterna/inbox/` contiene transcripciones, no copias de la aplicación.

## Probar en Windows

1. Instalar Node.js 20 o superior y las dependencias de `backend/` (`npm install` o `pnpm install`).
2. Configurar `GEMINI_API_KEY` en el entorno local para transcribir. `GITHUB_TOKEN` solo hace falta para listar repositorios o guardar en GitHub.
3. Ejecutar `tools/run-dev.ps1`. Abre la web en `http://127.0.0.1:8080/` y la API en `http://127.0.0.1:3000/`.
4. Consultar `tools/check-dev.ps1` y detener con `tools/stop-dev.ps1`.

No se guardan credenciales en el repositorio. Sin clave de Gemini se puede verificar la interfaz y la conexión con la API, pero no una transcripción real.

## Despliegue y limpieza

GitHub Pages sirve la interfaz; Render sirve el backend. La URL pública es [AETERNA PRO](https://gusl1ght.github.io/AETERNA-PRO/). Para reparar TikTok en Render hay que desplegar el backend actualizado y reconstruir sus dependencias para instalar un `yt-dlp` reciente. El backend también intentará actualizarlo una vez si detecta que la versión instalada tiene más de 90 días. Si la plataforma exige dependencias de impersonación adicionales, el archivo manual permanece disponible.

Antes de limpiar ramas o archivos en GitHub, comprobar qué rama alimenta Pages y qué comando de inicio usa Render. No eliminar `backend/server.js` ni `backend/server-v11.js` hasta consolidar ambos despliegues. Las ramas beta y las transcripciones históricas siguen siendo datos útiles.
