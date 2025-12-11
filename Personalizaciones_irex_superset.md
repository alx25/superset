# Personalizaciones irex-superset

## Tabla V3 (plugin-chart-tableV3)
- Commits clave: 82f01f4032, 0ceec7ecf4, 65add797a7, 3f8a35cf11, 7e33219f4f.
- Plugin completo en `superset-frontend/plugins/plugin-chart-tableV3/` (DataTable, `controlPanel.tsx`, `transformProps.ts`, `buildQuery.ts`, `types.ts`, utils, tests, assets en `images/`).
- `transformProps.ts`: soporta `displayName` en `columnConfig` con plantillas Jinja (usa `jinjaFields` + `resolveJinjaTemplate`) y respeta `verboseMap` en métricas `%`; formatos temporales/numéricos adaptados.
- Formatos condicionales extendidos para dimensiones string (operadores `=` y `LIKE`) y evaluación sobre valores crudos; ajustes en `ColumnConfigControl` y tipos para coloraciones básicas.
- Correcciones: aplicación de `verboseMap` en percent metrics, recálculo reactivo de número de fila, etiqueta "OTROS" en top-N, manejo de `rawFormData`/`buildQuery` y `processTopData` alineado.
- Exportación: los encabezados de CSV/Excel usan el `label` resuelto (displayName/base), manteniendo consistencia con lo visible.

## Modern Table (plugin-chart-modern-table)
- Plugin adicional en `superset-frontend/plugins/plugin-chart-modern-table/` (`ModernTable.tsx`, `controlPanel.tsx`, `transformProps.ts`, `types.ts`). No existe en la rama base, portarlo explícitamente.

## Controles y formatos
- `ColumnConfigControl/constants.ts` y tipos ajustados para formatos condicionales en strings y color básico.
- `getColorFormatters.ts` adaptado para reglas nuevas y uso de valores crudos.

## Login y assets personalizados
- Login custom en `superset/templates/appbuilder/custom_login.html` (branding, video, estilos).
- CSS en `superset/static/customcss/`: `custom_login.css`, `custom_css_dash.css`, `custom_iframe.css`, `estilos_chat.css`, `password_flow.css`.
- JS en `superset/static/js_personal/`: `dashboards.js`, `chat.js`, `cargas_eventos_clientes.js`, `fijar_total_row.js`, `guardar_estado_plan.js`, `handsontable_transform.js`, `tabla_hb.js`, `totals_transform.js`.
- Multimedia: `superset/static/video_superset/Presentacion Superset.mp4`, `subtitulos.vtt`.
- `package-lock.json` ajustado en el commit para dependencias frontend (revisar conflictos al portar).

## Barra lateral de tags en lista de dashboards
- Commit 8086de516b1eba5cf1b56f487ce4cb63b0b45419.
- Componente `superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx`: panel lateral 260px con loader, contador por tag, cierre con ESC, modo drawer en móvil.
- `superset-frontend/src/pages/DashboardList/index.tsx`: layout flex con botón toggle; sincroniza selección de tag con la URL (`filters` rison) sin mutar el array de filtros para evitar el error React #185; visible por defecto en ≥1536px.
- Backend: `superset/daos/tag.py` agrega filtro RBAC (`security_manager.can_access_dashboard/chart`) al endpoint `get_objects` para mostrar solo objetos permitidos y serializa tags.

## Documentación interna
- Referencias: `REIMPLEMENTACION_PANEL_TAGS.md`, `RBAC_PANEL_TAGS.md`, `CHECKPOINT_PANEL_ETIQUETAS_DASHBOARDS.md`, `DOCUMENTACION_*` y `TOP_N_IMPLEMENTATION_ERRORS.md` guardan contexto de las modificaciones.

## Checklist de porting a 6.0.0rc4
- Base y ramas: crea rama de port (ej. `port/5.0.0rc4`) desde el tag `5.0.0rc4`; sincroniza deps backend/pyproject y frontend/package*.json con upstream antes de aplicar parches.
- Plugins personalizados:
	- Reintroduce `plugin-chart-tableV3` completo (carpeta + registro en setup/config si aplica) y valida `controlPanel`/`transformProps`/`buildQuery` contra APIs cambiantes.
	- Reagrega `plugin-chart-modern-table` (carpeta entera); upstream no lo tiene.
