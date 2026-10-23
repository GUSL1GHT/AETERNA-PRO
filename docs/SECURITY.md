# Seguridad de AETERNA PRO

## Regla principal

No guardar claves privadas dentro del repositorio.

## Estado actual

La web de GitHub Pages permite introducir una clave propia de Gemini. La envía al backend por HTTPS para validarla y usarla; el backend la conserva únicamente en memoria. El navegador guarda en localStorage solo un identificador de sesión aleatorio, nunca la clave. Al reiniciarse o dormirse Render, hay que conectarla otra vez.

Quien introduzca una clave debe confiar en el operador del backend. La variable `GEMINI_API_KEY` de Render solo se utiliza tras verificar la sesión de GitHub de GUSL1GHT; las demás cuentas usan su propia clave.

## Riesgo principal

La URL de la web y de la API son públicas. Sin un control de acceso adicional, cualquier visitante con una clave propia de Gemini puede ocupar recursos del backend de Render. La GitHub App es pública, pero cada instalación solo obtiene los repositorios seleccionados por su propietario; el backend solo ofrece repositorios personales de la cuenta autenticada y vuelve a comprobar la selección al guardar.

## Arquitectura actual

1. Frontend estatico en GitHub Pages.
2. Backend seguro propio.
3. Cada usuario introduce su clave de Gemini; el backend la guarda temporalmente en memoria.
4. El frontend llama al backend, no directamente a Gemini.

## Prohibido

- No pegar claves reales en index.html.
- No hacer commits con claves.
- No publicar capturas que muestren claves.
- No guardar secretos en README, issues o comentarios.
