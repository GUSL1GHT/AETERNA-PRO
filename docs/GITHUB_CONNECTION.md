# Conexión de GitHub para AETERNA

La interfaz permite elegir un repositorio autorizado. El backend solo ofrece y acepta repositorios personales propiedad de la cuenta de GitHub que inició sesión; no permite elegir repositorios de otro usuario ni de una organización. La GitHub App es pública y cualquier cuenta puede instalarla en sus repositorios elegidos. La instalación de GUSL1GHT continúa limitada a [GUSL1GHT/AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS).

## GitHub App

- Nombre sugerido: `AETERNA-Transcripts-Connector`.
- Página: `https://gusl1ght.github.io/AETERNA-PRO/`.
- Callback: `https://aeterna-pro-backend.onrender.com/api/github-auth/callback`.
- Visibilidad actual: pública. GitHub redirige a AETERNA después de instalarla o actualizar la selección de repositorios.
- Webhooks: desactivados.
- Permisos de repositorio: `Contents: Read and write`; los demás sin acceso adicional.
- El propietario instala la aplicación solo en los repositorios donde quiera guardar transcripciones. La selección de repositorio ya está preparada para una futura apertura a otros usuarios.

En Render, configurar `GITHUB_APP_CLIENT_ID` y `GITHUB_APP_CLIENT_SECRET` como variables de entorno del servicio de backend. El secreto se genera en la configuración de la GitHub App y no se guarda en Git ni se pega en el chat. El ID de cliente no es secreto.

Tras el despliegue, conectar primero la clave propia de Gemini y después pegar el enlace. **Conectar GitHub** aparece al final del formulario para quien quiera guardar transcripciones. Si no aparece ningún repositorio, usar **Añadir repositorio** para elegir uno en GitHub; al terminar, GitHub devuelve a AETERNA y carga la lista. El usuario elige en **Guardar en** dónde irán sus transcripciones. Las credenciales del servidor se configuran una sola vez; el usuario no copia claves de GitHub. El identificador de sesión y el repositorio elegido se recuerdan en ese navegador hasta desconectar. Otro navegador requiere su propia autorización; si Render reinicia el proceso, la sesión del servidor se pierde y habrá que conectar de nuevo.

## Comprobación

1. Sin conectar, aparece primero **Conectar Gemini** con una explicación; después el enlace y **Transcribir vídeo**. **Conectar GitHub** queda al final. El resultado ofrece **Descargar archivo** y **Compartir**. No aparece la subida manual.
2. Conectar la cuenta y comprobar que aparecen sus repositorios autorizados; seleccionar uno.
3. Pulsar **Transcribir vídeo** sin marcar la casilla de guardado y comprobar que no se crea un archivo en GitHub. Marcar **Guardar esta transcripción en GitHub**, transcribir otro enlace público y comprobar que se crea un Markdown en `transcripts/AAAA/MM/` del repositorio elegido.
4. Desconectar y comprobar que desaparecen las acciones de guardado. Una llamada de guardado sin sesión debe responder `401`.
