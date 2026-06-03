# Importación y cambios (Rx1)

Fecha: 2026-02-05
Origen: `superset_v6/superset-frontend/plugins/plugin-chart-pivot-table`
Destino: `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1`

## Copia
- Se clonó el plugin original como base para Rx1.

## Cambios dentro del plugin
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/package.json`
  - Nuevo nombre de paquete: `@superset-ui/plugin-chart-pivot-table-rx1`.
  - Versión: `0.20.3-rx1.0`.
  - Metadatos de repositorio/homepage apuntan a la nueva carpeta.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/index.ts`
  - Clase `PivotTableChartPluginRx1`.
  - Nombre visible: `Pivot Table Rx1`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/index.ts`
  - Exporta `PivotTableChartPluginRx1`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/test/index.test.ts`
  - Ajuste del nombre del plugin y export.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/README.md`
  - Documentación y ejemplos con `pivot_table_rx1`.
  - Nueva sección de métricas derivadas (Jinja-like).
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
  - Nuevo control `metricFormulas` basado en lista (tipo metrics) para definir fórmulas con `{{Metric}}` y formato D3 por métrica.
  - Se movió a la pestaña **Datos** y se normaliza el valor para evitar errores cuando el dato llega como string u objeto (se aplica también en `onInit`).
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
  - Nuevo control `metricOrder` para reordenar métricas base y métricas de fórmula en un solo listado (drag & drop).
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
  - Nuevo control `column_config` (Customize columns) en la pestaña **Personalizar**.
  - Lista dinámica de columnas/filas/métricas (incluye métricas derivadas) y layout reducido a HTML template.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
  - Parseo de fórmulas en `formulaMetrics` (array) y soporte de `d3format`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
  - Se pasa `columnConfig` al chart para personalización por columna.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
  - Inclusión de métricas derivadas en la tabla, soporte de `metricKey` y formato D3 por fórmula.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
  - Respeta `metricOrder` para ordenar métricas y fórmulas en conjunto.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
  - Pasa `columnConfig` al renderer para HTML templates.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
  - Cálculo de métricas derivadas por celda y en totales, con formato aplicado.
  - Soporte de referencias a totales: `total.{{Metric}}`, `row.{{Metric}}`, `col.{{Metric}}`.
  - Soporte de funciones en fórmulas: `IF`, `OR`, `AND`, `NOT`, `ISBLANK`, `ABS`, `ROUND`, `MAX`, `MIN`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
  - Render HTML con templates por columna/fila/métrica (Jinja-like: `CASE`, `{% set %}`, `{{value}}`, `{{raw_value}}`).
  - Soporte de fórmulas en templates y accesos a `total./row./col.`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/utils/formatValue.ts`
  - Motor de templates HTML con `CASE`, `{% set %}` y evaluación de fórmulas.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/types.ts`
  - Tipos para `FormulaMetric` (incluye `d3format`) y `metricFormulas`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/types.ts`
  - Nuevo tipo `PivotColumnConfig` y propiedad `columnConfig`.
