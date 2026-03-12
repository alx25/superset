# Plan de migración: personalizaciones a superset_v6

Fecha: 2026-01-29

## Objetivo
Replicar en superset_v6 las personalizaciones descritas en [personalizaciones.md](personalizaciones.md), tomando como referencia la implementación existente en superset6_test.

## Alcance
1) Vista Dashboard: barra vertical de tags/categorías a la izquierda, con integración de permisos (DASHBOARD_RBAC / `can_read` en Tag) y comportamiento responsivo.
2) Gráfico personalizado tableV3 (plugin-chart-tableV3): plugin completo con mejoras en control panel, transformaciones, formatos y exportación.

## Fuente de verdad (superset6_test)
### Vista Dashboard (barra de tags)
- Página de lista de dashboards: [superset6_test/superset-frontend/src/pages/DashboardList/index.tsx](superset6_test/superset-frontend/src/pages/DashboardList/index.tsx)
  - Importa y renderiza la barra: [DashboardList render + sidebar](superset6_test/superset-frontend/src/pages/DashboardList/index.tsx#L860-L955)
  - Manejo de filtros por tags con `rison` y `filters` en URL: [helpers](superset6_test/superset-frontend/src/pages/DashboardList/index.tsx#L190-L330)
  - Control responsivo (mostrar/ocultar): [estado + botón](superset6_test/superset-frontend/src/pages/DashboardList/index.tsx#L190-L210) y [SubMenu con toggle](superset6_test/superset-frontend/src/pages/DashboardList/index.tsx#L860-L900)
- Componente de barra: [superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx](superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx)
  - Carga de tags y conteos por dashboard: [fetchTags](superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx#L163-L259)
  - Renderizado + estilos responsivos: [estilos y UI](superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx#L34-L162) y [render](superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx#L261-L357)

### Plugin tableV3
- Plugin completo: superset6_test/superset-frontend/plugins/plugin-chart-tableV3/
- Registro en presets: [superset6_test/superset-frontend/src/visualizations/presets/MainPreset.js](superset6_test/superset-frontend/src/visualizations/presets/MainPreset.js)
  - Import de plugin: [TableV3 import](superset6_test/superset-frontend/src/visualizations/presets/MainPreset.js#L29-L40)
  - Registro en `plugins`: [TableV3 configure](superset6_test/superset-frontend/src/visualizations/presets/MainPreset.js#L132-L145)

## Plan de migración (superset_v6)
### Fase 0 — Preparación
- Confirmar que superset_v6 compila y corre (ya completado: backend + frontend).
- Hacer backup de superset_v6 antes de aplicar cambios.

### Fase 1 — Vista Dashboard con barra de tags
1) Crear nuevo componente en superset_v6:
   - Copiar [superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx](superset6_test/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx) a:
     - superset_v6/superset-frontend/src/features/dashboards/DashboardTagSidebar.tsx
2) Modificar lista de dashboards en superset_v6:
   - Portar cambios de [superset6_test/superset-frontend/src/pages/DashboardList/index.tsx](superset6_test/superset-frontend/src/pages/DashboardList/index.tsx)
   - Verificar:
     - Import del nuevo componente.
     - Helpers `getCurrentTagId` / `handleTagSelect`.
     - Toggle de sidebar en SubMenu.
     - Layout con `PageLayout` + `ListArea`.
3) Validación funcional:
   - Con `TAGGING_SYSTEM` habilitado y `can_read` en Tag, aparecen categorías.
   - Al hacer click en tag, se actualiza `filters` en URL y la lista se filtra.
   - En móvil: sidebar oculto por defecto, botón lo muestra.

### Fase 2 — Plugin tableV3
1) Copiar plugin a superset_v6:
   - Copiar carpeta completa:
     - superset6_test/superset-frontend/plugins/plugin-chart-tableV3/ → superset_v6/superset-frontend/plugins/plugin-chart-tableV3/
2) Registrar plugin:
   - Replicar registro en:
     - superset_v6/superset-frontend/src/visualizations/presets/MainPreset.js
     - Asegurar import y `new TableV3ChartPlugin().configure({ key: VizType.TableV3 })`.
3) Características a validar (TableV3):
  - Render de columnas con HTML + Jinja.
  - `displayName` personalizable con Jinja en `columnConfig`.
  - `verboseMap` aplicado en métricas `%`.
  - Formatos condicionales para strings (`=` y `LIKE`) usando valores crudos.
  - Export CSV/Excel con encabezados resueltos (displayName/base).
3) Verificar dependencias:
   - Revisar `package.json` y workspaces en superset_v6 para incluir plugin.
   - Ejecutar `npm ci` y `npm run build`.
