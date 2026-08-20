- Personalizaciones superset

- Vista Dashboard: Se integro una barra vertical a la izquierda de la lista de dashboards, que muestra las etiquetas (tags) disponibles, al presionar actúa como filtro para los dashboards (al presionar en la barra, cambia en la lista de filtros). Además se integran los filtros DASHBOARD_RBAC, para que el usuario logueado solo pueda ver los tags a los que tiene acceso y no todos. La barra debe ser responsiva para teléfonos y pantallas.

-  Grafico personalizado tableV3 (plugin-chart-tableV3): se monto sobre la base del plugin "plugin-chart-table", lo que hace es mejorar las capacidades del grafico de tabla y añade varias mejoras:

 Plugin completo en `superset-frontend/plugins/plugin-chart-tableV3/` (DataTable, `controlPanel.tsx`, `transformProps.ts`, `buildQuery.ts`, `types.ts`, utils, tests, assets en `images/`).
- `transformProps.ts`: soporta `displayName` en `columnConfig` con plantillas Jinja (usa `jinjaFields` + `resolveJinjaTemplate`) y respeta `verboseMap` en métricas `%`; formatos temporales/numéricos adaptados.
- Formatos condicionales extendidos para dimensiones string (operadores `=` y `LIKE`) y evaluación sobre valores crudos; ajustes en `ColumnConfigControl` y tipos para coloraciones básicas.
- Correcciones: aplicación de `verboseMap` en percent metrics, recálculo reactivo de número de fila, etiqueta "OTROS" en top-N, manejo de `rawFormData`/`buildQuery` y `processTopData` alineado.
- Exportación: los encabezados de CSV/Excel usan el `label` resuelto (displayName/base), manteniendo consistencia con lo visible.

Controles y formatos
- `ColumnConfigControl/constants.ts` y tipos ajustados para formatos condicionales en strings y color básico.
- `getColorFormatters.ts` adaptado para reglas nuevas y uso de valores crudos.