- `superset_v6/superset-frontend/src/explore/components/controls/FormulaMetricControl/index.tsx`
  - Control UI con popover + SQLEditor e intellisense para fórmulas y `{{Metric}}`.
  - Evita cierre del popover al aceptar sugerencias y normaliza `{{{{` -> `{{`.
  - Autocompletado agrega `total./row./col.` y se muestran ejemplos dentro del popover.
  - Autocompletado agrega funciones (`IF`, `OR`, `AND`, `NOT`, `ISBLANK`, `ABS`, `ROUND`, `MAX`, `MIN`) y ejemplos con condicionales.
  - Modal con explicación de funciones y ejemplos.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx`
  - `conditional_formatting` incluye también métricas de fórmula en la lista de columnas.
  - Nueva opción `Solid conditional colors` para colores sólidos en formato condicional.
  - `metricOrder` se actualiza automáticamente cuando cambian `metrics` o `metricFormulas`.
  - Nuevos controles de tema de tabla (encabezados, dimensiones, totales, celdas y bordes).
  - Toggle `Enable custom table theme` para volver al tema original rápidamente.
  - Los selectores de color ahora permiten limpiar el valor para volver al color original de esa sección.
  - Nuevo control `Jinja fields` (no se renderizan en la tabla; solo para fórmulas).
  - Validación: permitir guardar si hay métricas o si hay al menos 1 Jinja field y 1 fórmula.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/transformProps.ts`
  - Se calculan valores de métricas de fórmula para soportar formato condicional en campos derivados.
  - El formato condicional acepta modo sólido via `conditional_formatting_solid`.
  - Se transforma el tema de tabla a colores CSS y se pasa al renderer.
  - Compatibilidad con `formData` camelCase y `rawFormData` snake_case para colores del tema.
  - Si el tema está deshabilitado, se usa el estilo original por defecto.
  - Se incluyen `jinjaFields` en totales para permitir `total./row./col.` en fórmulas.
 - `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/plugin/buildQuery.ts`
  - Agrega `jinjaFields` al query sin mostrarlos en la tabla.
 - `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/PivotTableChart.tsx`
  - Incluye `jinjaFields` en el dataset interno pero los oculta del render.
 - `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
  - Filtra `jinjaFields` para que no se muestren en filas/columnas.
 - `superset_v6/superset-frontend/src/explore/components/controls/ColorPickerControl.tsx`
  - Soporta `allowClear` para limpiar un color y volver al valor por defecto.
- `superset_v6/superset-frontend/src/explore/components/controls/ControlPopover/ControlPopover.tsx`
  - Propaga el `event` en `onOpenChange` y respeta el modo controlado para no cerrar el popover por clics en autocompletado.
- `superset_v6/superset-frontend/src/explore/components/controls/index.ts`
  - Registro del nuevo control `FormulaMetricControl`.
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/Styles.js`
  - Soporta colores personalizados para encabezados, dimensiones, totales, celdas y bordes.
  - Aplica el tema usando los valores definidos en los controles (no variables CSS vacías).
- `superset_v6/superset-frontend/plugins/plugin-chart-pivot-tableRx1/src/react-pivottable/TableRenderers.jsx`
  - Inyecta el tema de la tabla al renderer para aplicar estilos personalizados.
  - Usa variables CSS (`--pvt-*`) para forzar la aplicación de los colores.

## Registro e integración en Superset
- `superset_v6/superset-frontend/package.json`
  - Dependencia local a `plugin-chart-pivot-tableRx1`.
- `superset_v6/superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts`
  - Nuevo `VizType.PivotTableRx1 = 'pivot_table_rx1'`.
- `superset_v6/superset-frontend/src/visualizations/presets/MainPreset.js`
  - Registro del plugin Rx1 con `VizType.PivotTableRx1`.
- `superset_v6/superset-frontend/src/explore/components/useExploreAdditionalActionsMenu/index.jsx`
  - Se agregó `VizType.PivotTableRx1` a exportaciones pivotadas.
- `superset_v6/superset-frontend/src/dashboard/components/SliceHeaderControls/index.tsx`
  - Reconoce Rx1 como tabla pivote para exportaciones.
- `superset_v6/superset-frontend/src/features/alerts/AlertReportModal.tsx`
  - Incluye Rx1 como visualización de texto.
- `superset_v6/superset-frontend/src/features/reports/ReportModal/index.tsx`
  - Incluye Rx1 como visualización de texto.
- `superset_v6/superset/charts/client_processing.py`
  - Se agregó `pivot_table_rx1` al post-procesado con la misma lógica que `pivot_table_v2`.

## Ajustes de build
- Se creó el enlace de workspace en `superset_v6/superset-frontend/node_modules/@superset-ui/plugin-chart-pivot-table-rx1`
  para que webpack resuelva el paquete local. Si se limpia `node_modules`, ejecutar `npm install` para regenerarlo.