4) Validación funcional:
   - El gráfico TableV3 aparece en el selector de visualizaciones.
   - Exportación CSV/Excel con headers visibles.
   - `displayName` con Jinja y `verboseMap` en métricas `%` funcionando.

### Fase 3 — Ajustes finos y QA
- Ajustar estilos y textos si hay diferencias de tema.
- Pruebas de permisos RBAC para tags.
- Verificar que no impacta lista de dashboards sin tags.

## Riesgos y mitigaciones
- Diferencias en APIs/estructura entre superset6_test y superset_v6.
  - Mitigación: revisar compilación TS y ejecutar tests del frontend.
- Conflictos con cambios propios en DashboardList.
  - Mitigación: aplicar cambios mínimos y documentar diffs.

## Checklist de validación
- [ ] Sidebar visible solo con permisos de tags.
- [ ] Filtro por tag actualiza URL y lista.
- [ ] Responsivo en móvil.
- [ ] TableV3 disponible en selector.
- [ ] Export CSV/Excel consistente con labels.

## Bitácora
- 2026-01-29: Plan creado. Se identificaron archivos fuente en superset6_test y rutas destino en superset_v6.
- 2026-01-29: Iniciada Fase 1. Se añadió el componente de barra de tags y se integró en DashboardList con mejoras de UX (búsqueda, overlay móvil, toggle).
- 2026-01-29: Iniciada Fase 2. Se copió plugin-chart-tableV3 y se registró en MainPreset.
- 2026-01-29: Se agregó dependencia workspace de TableV3 en package.json y ajuste de tipado en TableChart para formatos condicionales con valores crudos.
- 2026-01-29: Se añadió VizType.TableV3 en superset-ui-core para registrar correctamente el plugin table_v3.
- 2026-01-29: Se sincronizaron controles de ColumnConfigControl (displayName + HTML template) para que aparezcan en Customize.
- 2026-01-29: Se añadió soporte de variables locales con `{% set %}` en plantillas HTML/Jinja de TableV3.
- 2026-01-29: Se ajustó `{% set %}` para mantener valores crudos en comparaciones y valores formateados en el render.
- 2026-01-29: TableV3: se quitaron mayúsculas forzadas en headers, se reforzó negrita en encabezados y fila de resumen, y se añadió resaltado visual para la fila “OTROS” en Top N.
- 2026-01-29: TableV3: se intentó opción para ordenar “Otros” por valor, pero se retiró al no funcionar de forma fiable; se mantuvo el resaltado en filas con franjas.- 2026-01-30: TableV3: la columna métrica utilizada para ordenamiento en Top N ahora se oculta automáticamente de la tabla cuando Top N está habilitado.- 2026-01-30: TableV3: la exportación CSV/Excel ahora usa los nombres personalizados (Display name) configurados en "Customize columns" en lugar de los nombres reales de los campos. Si no hay Display name configurado, se usa el nombre del campo.- 2026-01-30: Se agregó el campo `column_display_names` al schema ChartDataExtrasSchema para permitir el envío de nombres personalizados de columnas desde el frontend al backend.
- 2026-01-30: TableV3: se agregó procesamiento de plantillas Jinja en los Display names para exportación CSV/Excel. Las expresiones {{variable}} ahora se resuelven con los valores reales de los datos antes de generar el archivo.
