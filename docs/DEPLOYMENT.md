# Despliegue de AETERNA PRO en GitHub Pages

## Objetivo

Publicar AETERNA PRO como web app accesible desde ordenador y movil.

## Requisitos

- Repositorio con los archivos en la rama `beta-v1.1-url-whisper`, nombre histórico desde el que se publica Beta v1.2.
- GitHub Pages activado.
- Repositorio publico para publicacion sencilla.

## Activar GitHub Pages

1. Entrar en Settings del repositorio.
2. Abrir Pages.
3. En Build and deployment seleccionar Deploy from a branch.
4. Branch: `beta-v1.1-url-whisper`.
5. Folder: / root.
6. Guardar.

## URL esperada

Cuando GitHub Pages termine de desplegar, la URL normal sera:

```txt
https://gusl1ght.github.io/AETERNA-PRO/
```

## Instalacion en movil

### Android / Chrome

1. Abrir la URL de AETERNA PRO.
2. Pulsar los tres puntos del navegador.
3. Elegir Instalar aplicacion o Anadir a pantalla de inicio.

### iPhone / Safari

1. Abrir la URL de AETERNA PRO.
2. Pulsar Compartir.
3. Elegir Anadir a pantalla de inicio.

## Validacion

- La pagina carga.
- El manifest se detecta.
- El icono se muestra.
- La app permite seleccionar audio o video.
- La app no contiene claves privadas en el codigo.
- El backend de Render arranca con `backend/server-v11.js` y tiene `GEMINI_API_KEY` configurada.
- El arranque del backend registra la versión actualizada de `yt-dlp`.
- Una URL pública de TikTok llega a transcripción, no solo a descarga.
