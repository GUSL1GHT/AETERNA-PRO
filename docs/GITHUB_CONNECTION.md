# Conexión de GitHub para AETERNA

La interfaz permite elegir un repositorio autorizado. Por ahora la GitHub App es privada y solo la cuenta GUSL1GHT puede instalarla. La biblioteca actual es [GUSL1GHT/AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS).

## GitHub App

- Nombre sugerido: `AETERNA-Transcripts-Connector`.
- Página: `https://gusl1ght.github.io/AETERNA-PRO/`.
- Callback: `https://aeterna-pro-backend.onrender.com/api/github-auth/callback`.
- Visibilidad actual: privada. Solo cambiarla a pública si se decide abrir el uso a otras cuentas.
- Webhooks: desactivados.
- Permisos de repositorio: `Contents: Read and write`; los demás sin acceso adicional.
- El propietario instala la aplicación solo en los repositorios donde quiera guardar transcripciones. La selección de repositorio ya está preparada para una futura apertura a otros usuarios.

En Render, configurar `GITHUB_APP_CLIENT_ID` y `GITHUB_APP_CLIENT_SECRET` como variables de entorno del servicio de backend. El secreto se genera en la configuración de la GitHub App y no se guarda en Git ni se pega en el chat. El ID de cliente no es secreto.

Tras el despliegue, pegar primero el enlace. **Conectar GitHub** es opcional y aparece al final del formulario. Si no aparece ningún repositorio, usar **Añadir repositorio** para autorizar uno y después **Actualizar lista**. El propietario elige en **Guardar en** dónde irán sus transcripciones. Las credenciales del servidor se configuran una sola vez; el usuario no copia claves. El identificador de sesión y el repositorio elegido se recuerdan en ese navegador hasta desconectar. Otro navegador requiere su propia autorización; si Render reinicia el proceso, la sesión del servidor se pierde y habrá que conectar de nuevo.

## Comprobación

1. Sin conectar, el campo del enlace aparece primero; después **Transcribir URL**, **Leer texto de las imágenes** y al final **Conectar GitHub**. El resultado ofrece **TXT** y **Compartir**. No aparece la subida manual.
2. Conectar la cuenta y comprobar que aparecen sus repositorios autorizados; seleccionar uno.
3. Pulsar **Transcribir URL** y comprobar que no se crea un archivo en GitHub. Pulsar **Transcribir y guardar en GitHub** con un enlace público y comprobar que se crea un Markdown en `transcripts/AAAA/MM/` del repositorio elegido.
4. Desconectar y comprobar que desaparecen las acciones de guardado. Una llamada de guardado sin sesión debe responder `401`.
