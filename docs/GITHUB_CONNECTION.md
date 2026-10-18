# Conexión de GitHub para AETERNA

La biblioteca pública de fuentes es [GUSL1GHT/AETERNA-TRANSCRIPTS](https://github.com/GUSL1GHT/AETERNA-TRANSCRIPTS). La aplicación web solo muestra los botones de guardado cuando el usuario ha iniciado sesión mediante una GitHub App propia.

## GitHub App

- Nombre sugerido: `AETERNA-Transcripts-Connector`.
- Página: `https://gusl1ght.github.io/AETERNA-PRO/`.
- Callback: `https://aeterna-pro-backend.onrender.com/api/github-auth/callback`.
- Visibilidad: solo esta cuenta.
- Webhooks: desactivados.
- Permisos de repositorio: `Contents: Read and write`; los demás sin acceso adicional.
- Instalar únicamente en `AETERNA-TRANSCRIPTS`.

En Render, configurar `GITHUB_APP_CLIENT_ID` y `GITHUB_APP_CLIENT_SECRET` como variables de entorno del servicio de backend. El secreto se genera en la configuración de la GitHub App y no se guarda en Git ni se pega en el chat. El ID de cliente no es secreto.

Tras el despliegue, abrir AETERNA, elegir **Conectar GitHub** y autorizar la aplicación. La sesión temporal se guarda en la pestaña del navegador; si Render reinicia el proceso o se cierra la pestaña, puede ser necesario conectar de nuevo. Solo se acepta la cuenta `GUSL1GHT` y el backend solo escribe en `AETERNA-TRANSCRIPTS`.

## Comprobación

1. Sin conectar, solo debe aparecer **Transcribir URL**, además de **Conectar GitHub**. Una transcripción sigue permitiendo **Copiar** y **TXT**.
2. Conectar la cuenta y comprobar que aparece `GitHub conectado: GUSL1GHT`.
3. Transcribir un enlace público, guardar y comprobar que se creó un Markdown en `transcripts/AAAA/MM/` de la biblioteca.
4. Desconectar y comprobar que desaparecen las acciones de guardado. Una llamada de guardado sin sesión debe responder `401`.