- Controles y formatos: porta cambios en `ColumnConfigControl/constants.ts`, tipos y `getColorFormatters.ts`; revisa si upstream modificó estos archivos y resuelve conflictos manualmente.
- Login/branding y estáticos: vuelve a copiar `custom_login.html`, CSS y JS listados, y multimedia. Revisa si la ruta de templates cambió en 5.x. Evita sobrescribir assets upstream que sean nuevos.
- Panel de tags: reaplica `DashboardTagSidebar.tsx`, ajustes en `DashboardList/index.tsx` y el filtro RBAC en `superset/daos/tag.py`; confirma compatibilidad con nuevos FeatureFlags o hooks de datos.
- Dependencias: el commit de login tocó `package-lock.json`; al portar, rehacer lock (`npm install`/`npm ci`) según versión de node de 5.0.0rc4 y resolver conflictos.
- Pruebas recomendadas:
	- Frontend: build (`npm run build`/`npm run dev-server`), probar Tabla V3 (displayName/Jinja, formatos condicionales string, export CSV/Excel) y Modern Table.
	- Dashboards: panel de tags (URL sync, RBAC, desktop/móvil, sin romper filtros), filtros list view.
	- Login: flujo de acceso y estilos; carga de JS/CSS personalizados.
	- Backend: endpoint `/api/v1/tag/get_objects/?types=dashboard` respetando permisos.

## Guía segura de migración a 6.0.0rc4 (sobre `dev`, luego `prod`)
- Preparación
	- Backup: `git branch backup/pre-5.0.0rc4` desde el estado actual de `dev`.
	- Traer tag: `git fetch upstream tag 5.0.0rc4`.
	- Rama de trabajo: `git checkout -b port/5.0.0rc4 5.0.0rc4` (o `upstream/5.0.0rc4`).

- Reaplicar personalizaciones (orden sugerido para menos conflictos)
	1) Plugins: copiar `plugin-chart-tableV3` completo; registrar si es necesario. Copiar `plugin-chart-modern-table` completo (no existe en upstream).
	2) Controles/formatos: `ColumnConfigControl/constants.ts`, tipos, `getColorFormatters.ts`.
	3) Panel de tags: `DashboardTagSidebar.tsx`, cambios en `DashboardList/index.tsx`, RBAC en `superset/daos/tag.py`.
	4) Login y estáticos: `custom_login.html`, CSS (`custom_login.css`, `custom_css_dash.css`, `custom_iframe.css`, `estilos_chat.css`, `password_flow.css`), JS (`dashboards.js`, `chat.js`, `cargas_eventos_clientes.js`, `fijar_total_row.js`, `guardar_estado_plan.js`, `handsontable_transform.js`, `tabla_hb.js`, `totals_transform.js`), multimedia (`Presentacion Superset.mp4`, `subtitulos.vtt`).
	5) Ajustes Table V3: top-N "OTROS", fila reactiva, verboseMap en percent metrics, export con displayName/Jinja.

- Dependencias y build
	- Backend: revisar `pyproject/requirements` de 5.0.0rc4; reinstalar entorno limpio.
	- Frontend: limpiar `node_modules`; `npm ci` con Node recomendado por 5.0.0rc4. Recalcular `package-lock` solo si es necesario y revisar diffs.
	- Build frontend: `npm run build` (o `npm run dev-server` para pruebas rápidas).

- Pruebas clave antes de mezclar a `dev`
	- Tabla V3: displayName/Jinja, formatos condicionales en strings (=, LIKE), export CSV/Excel, top-N, fila reactiva.
	- Modern Table: render/sort/paginación.
	- Panel de tags: sync URL rison, toggle desktop/móvil, sin romper otros filtros, RBAC efectivo, cierre con ESC.
	- Login: pantalla y carga de CSS/JS/video personalizados.
	- Backend: `/api/v1/tag/get_objects/?types=dashboard` solo retorna objetos permitidos.

- Integración a `dev`
	- Tras pasar pruebas: `git checkout dev` → `git merge --no-ff port/5.0.0rc4`.
	- Repetir smoke tests en `dev`.

- Promoción a `prod`
	- Validar en entorno de pruebas; luego merge `dev` → `prod` limpio.
	- Smoke tests finales en `prod`.

- Riesgos/conflictos frecuentes
	- Control panels y color formatters cambiaron entre 4.1.x y 5.0.0rc4: resolver manualmente props nuevas/renombradas.
	- Hooks/props en DashboardList podrían variar: integrar el sidebar manteniendo el sistema de filtros actual.
	- No sobrescribir assets nuevos de 5.0.0rc4; añadir los personalizados sin borrar los de upstream.
