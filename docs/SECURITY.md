# Seguridad de AETERNA PRO

## Regla principal

No guardar claves privadas dentro del repositorio.

## Estado actual

La web de GitHub Pages permite introducir una clave propia de Gemini. La envía al backend por HTTPS para validarla y usarla. El backend devuelve una sesión cifrada y autenticada con una clave derivada de `SESSION_ENCRYPTION_SECRET`, o en su ausencia del secreto de la GitHub App o del cliente OAuth de Drive configurado en Render. El navegador guarda esa sesión cifrada en localStorage; no guarda la clave de Gemini en texto claro. La sesión dura como máximo 90 días y sobrevive a reinicios de Render. Las conexiones de GitHub y Drive usan el mismo mecanismo y renuevan sus tokens cuando caducan. Si cambia el secreto que cifra las sesiones, las anteriores dejan de funcionar y hay que conectar de nuevo.

Desconectar elimina la sesión de este navegador. Como el servidor no mantiene una lista persistente de revocación, una copia de la sesión cifrada seguiría siendo utilizable hasta caducar. Si se sospecha que alguien la ha copiado, hay que revocar la clave de Gemini o el acceso de GitHub o Google Drive correspondiente.

Quien introduzca una clave debe confiar en el operador del backend. La variable `GEMINI_API_KEY` de Render solo se utiliza tras verificar la sesión de GitHub de GUSL1GHT; las demás cuentas usan su propia clave.

## Riesgo principal

La URL de la web y de la API son públicas. Sin un control de acceso adicional, cualquier visitante con una clave propia de Gemini puede ocupar recursos del backend de Render. La GitHub App es pública, pero cada instalación solo obtiene los repositorios seleccionados por su propietario; el backend solo ofrece repositorios personales de la cuenta autenticada y vuelve a comprobar la selección al guardar.

La autorización de Google Drive usa el permiso reducido `drive.file`. Los documentos se guardan en el Drive de quien autoriza la cuenta, dentro de una carpeta creada por AETERNA. GitHub y Drive usan sesiones separadas; marcar ambos destinos no mezcla sus credenciales ni sus archivos.

## Arquitectura actual

1. Frontend estatico en GitHub Pages.
2. Backend seguro propio.
3. Cada usuario introduce su clave de Gemini una vez por navegador y periodo de sesión; el backend emite una sesión cifrada.
4. El frontend llama al backend, no directamente a Gemini.

## Prohibido

- No pegar claves reales en index.html.
- No hacer commits con claves.
- No publicar capturas que muestren claves.
- No guardar secretos en README, issues o comentarios.
