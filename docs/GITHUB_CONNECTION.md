# Conexión de GitHub para AETERNA

Cada usuario puede guardar en un repositorio de GitHub que haya autorizado para AETERNA. La biblioteca de GUSLIGHT es [GUSL1GHT/AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS).

## GitHub App

- Nombre sugerido: `AETERNA-Transcripts-Connector`.
- Página: `https://gusl1ght.github.io/AETERNA-PRO/`.
- Callback: `https://aeterna-pro-backend.onrender.com/api/github-auth/callback`.
- Visibilidad: pública para permitir instalaciones en otras cuentas.
- Webhooks: desactivados.
- Permisos de repositorio: `Contents: Read and write`; los demás sin acceso adicional.
- Cada usuario instala la aplicación solo en los repositorios donde quiera guardar transcripciones.

En Render, configurar `GITHUB_APP_CLIENT_ID` y `GITHUB_APP_CLIENT_SECRET` como variables de entorno del servicio de backend. El secreto se genera en la configuración de la GitHub App y no se guarda en Git ni se pega en el chat. El ID de cliente no es secreto.

Tras el despliegue, abrir AETERNA y elegir **Conectar GitHub**. Si no aparece ningún repositorio, usar **Añadir repositorio** para autorizar uno y después **Actualizar lista**. El usuario elige en **Guardar en** dónde irán sus transcripciones. Las credenciales del servidor se configuran una sola vez; los usuarios no copian claves. La sesión temporal se guarda en la pestaña del navegador; si Render reinicia el proceso o se cierra la pestaña, puede ser necesario conectar de nuevo.

## Comprobación

1. Sin conectar, solo debe aparecer **Transcribir URL**, además de **Conectar GitHub**. Una transcripción sigue permitiendo **Copiar** y **TXT**.
2. Conectar la cuenta y comprobar que aparecen sus repositorios autorizados; seleccionar uno.
3. Transcribir un enlace público, guardar y comprobar que se creó un Markdown en `transcripts/AAAA/MM/` del repositorio elegido.
4. Desconectar y comprobar que desaparecen las acciones de guardado. Una llamada de guardado sin sesión debe responder `401`.
