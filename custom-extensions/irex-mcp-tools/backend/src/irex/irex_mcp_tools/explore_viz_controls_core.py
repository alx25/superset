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
"""

from __future__ import annotations

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


def resolve_viz_controls(viz_type: str) -> dict[str, object]:
    """Para un plugin propio verificado: su lista exacta, `source:
    "specific"`. Para cualquier otro `viz_type` (incluidos los nativos de
    Superset): el catálogo genérico compartido, `source: "generic"` — punto
    de partida razonable, no confirmado para ese tipo en particular."""
    specific = CUSTOM_PLUGIN_CONTROLS.get(viz_type)
    if specific is not None:
        return {
            "viz_type": viz_type,
            "controls": sorted(specific),
            "source": "specific",
        }
    return {
        "viz_type": viz_type,
        "controls": sorted(COMMON_CONTROLS),
        "source": "generic",
        "note": (
            "Catálogo genérico de controles compartidos por la mayoría de "
            f"los tipos de gráfico de Superset — no verificado específicamente "
            f"para '{viz_type}'. Puede faltar algún control propio de este tipo, "
            "o sobrar alguno que este tipo en particular no use."
        ),
    }
