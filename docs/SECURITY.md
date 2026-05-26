# Seguridad de AETERNA PRO

## Regla principal

No guardar claves privadas dentro del repositorio.

## Estado actual

La version actual es una web estatica pensada para GitHub Pages. Permite introducir una clave de Gemini desde el navegador y guardarla en el dispositivo mediante localStorage.

Esto evita subir la clave al repositorio, pero no convierte la solucion en una arquitectura segura de produccion.

## Riesgo principal

Toda aplicacion que llama a una API desde el navegador expone mas superficie de riesgo que una arquitectura con backend.

## Arquitectura recomendada para produccion

1. Frontend estatico en GitHub Pages.
2. Backend seguro propio.
3. La clave de Gemini guardada solo en el backend como variable de entorno.
4. El frontend llama al backend, no directamente a Gemini.

## Prohibido

- No pegar claves reales en index.html.
- No hacer commits con claves.
- No publicar capturas que muestren claves.
- No guardar secretos en README, issues o comentarios.
