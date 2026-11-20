# Changelog

Todos los cambios de Trustux, de la versión más nueva a la más vieja. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con
[SemVer](https://semver.org/lang/es/). Cada deploy sube el patch y suma acá su sección: sin ella
el build no sale.

## [0.8.4] - 2026-11-20

### Nuevo
- **Cada deploy dice versión y qué cambia.** Lo primero que escribe el contenedor al levantar
  (los registros del servicio en EasyPanel) es un cartel con la versión, la fecha y la lista de
  cambios, sacada del CHANGELOG.
- **Novedades** en la interfaz: al entrar después de una actualización aparece una sola vez (por
  navegador) lo que cambió desde la última versión que viste. El historial queda en el menú,
  **Novedades**, y en **Acerca de**, con el enlace **Qué cambió**.
- Cada versión publicada tiene sus imágenes etiquetadas `:X.Y.Z` y `:X.Y.Z-full` (además de
  `:latest` y `:latest-full`) y su Release `vX.Y.Z` en GitHub con estas mismas notas.

### Cambiado
- Las imágenes corren sobre Node 24 LTS (`node:24-alpine` y, la full, `node:24-bookworm-slim`,
  fijadas por digest).
