# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Catálogo de nombres de control válidos por `viz_type`, para
`irex.get_viz_controls` (PLAN_COPILOTO_EXPLORE.md, Fase 4, punto 3).

No hay forma de leer esto en runtime: el registro real de controles vive en
`@superset-ui/chart-controls` (Module Federation del host no lo comparte —
confirmado en la Fase 0, ver PLAN_COPILOTO_EXPLORE.md) y los `controlPanel.tsx`
son código React/TS ejecutable (funciones `mapStateToProps`/`visibility` con
estado en vivo del editor), no una configuración declarativa que se pueda
parsear. Dos niveles de confianza, nunca mezclados:

1. `CUSTOM_PLUGIN_CONTROLS` — la lista EXACTA y COMPLETA de nombres de
   control de los tres plugins propios, extraída leyendo su código fuente
   real (`custom-plugins/plugin-chart-{table-v3,html-cards,
   pivot-table-rx1}/src/**/controlPanel.tsx` y sus archivos `./controls/*`,
   2026-09-24) — no una lista genérica aplicada a estos tipos.
2. `COMMON_CONTROLS` — los nombres de control "compartidos" que registra
   Superset mismo en `@superset-ui/chart-controls`
   (`shared-controls/sharedControls.tsx`, el objeto `sharedControls`
   exportado) — la mayoría de los tipos NATIVOS de Superset (y los propios)
   los reusan en vez de definir los suyos desde cero. Para un `viz_type` que
   NO es uno de los tres plugins propios, es lo único disponible: un punto
   de partida razonable, NO verificado específicamente para ese tipo (puede
   faltar algún control propio de ese tipo, o sobrar alguno que ese tipo en
   particular no use — de ahí que la respuesta lo marque `source: "generic"`
   en vez de `"specific"`).

`KNOWN_VIZ_TYPES` (entrada 79 del Registro de cambios, 2026-09-24): el
enum `VizType` completo de
`superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts`
de este Superset — sin esto, CUALQUIER string (incluido uno inventado por
el modelo) caía al catálogo genérico como si fuera un tipo real, y el
backend del chat lo señaló: "para cambiar a otro tipo, generic no basta:
el MCP también lo devuelve para nombres de tipo inventados" — no había
forma de distinguir "tipo real, no verificado" de "tipo que no existe".
Ahora un `viz_type` que no está en `CUSTOM_PLUGIN_CONTROLS` NI en
`KNOWN_VIZ_TYPES` devuelve `source: "unknown"` con `controls: []` — el
backend puede rechazar de una un `change_viz_type` a ese destino sin
necesitar lógica propia para detectar el caso.
"""

from __future__ import annotations

from collections.abc import Sequence

# Objeto `sharedControls` completo de
# `superset-frontend/packages/superset-ui-chart-controls/src/shared-controls/
# sharedControls.tsx` (líneas 470-521 al momento de extraerlo) + los
# controles de Matrixify que esa misma exportación mezcla (`...matrixifyControls`,
# usados por los tres plugins propios vía `matrixify_*` en su form_data).
COMMON_CONTROLS: frozenset[str] = frozenset(
    {
        "metrics",
        "metric",
        "datasource",
        "viz_type",
        "color_picker",
        "metric_2",
        "linear_color_scheme",
        "secondary_metric",
        "groupby",
        "columns",
        "tooltip_columns",
        "tooltip_metrics",
        "granularity",
        "granularity_sqla",
        "time_grain_sqla",
        "time_range",
        "row_limit",
        "limit",
        "timeseries_limit_metric",
        "orderby",
        "order_desc",
        "series",
        "entity",
        "x",
        "y",
        "size",
        "y_axis_format",
        "x_axis_time_format",
        "x_axis_number_format",
        "adhoc_filters",
        "color_scheme",
        "time_shift_color",
        "series_columns",
        "series_limit",
        "group_others_when_limit_reached",
        "series_limit_metric",
        "legacy_order_by",
        "truncate_metric",
        "x_axis",
        "zoomable",
        "show_empty_columns",
        "temporal_columns_lookup",
        "currency_format",
        "sort_by_metric",
        "order_by_cols",
        "echart_options",
        # matrixifyControls (mismo export, ver el comentario del módulo) —
        # nombres reales presentes en el form_data de los tres plugins
        # propios (`matrixify_enable`, `matrixify_mode_columns`, etc.);
        # acá solo la raíz genérica del feature, no cada sub-control.
        "matrixify_enable",
    }
)

# Verificado leyendo el código fuente real de cada plugin (no genérico) —
# ver el docstring del módulo para la ruta exacta de cada uno.
CUSTOM_PLUGIN_CONTROLS: dict[str, frozenset[str]] = {
    # custom-plugins/plugin-chart-table-v3/src/controlPanel.tsx
    "table_v3": frozenset(
        {
            "query_mode",
            "groupby",
            "time_grain_sqla",
            "metrics",
            "all_columns",
            "percent_metrics",
            "jinja_fields",
            "calculated_columns",
            "column_order",
            "adhoc_filters",
            "timeseries_limit_metric",
            "order_by_cols",
            "server_pagination",
            "row_limit",
            "server_page_length",
            "order_desc",
            "show_totals",
            "table_timestamp_format",
            "page_length",
            "include_search",
            "allow_rearrange_columns",
            "sticky_columns",
            "allow_render_html",
            "show_row_numbers",
            "enable_row_grouping",
            "row_grouping_column",
            "show_row_group_totals",
            "allow_row_grouping_change",
            "row_grouping_default_collapsed",
            "row_grouping_compact_view",
            "show_top",
            "top_metric",
            "top_count",
            "top_show_in_chart",
            "column_config",
            "show_cell_bars",
            "align_pn",
            "color_pn",
            "comparison_color_enabled",
            "comparison_color_scheme",
            "conditional_formatting",
        }
    ),
    # custom-plugins/plugin-chart-html-cards/src/plugin/controlPanel.tsx
    # + ./controls/*.tsx
    "html_cards": frozenset(
        {
            "query_mode",
            "groupby",
            "metrics",
            "all_columns",
            "percent_metrics",
            "timeseries_limit_metric",
            "order_by_cols",
            "order_desc",
            "row_limit",
            "include_time",
            "show_totals",
            "adhoc_filters",
            "column_config",
            "handlebarsTemplate",
            "styleTemplate",
        }
    ),
    # custom-plugins/plugin-chart-pivot-tableRx1/src/plugin/controlPanel.tsx
    "pivot_table_rx1": frozenset(
        {
            "groupbyColumns",
            "groupbyRows",
            "time_grain_sqla",
            "metrics",
            "jinja_fields",
            "metricsLayout",
            "metricFormulas",
            "metricOrder",
            "adhoc_filters",
            "series_limit",
            "row_limit",
            "series_limit_metric",
            "order_desc",
            "aggregateFunction",
            "rowTotals",
            "rowSubTotals",
            "rowCollapseByDefault",
            "compactRowTree",
            "colTotals",
            "colSubTotals",
            "transposePivot",
            "combineMetric",
            "valueFormat",
            "currency_format",
            "date_format",
            "rowOrder",
            "colOrder",
            "rowSubtotalPosition",
            "colSubtotalPosition",
            "conditional_formatting",
            "conditional_formatting_solid",
            "allow_render_html",
            "show_cell_tooltip",
            "sticky_headers",
            "table_theme_enabled",
            "table_theme_header_bg",
            "table_theme_header_text",
            "table_theme_row_header_bg",
            "table_theme_row_header_text",
            "table_theme_total_bg",
            "table_theme_total_text",
            "table_theme_subtotal_bg",
            "table_theme_subtotal_text",
            "table_theme_cell_bg",
            "table_theme_cell_text",
            "table_theme_border_color",
            "column_config",
        }
    ),
}


# Enum `VizType` completo de
# `superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts`
# de este Superset (50 tipos, incluidos los tres propios) — la única fuente
# de "¿esto existe de verdad?" para un `viz_type`. No confundir con
# `CUSTOM_PLUGIN_CONTROLS`/`COMMON_CONTROLS`: esto NO dice qué controles
# tiene cada tipo, solo si el tipo en sí es real.
KNOWN_VIZ_TYPES: frozenset[str] = frozenset(
    {
        "echarts_area",
        "echarts_timeseries_bar",
        "big_number",
        "big_number_total",
        "pop_kpi",
        "box_plot",
        "bubble_v2",
        "bullet",
        "cal_heatmap",
        "cartodiagram",
        "chord",
        "compare",
        "country_map",
        "funnel",
        "gantt_chart",
        "gauge_chart",
        "graph_chart",
        "handlebars",
        "heatmap_v2",
        "html_cards",
        "histogram_v2",
        "horizon",
        "bubble",
        "echarts_timeseries_line",
        "mapbox",
        "mixed_timeseries",
        "paired_ttest",
        "para",
        "partition",
        "pie",
        "pivot_table_v2",
        "pivot_table_rx1",
        "radar",
        "rose",
        "sankey_v2",
        "echarts_timeseries_scatter",
        "echarts_timeseries_smooth",
        "echarts_timeseries_step",
        "sunburst_v2",
        "table",
        "ag-grid-table",
        "table_v3",
        "time_pivot",
        "time_table",
        "echarts_timeseries",
        "tree_chart",
        "treemap_v2",
        "waterfall",
        "word_cloud",
        "world_map",
    }
)


# ---------------------------------------------------------------------------
# Descripción por control (ampliación 2026-09-25, a pedido del usuario:
# "necesito que el LLM pueda ver e interactuar" con las personalizaciones de
# los plugins propios — `get_viz_controls` solo daba NOMBRES, sin ninguna
# pista de forma/semántica, así que el modelo sabía que `column_config`/
# `jinja_fields`/`calculated_columns` EXISTÍAN pero no cómo se arman.
#
# Dos diccionarios, extraídos leyendo el código fuente real (no inventados):
# - `GENERIC_CONTROL_INFO`: `label`/`description` reales de cada control de
#   `COMMON_CONTROLS`, tomados literalmente de `sharedControls.tsx` y
#   `dndControls.tsx` (`@superset-ui/chart-controls`) — Superset ya los
#   documenta así para sus propios tooltips de UI, no hubo que redactar nada
#   de cero, solo traducir/resumir lo que ya existe.
# - `CUSTOM_PLUGIN_CONTROL_INFO`: por plugin propio, SOLO los controles que
#   no están en `COMMON_CONTROLS` o que el plugin redefine con una semántica
#   meaningfully distinta (ej. `row_limit` en pivot_table_rx1 se llama
#   "Cell limit" y limita celdas, no filas). Los que el plugin reusa tal
#   cual (ej. `adhoc_filters`, `time_grain_sqla`) NO se repiten acá —
#   `control_info_for()` cae al genérico para esos.
# ---------------------------------------------------------------------------

GENERIC_CONTROL_INFO: dict[str, dict[str, str]] = {
    "metrics": {"description": "Una o más métricas — agregación sobre una columna, o SQL personalizado."},
    "metric": {"description": "Una única métrica — agregación sobre una columna, o SQL personalizado."},
    "datasource": {"description": "El dataset del que sale este gráfico."},
    "viz_type": {"description": "El tipo de visualización."},
    "color_picker": {"description": "Color fijo estático para todos los elementos del gráfico."},
    "metric_2": {"description": "Métrica para el eje derecho (gráficos con dos ejes Y)."},
    "linear_color_scheme": {"description": "Esquema de color secuencial (lineal), para heatmaps y escalas continuas."},
    "secondary_metric": {"description": "Métrica usada para colorear los elementos del gráfico."},
    "groupby": {"description": "Columnas dimensionales para agrupar/categorizar los datos — define el nivel de detalle."},
    "columns": {"description": "Columnas del dataset para agrupar las columnas de la tabla (pivot)."},
    "tooltip_columns": {"description": "Columnas a mostrar en el tooltip."},
    "tooltip_metrics": {"description": "Métricas a mostrar en el tooltip."},
    "granularity": {"description": "Granularidad temporal de la visualización (ej. '1 day', '7 days')."},
    "granularity_sqla": {"description": "La columna temporal de la visualización — puede ser una expresión que devuelva un DATETIME."},
    "time_grain_sqla": {"description": "El grano temporal: el intervalo que representa cada punto del gráfico."},
    "time_range": {"description": "Filtra todo el gráfico por el rango temporal seleccionado."},
    "row_limit": {"description": "Límite de filas que trae la consulta que alimenta el gráfico."},
    "limit": {"description": "Límite de series que se muestran — se aplica una subquery adicional para acotar la cardinalidad."},
    "timeseries_limit_metric": {"description": "Métrica usada para ordenar la consulta — decide qué se trunca si hay un límite de filas/series."},
    "orderby": {"description": "Igual que timeseries_limit_metric: métrica usada para ordenar la consulta."},
    "order_desc": {"description": "Ordena los resultados descendente (si no, ascendente)."},
    "series": {"description": "Define el agrupamiento de entidades — cada serie tiene un color distinto."},
    "entity": {"description": "El elemento a graficar."},
    "x": {"description": "Columna/métrica para el eje X."},
    "y": {"description": "Columna/métrica para el eje Y."},
    "size": {"description": "Métrica usada para calcular el tamaño de la burbuja."},
    "y_axis_format": {"description": "Formato numérico (D3) del eje Y."},
    "x_axis_time_format": {"description": "Formato de fecha/hora (D3) del eje X."},
    "x_axis_number_format": {"description": "Formato numérico (D3) del eje X."},
    "adhoc_filters": {"description": "Filtros del gráfico."},
    "color_scheme": {"description": "Esquema de color categórico del gráfico."},
    "time_shift_color": {"description": "Si está desmarcado, usa el esquema de color elegido también para las series con desplazamiento temporal."},
    "series_columns": {"description": "Columnas del dataset para agrupar las columnas de la tabla (mismo control que 'columns')."},
    "series_limit": {"description": "Límite de series que se muestran (mismo concepto que 'limit')."},
    "group_others_when_limit_reached": {"description": "Agrupa el resto de las series en \"Otros\" al alcanzar el límite configurado."},
    "series_limit_metric": {"description": "Métrica usada para ordenar/truncar cuando hay un límite de series."},
    "legacy_order_by": {"description": "Métrica usada para ordenar la consulta (variante legada de timeseries_limit_metric)."},
    "truncate_metric": {"description": "Si trunca el nombre/valor de las métricas mostradas."},
    "x_axis": {"description": "Columna para el eje X — dimensión o columna temporal, según el tipo de gráfico."},
    "zoomable": {"description": "Habilita controles de zoom sobre los datos del gráfico."},
    "show_empty_columns": {"description": "Muestra columnas/series aunque no tengan datos."},
    "temporal_columns_lookup": {"description": "Control interno (oculto): mapa de qué columnas son temporales — no se edita directamente."},
    "currency_format": {"description": "Formatea métricas/columnas con símbolo de moneda (prefijo o sufijo); 'Auto-detect' usa la columna de código de moneda del dataset."},
    "sort_by_metric": {"description": "Si ordena los resultados por la métrica seleccionada, descendente."},
    "order_by_cols": {"description": "Ordena los resultados por las columnas seleccionadas."},
    "echart_options": {"description": "Objeto JS con opciones nativas de ECharts — tiene prioridad sobre el resto de los controles de estilo."},
    "matrixify_enable": {"description": "Activa el modo Matrixify: genera una grilla de mini-gráficos repetidos, uno por cada valor de una dimensión/métrica elegida."},
}

# Reglas EXACTAS del template HTML de `column_config` (control
# `ColumnConfigControl`, compartido por `table_v3` y `pivot_table_rx1` vía
# `htmlTemplate`/`enableHtmlTemplate`) — transcritas literalmente de
# `HTML_TEMPLATE_AI_PROMPT` en `superset-frontend/src/explore/components/
# controls/ColumnConfigControl/constants.tsx`. Esa constante fue escrita
# por el equipo del proyecto explícitamente para pegarse en un prompt de
# IA (tiene un botón "copiar" en la UI real) — es la fuente más autorizada
# posible, se usa tal cual, sin reinterpretar. NO es el mismo lenguaje que
# `calculated_columns` (que sí soporta +,-,*,/,IF(),etc. con {{Columna}})
# — acá es sintaxis Jinja-like con `{% set %}` y `CASE...WHEN...THEN...
# ELSE...END`, deliberadamente MUY restringida (encontrado leyendo el
# código real: nada de SUM/AVG/COUNT, nada de OR/AND/IS NULL/IN, sin
# comentarios ni macros ni filtros Jinja).
#
# Precisión agregada 2026-09-28 sobre `raw_value`/nulos, a partir de una
# recomendación del agente del backend del chat (revisó una sesión real
# donde una plantilla de rangos mandaba un valor nulo a ELSE, mostrándolo
# como si fuera el valor más alto del rango) — CONFIRMADA leyendo
# `formatValue.ts` real (`getTemplateValue`/`evaluateWhenCondition`), no
# solo tomada de su palabra: `{{ value }}`, `{{ raw_value }}`, y repetir
# el nombre/label de ESTA MISMA columna son la MISMA ruta de código
# (`key === column.key`) — un valor nulo ahí se convierte en `''` (string
# vacío), COMPARABLE con `= ''`. Referenciar OTRA columna es una ruta
# DISTINTA: un valor nulo ahí queda `undefined`, la comparación se salta
# en silencio (ni error ni `''`) — no hace falta un guard `= ''` para
# columnas ajenas, pero SÍ es indispensable para la propia, siempre
# PRIMERO en la lista de WHEN.
def _column_config_html_template_rules(css_var_prefix: str) -> str:
    """Reglas de column_config.htmlTemplate, compartidas por table_v3 y
    pivot_table_rx1 (mismo lenguaje) — parametrizadas por `css_var_prefix`
    porque las variables CSS de tema real (ampliación 2026-09-28, ver
    themeCssVars en TableChart.tsx/PivotTableChart.tsx) tienen un prefijo
    propio por plugin (--table-v3-theme-*, --pivot-table-rx1-theme-*),
    mismo patrón y mismos tokens que plugin-chart-html-cards
    (--html-cards-theme-*, ver control_info de html_cards.styleTemplate)."""
    return (
        "column_config.htmlTemplate (NO es calculated_columns, NO es Jinja completo): variables "
        "{{ value }} (formateado) y {{ raw_value }} (crudo) de ESTA columna, {{ nombre_columna_real }} "
        "para OTRAS columnas, asignación {% set variable = nombre_columna_real %} / "
        "{% set display = value %}, y CASE WHEN <comparación simple> THEN <html> ... ELSE <html> END. "
        "Comparaciones simples únicamente: {{x}} = '', {{x}} > 0, {{x}} >= 80, {{x}} >= {{otra_columna}}. "
        "NO soporta SUM()/AVG()/COUNT()/MIN()/MAX(), OR/AND/IS NULL/IN, comentarios {# ... #}, macros ni "
        "filtros Jinja. "
        "IMPORTANTE con nulos en rangos/umbrales: {{ value }}, {{ raw_value }} y repetir el nombre de ESTA "
        "columna son lo MISMO (nulo → '', comparable con = ''); OTRA columna es distinto (nulo → esa "
        "comparación se salta en silencio, sin volverse ''). Por eso el PRIMER WHEN debe ser "
        "{{ raw_value }} = '' si la propia columna puede ser nula — si no, el nulo cae al ELSE como si "
        "fuera el extremo del rango. "
        "htmlCss (si existe): clases, selectores descendientes/múltiples, @keyframes, animation. Evitar "
        "SVG (usar ▲▼●—); font-family: inherit. "
        "Colores: SIEMPRE var(--" + css_var_prefix + "-theme-color-primary/-text/-text-secondary/-border/"
        "-success/-warning/-error/-bg-container/-bg-elevated) — tema real de Superset del contenedor, "
        "reactivo a claro/oscuro. NUNCA hex fijo ni colores de SO/navegador (Canvas/CanvasText/"
        "light-dark()). "
        "rgba(): coma entre canales, ej. rgba(0,0,0,.1) — no espacios (bug recurrente del modelo)."
    )

# Solo lo que NO está en COMMON_CONTROLS, o que table_v3 redefine con
# semántica propia — lo demás (adhoc_filters, time_grain_sqla, row_limit
# base, etc.) cae al genérico de arriba vía `control_info_for()`.
_TABLE_V3_CONTROL_INFO: dict[str, dict[str, str]] = {
    "query_mode": {"description": "Modo de consulta: 'Aggregate' (agrupa y agrega por groupby/metrics) o 'Raw' (filas sin agregar, usa all_columns)."},
    "all_columns": {"description": "Columnas a mostrar en modo Raw (sin agregar)."},
    "percent_metrics": {"description": "Métricas que se muestran como porcentaje del total — calculado solo sobre las filas traídas (dentro de row_limit)."},
    "jinja_fields": {
        "description": (
            "Métricas/columnas SQL disponibles como variables para usar en nombres de columna personalizados vía "
            "plantillas (ej. {{MAX(year)}} en column_config.displayName) — no se muestran en la tabla, solo sirven "
            "como referencia. Son SQL real: validar con irex.validate_expression, no con "
            "irex.validate_calculated_column_formula."
        )
    },
    "calculated_columns": {
        "description": (
            "Columnas nuevas calculadas EN EL NAVEGADOR con placeholders {{Columna}} — NO es SQL, ni el mismo "
            "lenguaje que column_config.htmlTemplate. Soporta +,-,*,/, IF(), OR(), AND(), NOT(), ISBLANK(), "
            "ABS(), ROUND(), MAX(), MIN(). Alcance de las referencias: {{Columna}} y row.{{Columna}}/"
            "col.{{Columna}} son EQUIVALENTES (las tres leen el valor de la FILA actual — row./col. son alias "
            "por compatibilidad, no cambian nada); SOLO total.{{Columna}} es distinto: lee el valor de la fila de "
            "TOTAL de la tabla, sin importar el agrupamiento — sirve para calcular 'esta fila como % del total "
            "general' (ej. total.{{Venta}} en el denominador). Formato D3 opcional por columna. Una referencia "
            "rota NO da error visible, la columna queda en blanco en silencio — validar SIEMPRE con "
            "irex.validate_calculated_column_formula antes de proponer."
        )
    },
    "column_order": {"description": "Orden de arrastre de las columnas de la tabla, incluidas las calculadas."},
    "server_pagination": {"description": "Pagina los resultados del lado del servidor (experimental)."},
    "server_page_length": {"description": "Filas por página cuando la paginación es del lado del servidor (0 = sin paginación)."},
    "page_length": {"description": "Filas por página, paginación del lado del cliente (0 = sin paginación)."},
    "include_search": {"description": "Agrega una caja de búsqueda del lado del cliente."},
    "allow_rearrange_columns": {"description": "Permite arrastrar los encabezados para reordenar columnas en pantalla — el cambio no persiste al reabrir el gráfico."},
    "sticky_columns": {"description": "Fija las primeras N columnas (máximo 3) al hacer scroll horizontal."},
    "allow_render_html": {"description": "Renderiza el contenido de las columnas como HTML cuando corresponde — necesario para que column_config.htmlTemplate se vea."},
    "show_row_numbers": {"description": "Agrega una columna con el número de fila."},
    "enable_row_grouping": {"description": "Agrupa las filas de la tabla por una columna dimensional ya mostrada; el encabezado del grupo se puede expandir/colapsar."},
    "row_grouping_column": {"description": "La columna dimensional (ya mostrada en la tabla) usada para agrupar filas — requiere enable_row_grouping."},
    "show_row_group_totals": {"description": "Muestra subtotales numéricos en el encabezado de cada grupo."},
    "allow_row_grouping_change": {"description": "Muestra un selector de 'Agrupar por' en la tabla para que el usuario cambie la columna de agrupamiento sin editar el gráfico."},
    "row_grouping_default_collapsed": {"description": "Los grupos arrancan colapsados en vez de expandidos."},
    "row_grouping_compact_view": {"description": "Oculta la columna agrupada de la tabla y muestra su valor solo en el encabezado del grupo."},
    "show_top": {"description": "Muestra solo las N filas top según una métrica, agrupando el resto como 'Otros' con valores agregados."},
    "top_metric": {"description": "La métrica usada para el ranking Top N (de mayor a menor) — requiere show_top."},
    "top_count": {"description": "Cantidad de filas top a mostrar — requiere show_top."},
    "top_show_in_chart": {"description": "Muestra el selector de cantidad Top N dentro de la tabla para que el usuario lo ajuste — el valor configurado es solo el default inicial."},
    "column_config": {
        "description": (
            "Personalización por columna/métrica, indexada por su LABEL (no por column_name interno): nombre a "
            "mostrar (displayName), formato numérico D3 (d3NumberFormat), y — solo si allow_render_html está "
            "activo — una plantilla HTML propia (enableHtmlTemplate:true, htmlTemplate) con CSS acotado en un "
            "campo SEPARADO (htmlCss, se aplica scoped a esa celda). "
            + _column_config_html_template_rules("table-v3")
        )
    },
    "show_cell_bars": {"description": "Muestra una barra de fondo proporcional al valor en las columnas numéricas."},
    "align_pn": {"description": "Alinea en 0 las barras de fondo cuando hay valores positivos y negativos."},
    "color_pn": {"description": "Colorea los valores numéricos según sean positivos o negativos."},
    "comparison_color_enabled": {
        "description": (
            "Formato condicional básico para toda la tabla: agrega flechas ↑/↓ según suba o baje respecto al "
            "período de comparación — se puede sobreescribir con conditional_formatting."
        )
    },
    "comparison_color_scheme": {"description": "Esquema de color del formato condicional básico (verde para sube/rojo para baja, o al revés) — requiere comparison_color_enabled."},
    "conditional_formatting": {"description": "Reglas de formato condicional de color, por columna numérica o dimensional — más específico que comparison_color_enabled."},
    "table_timestamp_format": {"description": "Formato de fecha/hora (D3) para columnas temporales."},
    "show_totals": {"description": "Muestra los totales agregados de las métricas seleccionadas — el límite de filas no aplica al total."},
}

_HTML_CARDS_CONTROL_INFO: dict[str, dict[str, str]] = {
    "query_mode": {"description": "Modo de consulta: 'Aggregate' (agrupa y agrega por groupby/metrics) o 'Raw' (filas sin agregar, usa all_columns)."},
    "all_columns": {"description": "Columnas a mostrar en modo Raw (sin agregar)."},
    "percent_metrics": {"description": "Métricas que se muestran como porcentaje del total — calculado solo sobre las filas traídas (dentro de row_limit)."},
    "include_time": {"description": "Si incluye la granularidad temporal definida en la sección de tiempo."},
    "show_totals": {"description": "Muestra los totales agregados de las métricas seleccionadas — el límite de filas no aplica al total."},
    "column_config": {
        "description": (
            "Establece un nombre a mostrar (displayName) por cada columna/métrica seleccionada, para que la "
            "plantilla (handlebarsTemplate) pueda referenciarlas con un alias estable en vez del nombre SQL crudo."
        )
    },
    "handlebarsTemplate": {
        "description": (
            "Plantilla Handlebars (HTML) que renderiza la grilla de tarjetas — referencia columnas/métricas "
            "por el alias de column_config.displayName. Helpers y valores raíz (mismo listado que el tooltip "
            "de ayuda del control): "
            "dateFormat (formatea fecha); "
            "stringify (objeto a JSON); "
            "formatNumber (formato numérico por locale); "
            "numberFormatD3, ej. {{numberFormatD3 value \"$,.2f\"}} (formateadores D3/nativos de Superset); "
            "timeFormatD3, ej. {{timeFormatD3 created_at \"%Y-%m\"}}; "
            "coalesce (primer valor no nulo/vacío); "
            "pluck, ej. {{pluck rows \"ventas\"}} (extrae una propiedad de cada item de un array); "
            "sum, ej. {{sum 10 20}} o {{sum (pluck rows \"ventas\")}} (suma números o un array); "
            "division, ej. {{division a b}} (a/b — SIN protección de 0/null: envolver en "
            "{{#if b}}...{{else}}...{{/if}}, {{#if 0}} es falso en Handlebars); "
            "group, ej. {{#group displayRows by=(lookup (lookup @root.columns N) 'templateKey')}}"
            "{{value}}=clave del grupo, {{#each items}}...{{/each}}=filas de ese grupo{{/group}} "
            "(agrupa una lista por una propiedad — usar el templateKey de columns[], no el nombre SQL ni el "
            "displayName; combinar con pluck+sum+division para agregar valores dentro de cada grupo, ej. "
            "tabla anidada de marcas dentro de una tarjeta por familia. Si reutilizás (sum (pluck items \"X\")) "
            "con {{#with ... as |d|}}, usar ../value/../items adentro — sin ../ quedan vacíos en silencio (bug "
            "real al probarlo); más simple repetir la expresión que anidar #with); "
            "hasValue (si existe, 0 cuenta como válido); "
            "parseJson; "
            "rows (alias de las filas del resultado); "
            "displayRows (filas aliadas por Display name); "
            "firstDisplayRow (primera fila aliada — útil para un único KPI); "
            "columns (metadata: key/displayName/templateKey/si es métrica); "
            "rowCount; "
            "width/height (dimensiones del gráfico); "
            "layout.isCompact/isNarrow/isTiny (responsive); "
            "scopeId/scopeSelector (scope CSS por gráfico — styleTemplate se prefija automático); "
            "themeVars (tema de Superset como variables CSS). "
            "Usar :hover para mostrar información adicional."
        )
    },
    "styleTemplate": {
        "description": (
            "CSS aplicado a la grilla de tarjetas — trae una plantilla por defecto con las clases "
            ".kpi-mini-grid/.kpi-mini (variables CSS propias, ej. --mini-primary/--mini-surface/--mini-text-main/"
            "--mini-text-muted/--mini-border, YA atadas al tema real de Superset — ver abajo) que se puede "
            "sobreescribir por completo. Usar :hover para overlays/alternar datos. "
            "TEMA REAL de Superset disponible como variables CSS en el contenedor del gráfico "
            "(inyectadas por HtmlCards.tsx desde useTheme(), reactivas al tema claro/oscuro configurado en "
            "Superset — NO usar colores de sistema del navegador/SO como Canvas/CanvasText/light-dark(), eso "
            "sigue el tema del navegador, no el de Superset): --html-cards-theme-color-primary, -color-primary-bg, "
            "-color-bg-container, -color-bg-elevated, -color-border, -color-text, -color-text-secondary, "
            "-color-success, -color-warning, -color-error, -border-radius, -font-family, -font-size, "
            "-font-size-sm. Ej.: background: var(--html-cards-theme-color-bg-container); color: "
            "var(--html-cards-theme-color-text); border: 1px solid var(--html-cards-theme-color-border); "
            "border-radius: var(--html-cards-theme-border-radius). "
            "rgba()/rgb(): coma entre canales y alfa, ej. rgba(99,245,200,.18) — NUNCA "
            "rgba(99 245 200,.18) (inválido, se descarta sin error visible, bug real y "
            "recurrente del modelo). "
            "Aviso real de la propia UI del "
            "control: 'Se necesita configurar la sanitización de HTML para poder usar CSS' — si el CSS no se "
            "aplica visualmente, puede ser por eso, no por un error en el CSS en sí. "
            "Responsivo: el contenedor tiene container-type: size, container-name: html-cards-chart (y "
            "--html-cards-chart-width/-height), así que @container html-cards-chart (max-width: Npx) {...} / "
            "(max-height: Npx) {...} ajusta el diseño según el tamaño REAL del gráfico — usar esto, NO @media, "
            "que mide el viewport del navegador, no el tile del dashboard. Umbrales que usa "
            "handlebarsTemplate.layout (isNarrow/isTiny/isCompact): isNarrow width<900, "
            "isTiny width<560, isCompact width<900 o height<420."
        )
    },
}

_PIVOT_TABLE_RX1_CONTROL_INFO: dict[str, dict[str, str]] = {
    "groupbyColumns": {"description": "Columnas dimensionales para agrupar por columnas de la tabla dinámica."},
    "groupbyRows": {"description": "Columnas dimensionales para agrupar por filas de la tabla dinámica."},
    "jinja_fields": {
        "description": (
            "Métricas/columnas SQL disponibles como variables para usar en metricFormulas — no se muestran en la "
            "tabla, solo sirven como referencia. Son SQL real: validar con irex.validate_expression."
        )
    },
    "metricsLayout": {"description": "Si las métricas se aplican como grupo de nivel superior en columnas o en filas."},
    "metricFormulas": {
        "description": (
            "Métricas derivadas calculadas EN EL NAVEGADOR con placeholders {{Métrica}} — mecanismo propio de "
            "este plugin (parseFormulaMetrics), NO confirmado que sea el mismo compilador que "
            "calculated_columns de table_v3 — irex.validate_calculated_column_formula no está extendido a este "
            "control todavía. Cada elemento tiene label, fórmula y formato D3 opcional."
        )
    },
    "metricOrder": {"description": "Orden de arrastre de las métricas y las métricas-fórmula juntas."},
    "series_limit": {"description": "Límite de series que se muestran."},
    "row_limit": {"description": "Límite de CELDAS que se recuperan (no de filas) — el nombre visible es 'Cell limit'."},
    "series_limit_metric": {"description": "Métrica usada para ordenar/truncar cuando hay un límite de series o de celdas — si no está definida, usa la primera métrica."},
    "order_desc": {"description": "Ordena ascendente o descendente."},
    "aggregateFunction": {
        "description": (
            "Función de agregación al pivotear y calcular totales/subtotales: Count, Count Unique Values, List "
            "Unique Values, Sum, Average, Median, Sample Variance, Sample Standard Deviation, Minimum, Maximum, "
            "First, Last, o variantes 'as Fraction of Total/Rows/Columns' de Sum/Count."
        )
    },
    "rowTotals": {"description": "Muestra el total a nivel de fila."},
    "rowSubTotals": {"description": "Muestra el subtotal a nivel de fila."},
    "rowCollapseByDefault": {"description": "Los grupos de subtotal de fila arrancan colapsados — requiere rowSubTotals."},
    "compactRowTree": {"description": "Muestra los campos de fila en una sola columna de árbol expandible — requiere rowSubTotals."},
    "colTotals": {"description": "Muestra el total a nivel de columna."},
    "colSubTotals": {"description": "Muestra el subtotal a nivel de columna."},
    "transposePivot": {"description": "Intercambia filas y columnas."},
    "combineMetric": {"description": "Muestra las métricas lado a lado dentro de cada columna, en vez de una columna separada por métrica."},
    "valueFormat": {"description": "Formato numérico (D3) de los valores de la tabla."},
    "date_format": {"description": "Formato de fecha/hora (D3) para columnas temporales."},
    "rowOrder": {"description": "Orden de las filas: por clave (nombre, a-z o z-a) o por valor (métrica, ascendente o descendente)."},
    "colOrder": {"description": "Orden de las columnas: por clave (nombre, a-z o z-a) o por valor (métrica, ascendente o descendente)."},
    "rowSubtotalPosition": {"description": "Posición del subtotal de fila: arriba o abajo del grupo."},
    "colSubtotalPosition": {"description": "Posición del subtotal de columna: izquierda o derecha del grupo."},
    "conditional_formatting": {"description": "Reglas de formato condicional de color sobre las métricas."},
    "conditional_formatting_solid": {"description": "Si el formato condicional usa colores sólidos en vez de opacidad tipo heatmap."},
    "allow_render_html": {"description": "Renderiza el contenido de las celdas como HTML cuando corresponde (ej. etiquetas <a> se muestran como enlaces)."},
    "show_cell_tooltip": {"description": "Muestra métrica, valor crudo, fila, columna y detalle de fórmula al pasar el mouse sobre una celda."},
    "sticky_headers": {"description": "Mantiene visibles los encabezados de columna, de fila y las etiquetas de total al hacer scroll."},
    "table_theme_enabled": {"description": "Activa el tema de color personalizado de la tabla — si se desactiva, vuelve al tema por defecto (transparente)."},
    "table_theme_header_bg": {"description": "Color de fondo de las celdas de encabezado — requiere table_theme_enabled."},
    "table_theme_header_text": {"description": "Color de texto de las celdas de encabezado — requiere table_theme_enabled."},
    "table_theme_row_header_bg": {"description": "Color de fondo de los encabezados de fila — requiere table_theme_enabled."},
    "table_theme_row_header_text": {"description": "Color de texto de los encabezados de fila — requiere table_theme_enabled."},
    "table_theme_total_bg": {"description": "Color de fondo de las celdas de total — requiere table_theme_enabled."},
    "table_theme_total_text": {"description": "Color de texto de las celdas de total — requiere table_theme_enabled."},
    "table_theme_subtotal_bg": {"description": "Color de fondo de las celdas de subtotal — requiere table_theme_enabled."},
    "table_theme_subtotal_text": {"description": "Color de texto de las celdas de subtotal — requiere table_theme_enabled."},
    "table_theme_cell_bg": {"description": "Color de fondo de las celdas de datos — requiere table_theme_enabled."},
    "table_theme_cell_text": {"description": "Color de texto de las celdas de datos — requiere table_theme_enabled."},
    "table_theme_border_color": {"description": "Color de los bordes de la tabla — requiere table_theme_enabled."},
    "column_config": {
        "description": (
            "Personalización por columna/métrica, indexada por su LABEL: nombre a mostrar (displayName) y — solo "
            "si allow_render_html está activo — una plantilla HTML propia (enableHtmlTemplate:true, "
            "htmlTemplate). A diferencia de table_v3, este plugin NO expone un campo CSS separado (htmlCss) ni "
            "formato numérico D3 en column_config — el layout de este control los omite a propósito; cualquier "
            "estilo tiene que ir inline dentro del propio htmlTemplate (ej. atributo style=\"...\"). "
            + _column_config_html_template_rules("pivot-table-rx1")
        )
    },
}

CUSTOM_PLUGIN_CONTROL_INFO: dict[str, dict[str, dict[str, str]]] = {
    "table_v3": _TABLE_V3_CONTROL_INFO,
    "html_cards": _HTML_CARDS_CONTROL_INFO,
    "pivot_table_rx1": _PIVOT_TABLE_RX1_CONTROL_INFO,
}


_HTML_CARDS_INTERACTIVITY_HELP = (
    "Interactividad SIN escribir JS (handlebarsTemplate) — dos mecanismos declarativos, ambos "
    "resueltos por código ya auditado del plugin, NUNCA por texto del modelo ejecutado como código "
    "(ver hallazgo de seguridad 2026-09-29 en calculated_columns: nunca eval()/new Function() sobre "
    "texto que escribe el modelo — acá el modelo solo escribe NOMBRES de acción y argumentos de "
    "texto plano, parseados con split(), jamás interpretados como expresión):\n\n"
    "1) data-hc-sort / data-hc-resize, en un <table>: agregan orden por click en el header y ancho "
    "ajustable por drag, sin ninguna otra configuración. data-hc-resize requiere un <colgroup> con "
    "una <col> por columna. Para desactivar en una columna puntual, poner data-hc-sort=\"false\" o "
    "data-hc-resize=\"false\" en su <th>.\n\n"
    "2) data-hc-on + data-hc-action (+ data-hc-target opcional), en CUALQUIER elemento: "
    "data-hc-on=\"click\" (también dblclick/mouseenter/mouseleave/change/submit/load — cualquier "
    "otro valor se ignora) dispara data-hc-action=\"nombreAccion:arg1,arg2\" — varias acciones "
    "encadenadas con \";\": data-hc-action=\"toggleClass:open; scrollTo:smooth\". "
    "data-hc-on=\"load\" es especial: NO espera ninguna interacción, corre apenas se renderiza la "
    "tarjeta (y de nuevo en cada re-render, ej. si cambian los datos) — usarlo para animaciones "
    "automáticas como countUp al cargar. Por defecto la acción se aplica al propio elemento; con "
    "data-hc-target=\"#id\" o cualquier selector CSS se aplica a OTRO elemento del mismo gráfico "
    "(ej. un botón que abre un panel distinto). "
    "Vocabulario de acciones disponibles hoy: "
    "toggleClass:clase1 clase2 (separadas por espacio) — alterna una o más clases; "
    "addClass:clases / removeClass:clases — igual pero sin alternar; "
    "toggleAttr:nombreAtributo; "
    "scrollTo:smooth|auto (default smooth) — hace scroll hasta el elemento objetivo; "
    "setStyleVar:nombreVariable,valor — fija una variable CSS custom (--nombreVariable) en el "
    "elemento objetivo, útil combinada con styleTemplate; "
    "copyText — copia al portapapeles el atributo data-hc-copy-value del elemento objetivo, o su "
    "texto visible si no hay data-hc-copy-value; "
    "countUp:valorDestino,duraciónMs,sufijo (duración default 800, sufijo opcional ej. \"%\") — "
    "anima el PROPIO texto numérico del elemento objetivo desde data-hc-count-from (o su texto "
    "actual) hasta valorDestino; con data-hc-on=\"load\" anima automáticamente al renderizarse. "
    "Ejemplo interacción: <button data-hc-on=\"click\" data-hc-action=\"toggleClass:open\" "
    "data-hc-target=\"#detail-{{id}}\">Ver más</button>. Ejemplo animación al cargar: "
    "<strong data-hc-on=\"load\" data-hc-action=\"countUp:{{pct}},1200,%\" "
    "data-hc-count-from=\"0\">0%</strong>. Un nombre de acción que no está en este "
    "listado se ignora (no rompe el resto de la cadena, no ejecuta nada) — no inventar acciones "
    "nuevas, solo las de esta lista existen hoy. Si hace falta un comportamiento que no está acá, "
    "avisarlo en vez de intentar simularlo con onClick=/<script> inline (HTML_SANITIZATION puede "
    "estar desactivado en esta instalación, así que eso SÍ ejecutaría, pero corre sin el control ni "
    "la auditoría de estas acciones — evitarlo)."
)


def control_info_for(viz_type: str, control_names: Sequence[str]) -> dict[str, dict[str, str]]:
    """Arma el mapa control→descripción para la respuesta: primero la
    específica del plugin (si existe), si no la genérica — nunca las dos a
    la vez para el mismo control. Un control sin descripción en ningún lado
    (raro, pero posible si algo quedó sin documentar) simplemente no
    aparece — mejor omitir que inventar."""
    specific = CUSTOM_PLUGIN_CONTROL_INFO.get(viz_type, {})
    info: dict[str, dict[str, str]] = {}
    for name in control_names:
        if name in specific:
            info[name] = specific[name]
        elif name in GENERIC_CONTROL_INFO:
            info[name] = GENERIC_CONTROL_INFO[name]
    return info


def resolve_viz_controls(viz_type: str) -> dict[str, object]:
    """Tres niveles, en este orden de confianza:
    - `"specific"` — uno de los tres plugins propios: su lista exacta.
    - `"generic"` — un `viz_type` real (está en `KNOWN_VIZ_TYPES`) pero no
      verificado específicamente: el catálogo compartido, como punto de
      partida.
    - `"unknown"` — no es ninguno de los dos: probablemente inventado por
      el modelo. `controls` vacío a propósito — nunca "generic" para un
      tipo que no existe, o un `change_viz_type` a un tipo inventado
      quedaría sin forma de rechazarse (hallazgo del backend del chat,
      entrada 79 del Registro de cambios).

    `control_info` (ampliación 2026-09-25) acompaña a `controls` con
    `{nombre: {"description": "..."}}` para los que tienen descripción
    conocida — ver `control_info_for()`. Puede no cubrir el 100% de
    `controls`: un nombre sin entrada en `control_info` simplemente no
    tiene descripción documentada todavía, no es un error."""
    specific = CUSTOM_PLUGIN_CONTROLS.get(viz_type)
    if specific is not None:
        controls = sorted(specific)
        result: dict[str, object] = {
            "viz_type": viz_type,
            "controls": controls,
            "source": "specific",
            "control_info": control_info_for(viz_type, controls),
        }
        if viz_type == "html_cards":
            result["note"] = _HTML_CARDS_INTERACTIVITY_HELP
        return result
    if viz_type in KNOWN_VIZ_TYPES:
        controls = sorted(COMMON_CONTROLS)
        return {
            "viz_type": viz_type,
            "controls": controls,
            "source": "generic",
            "control_info": control_info_for(viz_type, controls),
            "note": (
                "Catálogo genérico de controles compartidos por la mayoría de "
                f"los tipos de gráfico de Superset — no verificado específicamente "
                f"para '{viz_type}'. Puede faltar algún control propio de este tipo, "
                "o sobrar alguno que este tipo en particular no use."
            ),
        }
    return {
        "viz_type": viz_type,
        "controls": [],
        "source": "unknown",
        "note": f"'{viz_type}' no es un viz_type reconocido de Superset en esta instalación.",
    }
