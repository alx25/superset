import math
import re as _re
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator
from superset_core.mcp.decorators import tool

from . import report_cache
from .query_dataset import (
    DatasetFilter,
    JinjaFilterOverride,
    _EXPR_FUNC_PATTERN,
    _EXPR_OPERATORS,
    _jinja_filters_context,
    _parse_filter,
    _parse_metric,
    _remap_rows_to_raw_metrics,
)


def _looks_like_ratio_expression(metric: str) -> bool:
    """Misma heurística que query_dataset usa para detectar expresiones SQL
    sueltas — acá se usa para RECHAZAR su uso como única métrica de tamaño
    de un treemap (sumar % entre ramas no tiene sentido matemático)."""
    return bool(_EXPR_FUNC_PATTERN.search(metric)) and any(
        op in metric for op in _EXPR_OPERATORS
    )


class SelectedGroups(BaseModel):
    """Combinaciones EXACTAS de valores a incluir en el gráfico — ver
    'selected_groups' en ChartOptionRequest.

    Se aplica como filtro sobre las filas YA devueltas por la consulta, NO
    como cláusula WHERE en SQL: el motor de filtros de Superset
    (QueryObjectFilterClause/FilterOperator) solo admite operadores AND-eados
    de forma independiente por columna — no existe una forma de expresar
    "(col_a=1 AND col_b=2) OR (col_a=3 AND col_b=4)" en ese formato sin
    recurrir a SQL crudo, y hacerlo bypasearía el row-level security que
    Superset aplica automáticamente sobre el QueryContext. Post-filtrar en
    Python evita ese riesgo por completo y funciona igual sin importar el
    motor de base de datos detrás del dataset."""

    columns: list[str] = Field(
        ...,
        min_length=1,
        description="Columnas cuya tupla de valores identifica cada "
        "combinación seleccionada, ej. ['articulo', 'formato'].",
    )
    values: list[list[Any]] = Field(
        ...,
        min_length=1,
        description="Cada elemento es una tupla de valores (mismo orden que "
        "'columns') que debe conservarse — el resto se descarta. Ej. con "
        "columns=['articulo','formato']: "
        "[['Detergente Xedex 400gr','7-Maxi Pali'], "
        "['Detergente Rinso 2500gr','8-Mas x Menos']].",
    )

    @model_validator(mode="after")
    def _validate_shape(self) -> "SelectedGroups":
        for v in self.values:
            if len(v) != len(self.columns):
                raise ValueError(
                    f"selected_groups.values tiene una tupla de {len(v)} "
                    f"valores pero 'columns' tiene {len(self.columns)} "
                    "columnas — cada tupla de 'values' debe traer "
                    "exactamente un valor por columna, en el mismo orden."
                )
        return self


def _metric_display_name(metric: str) -> str:
    """Alias legible para una expresión SQL — se muestra en tooltip/leyenda.
    SUM(sell_in) → 'sell_in'; SUM(sell_in)/NULLIF(SUM(enfirme),0)*100
    → 'sell_in / enfirme'. Fallback: la expresión original.

    Si la métrica usa el alias ' AS <nombre>' (ver _parse_metric), se prefiere
    ese nombre tal cual sobre la extracción automática de columnas."""
    metric = metric.strip()
    parsed = _parse_metric(metric)
    if isinstance(parsed, dict):
        label = parsed.get("label")
        if label and label != metric:
            return label
    # Agregación simple: SUM(col), COUNT(col), AVG(col), etc.
    m = _re.match(r'(?:SUM|COUNT|AVG|MIN|MAX)\s*\(\s*(\w+)\s*\)\s*$', metric, _re.I)
    if m:
        return m.group(1)
    # Expresión calculada: extraer columnas de los SUM/AVG/etc. en orden
    cols = _re.findall(r'(?:SUM|COUNT|AVG|MIN|MAX)\s*\(\s*(\w+)\s*\)', metric, _re.I)
    if cols:
        return " / ".join(dict.fromkeys(cols))  # únicos, preservar orden
    return metric


class ChartOptionRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    source_result_ref: str | None = Field(
        None,
        description="report_id devuelto por irex.query_dataset o "
        "irex.rank_partitions con save_as_report=True — si se pasa, el "
        "gráfico hereda de ese resultado ya verificado: los 'filters' del "
        "reporte se agregan a los de esta llamada (mismo alcance/período "
        "que el análisis original), y DEBE coincidir con 'dataset_id'. "
        "Para chart_type='small_multiples' es OBLIGATORIO pasar también "
        "'facet_by' explícito (y opcionalmente 'series_by') — el reporte "
        "NUNCA determina automáticamente qué columna es el panel y cuál es "
        "la serie, eso es una decisión de diseño visual (ej. un ranking "
        "agrupado por ['formato','articulo'] no implica que ambas deban "
        "ser 'facet_by': lo normal es 'facet_by=[\"formato\"], "
        "series_by=[\"articulo\"]' para un panel por formato con una línea "
        "por artículo). Lo que SÍ se deriva automáticamente (si no se pasa "
        "'selected_groups' explícito) son las tuplas EXACTAS de "
        "facet_by+series_by presentes en las filas del reporte — evita "
        "retranscribirlas a mano. 'facet_by'/'series_by' deben ser columnas "
        "que el reporte efectivamente agrupó, si no, error explícito.",
    )
    chart_type: Literal[
        "line",
        "bar",
        "area",
        "pie",
        "scatter",
        "table",
        "pareto",
        "stacked_bar",
        "stacked_area",
        "combo",
        "heatmap",
        "treemap",
        "gauge",
        "small_multiples",
    ] = "line"
    x: str = Field(
        ...,
        description="Columna del eje X (categoría, fecha, o dimensión). Para "
        "'table' es la primera columna de fila; para 'treemap' es el nivel "
        "1 de la jerarquía; para 'heatmap' es una de las dos dimensiones. "
        "Para granularidad MENSUAL, usar la columna real del dataset (ej. "
        "'mes_id') tal cual — NO inventar funciones SQL como "
        "'toStartOfMonth(fecha_id)' ni nombres de columna que no existen; "
        "esta tool ya muestra 'mes_id'/'mes' como nombre de mes en español "
        "(Ene, Feb, ...) ordenado cronológicamente, sin necesitar ninguna "
        "transformación. Para granularidad diaria sí usar la columna de "
        "fecha (ej. 'fecha_id') directamente. "
        "Para 'gauge' este campo se ignora — pasar cualquier columna válida "
        "del dataset (ej. la primera columna de dimensión disponible).",
    )
    group_by: str | list[str] | None = Field(
        None,
        description="Una o más dimensiones adicionales — acepta un string "
        "('col') o una lista (['col1','col2']). Para line/bar/area/scatter: "
        "1 dimensión = una serie por valor; 2+ dimensiones = una serie por "
        "combinación (etiqueta 'val1 | val2'). Para 'table': con 1 "
        "dimensión Y 1 sola métrica = tabla cruzada/pivot (esa dimensión se "
        "vuelve columnas, máx. 15 valores distintos); en cualquier otro "
        "caso (2+ dimensiones, o 1 dimensión con 2+ métricas como sell_in y "
        "planv para cumplimiento) = filas adicionales sin pivotar, ej. "
        "['marca_nombre','familia_nombre']. Para 'treemap': cada dimensión "
        "es un nivel más de jerarquía. 'heatmap' requiere EXACTAMENTE 1 "
        "dimensión (su segundo eje). Para 'small_multiples' es MECANISMO "
        "HEREDADO — usar 'facet_by' en su lugar; group_by solo aplica si "
        "'facet_by' no se especifica (cada combinación de group_by es un "
        "panel, sin distinguir series dentro de él). Se ignora en pie/"
        "pareto/combo.",
    )
    metrics: list[str] = Field(
        ...,
        min_length=1,
        description="Una o más métricas formato 'AGREGADO(columna)', ej. "
        "'SUM(pns)', el metric_name exacto de una métrica guardada del "
        "dataset, o una expresión SQL calculada (ratio de sumas, NUNCA "
        "promedio de ratios por fila), ej. "
        "'SUM(sell_in)/NULLIF(SUM(planv),0)*100' para % cumplimiento. La "
        "mayoría de los tipos usan solo la primera. "
        "'combo' REQUIERE 2: la primera se grafica como barras (eje Y "
        "izquierdo), la segunda como línea (eje Y derecho) — útil para "
        "comparar plan vs real, ej. ['SUM(sell_in)', 'SUM(forecast)'].",
    )
    filters: list[DatasetFilter] = Field(default_factory=list)
    sort: Literal["default", "asc", "desc"] = Field(
        "default",
        description="String simple: 'default', 'asc' o 'desc'. "
        "NO pasar un objeto ni lista — solo el string literal. "
        "Ejemplos correctos: sort='desc', sort='asc', sort='default'. "
        "Error común: sort=[{'column':'...','dir':'desc'}] — eso es INCORRECTO. "
        "'desc' = mayor a menor (ranking). 'asc' = menor a mayor. "
        "'default' = orden natural (las filas llegan en el orden del dataset). "
        "Para chart_type='table' con varias métricas, sort ordena por la ÚLTIMA "
        "métrica de la lista (poner la métrica de interés al final). "
        "Para charts xy (bar/line/area), sort ordena por la PRIMERA métrica.",
    )
    sort_by_metric: str | None = Field(
        None,
        description="Métrica exacta por la que ordenar (nombre tal como aparece "
        "en 'metrics'). Si se especifica, tiene prioridad sobre el comportamiento "
        "por defecto de 'sort' (que usa primera o última métrica). Útil para "
        "ordenar por 'brecha' o 'cumplimiento' cuando hay varias métricas.",
    )
    row_limit: int = Field(
        200,
        ge=1,
        le=1000,
        description="Máximo de puntos/categorías/filas. Si 'x' es una fecha "
        "con muchos valores distintos (ej. fecha diaria de varios años), "
        "usar una columna de menor granularidad (ej. 'anio_id', 'mes_id') "
        "en vez de subir este límite. Con varias dimensiones de group_by, "
        "la cardinalidad crece rápido — si la respuesta avisa 'truncated', "
        "agregar filtros en vez de solo subir este número.",
    )
    title: str | None = None
    panel_type: Literal["line", "bar", "area"] = Field(
        "line",
        description="Solo para chart_type='small_multiples' — tipo de "
        "mini-gráfico dentro de cada panel. 'line' (por defecto) para "
        "comparar tendencias entre categorías; 'bar' o 'area' también "
        "disponibles. Se ignora en cualquier otro chart_type.",
    )
    facet_by: list[str] | None = Field(
        None,
        description="Solo para chart_type='small_multiples' — columnas "
        "cuya TUPLA de valores identifica un panel (reemplaza a 'group_by' "
        "para este propósito, que queda como mecanismo heredado). Ej. "
        "['articulo','formato'] → un panel por cada combinación única de "
        "artículo+formato presente en los datos — dos artículos con el "
        "mismo formato quedan en paneles distintos, y el mismo artículo en "
        "dos formatos también. Si se omite, small_multiples usa 'group_by' "
        "completo como identidad del panel (comportamiento heredado).",
    )
    series_by: list[str] = Field(
        default_factory=list,
        description="Solo para chart_type='small_multiples' — columnas "
        "cuya tupla identifica una SERIE dentro de cada panel (no altera la "
        "identidad del panel, que la define 'facet_by'). Si está vacío "
        "(default), cada elemento de 'metrics' es su propia serie dentro "
        "del panel — con series_by no vacío se usa solo la PRIMERA métrica "
        "de 'metrics' (una serie por combinación de series_by).",
    )
    selected_groups: SelectedGroups | None = Field(
        None,
        description="Solo para chart_type='small_multiples' (opcional) — "
        "restringe el gráfico a tuplas EXACTAS de valores. Usar cuando un "
        "análisis previo (ej. un top-N por combinación de columnas, como un "
        "'top 8 artículo+formato') ya determinó qué combinaciones deben "
        "graficarse: pasar esas combinaciones acá en vez de traducirlas a "
        "'filters' independientes por columna, porque 'filters' con IN en "
        "columnas separadas trae el PRODUCTO CRUZADO de esos valores (ej. "
        "articulo IN ['A','B'] + formato IN ['X','Y'] trae las 4 "
        "combinaciones A-X/A-Y/B-X/B-Y, no solo las 2 que el análisis "
        "original identificó). Sigue haciendo falta 'filters' normales para "
        "acotar el volumen de la consulta si el dataset es grande — "
        "selected_groups afina el resultado ya traído, no reemplaza los "
        "filtros de columna.",
    )
    max_panels: int = Field(
        12,
        ge=1,
        le=24,
        description="Solo para chart_type='small_multiples' — máximo de "
        "paneles antes de rechazar la consulta con error (una grilla con "
        "más paneles queda ilegible). Bajar este límite si se quieren menos "
        "paneles más grandes; subirlo (hasta 24) si las categorías son "
        "pocas y se necesita ver más al mismo tiempo.",
    )
    legend_mode: Literal["auto", "per_facet", "scroll"] = Field(
        "auto",
        description="Solo para chart_type='small_multiples' — cómo mostrar "
        "la leyenda cuando 'series_by' (o 2+ 'metrics') genera varios "
        "nombres de serie. 'auto' (default): sin leyenda si no hace falta "
        "(1 sola serie por panel); una leyenda POR PANEL, con solo sus "
        "propias series, si en total hay más de 6 nombres distintos entre "
        "todos los paneles (evita una leyenda global gigante mezclando "
        "series de paneles distintos); una única leyenda global compartida "
        "si son pocos nombres (ej. el mismo canal en todos los paneles, más "
        "cómodo comparar con un solo toggle). 'per_facet' fuerza leyenda "
        "por panel siempre. 'scroll' fuerza una única leyenda global "
        "navegable con scroll en vez de dividirla por panel.",
    )
    jinja_filters: list[JinjaFilterOverride] | None = Field(
        None,
        description="AVANZADO — usar solo cuando el dataset tiene columnas "
        "calculadas en su SQL vía filter_values()/get_filters() (típicamente "
        "lógica de 'año seleccionado vs año anterior' u otra dependiente de un "
        "filtro nativo del dashboard) y se necesita fijar ese valor SIN pedirle "
        "al usuario que cambie el filtro en el dashboard. Cada entry simula la "
        "selección de un filtro nativo: {'column': '<target del filtro, ej. "
        "anio_ids>', 'value': [<valor>]}. Descubrir el nombre de columna correcto "
        "leyendo el SQL virtual del dataset o la configuración de filtros nativos "
        "del dashboard — NO adivinar. No confundir con 'filters' (WHERE normal "
        "sobre columnas reales del dataset).",
    )

    @model_validator(mode="before")
    @classmethod
    def _normalize_sort(cls, data: dict) -> dict:
        """Tolera sort=[{"dir":"desc"}] o sort={"dir":"desc"} además del string."""
        sort = data.get("sort")
        if isinstance(sort, list) and sort:
            sort = sort[0]
        if isinstance(sort, dict):
            raw = sort.get("dir") or sort.get("order") or "default"
            data["sort"] = raw.lower() if isinstance(raw, str) else "default"
        return data

    @model_validator(mode="after")
    def _validate_type_specific_requirements(self) -> "ChartOptionRequest":
        if self.chart_type == "combo" and len(self.metrics) < 2:
            raise ValueError(
                "chart_type='combo' requiere al menos 2 metrics: la primera "
                "se grafica como barras, la segunda como línea en eje "
                "secundario."
            )
        if self.chart_type == "heatmap" and len(_group_by_list(self)) != 1:
            raise ValueError(
                "chart_type='heatmap' requiere EXACTAMENTE 1 dimensión en "
                "'group_by' — es la segunda dimensión del mapa de calor "
                "(ej. x='mes_id', group_by='anio_id')."
            )
        if self.chart_type == "small_multiples" and not (
            self.facet_by or _group_by_list(self) or self.source_result_ref
        ):
            raise ValueError(
                "chart_type='small_multiples' requiere 'facet_by' (o, como "
                "mecanismo heredado, 'group_by') con 1 o más dimensiones, o "
                "'source_result_ref' (que lo deriva automáticamente) — cada "
                "combinación de valores se dibuja como un panel separado "
                "(ej. facet_by=['articulo','formato'])."
            )
        if self.selected_groups and len(self.selected_groups.columns) != len(
            set(self.selected_groups.columns)
        ):
            raise ValueError(
                "selected_groups.columns tiene columnas repetidas — cada "
                "columna debe aparecer una sola vez."
            )
        return self


def _group_by_list(request: ChartOptionRequest) -> list[str]:
    """Normaliza group_by (str | list[str] | None) a una lista."""
    gb = request.group_by
    if gb is None:
        return []
    if isinstance(gb, str):
        return [gb]
    return list(gb)


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def _facet_columns(request: ChartOptionRequest) -> list[str]:
    """Columnas que identifican un panel de small_multiples — 'facet_by' si
    se especificó, si no 'group_by' completo (mecanismo heredado)."""
    return request.facet_by if request.facet_by else _group_by_list(request)


_MONTH_NAMES_ES = {
    1: "Ene", 2: "Feb", 3: "Mar", 4: "Abr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Ago", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dic",
}
_MONTH_COLUMN_NAMES = {"mes_id", "mes", "month_id", "month"}


def _short_label(v: Any, column: str | None = None) -> str:
    """Formatea un valor para mostrar en un eje/etiqueta. Si 'column' es una
    columna de mes (ej. 'mes_id', valores 1-12), muestra el nombre del mes
    en español en vez del número crudo — el orden cronológico ya lo
    garantiza _sort_key (que ordena por el número real, no por el nombre)."""
    if column and column.lower() in _MONTH_COLUMN_NAMES:
        num = _to_number(v)
        if num is not None and num == int(num) and 1 <= int(num) <= 12:
            return _MONTH_NAMES_ES[int(num)]
    s = str(v)
    if len(s) == 19 and s[10] == "T":  # ISO datetime "YYYY-MM-DDTHH:MM:SS"
        return s[:10]
    return s


def _group_label(row: dict[str, Any], dims: list[str]) -> str:
    """Etiqueta compuesta para series con múltiples dimensiones."""
    return " | ".join(_short_label(row.get(d), d) for d in dims)


def _to_number(v: Any) -> float | int | None:
    """Coacciona a número valores que ya son int/float, o cualquier otro
    tipo numérico-like (str numérico, decimal.Decimal, numpy, etc.) —
    algunas bases (ej. Postgres con columnas NUMERIC/DECIMAL) devuelven los
    agregados como Decimal/string para preservar precisión exacta, en vez
    de float nativo. Sin esto, _round/_sort_key los tratan como texto."""
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, (str, bytes)) and not v:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _round(v: Any) -> Any:
    """Redondea valores numéricos a entero (sin decimales). El separador de
    miles se aplica del lado del widget (ver formatter en el frontend).
    NaN/Inf (ej. de métricas RATIO con denominador 0 en algunas bases) se
    convierte a None — no es un valor válido para mostrar ni serializar."""
    num = _to_number(v)
    if num is not None:
        if isinstance(num, float) and (num != num or num in (float("inf"), float("-inf"))):
            return None
        return round(num)
    return v


def _sort_key(v: Any) -> Any:
    """Clave de orden que respeta el tipo real del valor (numérico, fecha),
    en vez de comparar como texto — evita que mes_id=10 quede antes que
    mes_id=2 por orden alfabético de strings (incluso si llegan como
    string numérico, ej. mes='10' de columnas NUMERIC de Postgres)."""
    num = _to_number(v)
    return (0, num) if num is not None else (1, str(v))


def _normalize_match_value(v: Any) -> Any:
    """Normaliza un valor para comparación de igualdad en selected_groups —
    para que '400' (string, tal como llega en JSON) coincida con 400
    (int/float/Decimal, tal como puede devolverlo la base) sin exigir que
    el caller adivine el tipo exacto de la columna."""
    num = _to_number(v)
    return num if num is not None else v


def _apply_selected_groups(
    rows: list[dict[str, Any]], selected_groups: "SelectedGroups"
) -> tuple[list[dict[str, Any]], int, str | None]:
    """Restringe 'rows' a las tuplas EXACTAS listadas en selected_groups —
    aplicado en Python sobre filas ya devueltas por la consulta (ver
    SelectedGroups.__doc__ para por qué NO se hace como WHERE SQL).

    Retorna (filas_filtradas, matched_group_count, warning) —
    matched_group_count es la cantidad de combinaciones pedidas que
    realmente aparecen con datos; warning no-None si no coincide con la
    cantidad pedida (valor con error de tipeo, o sin datos bajo los
    'filters' aplicados) — nunca se presenta un resultado de alcance
    distinto sin avisar."""
    allowed = {
        tuple(_normalize_match_value(v) for v in combo)
        for combo in selected_groups.values
    }
    filtered = [
        r
        for r in rows
        if tuple(_normalize_match_value(r.get(c)) for c in selected_groups.columns)
        in allowed
    ]
    matched = len(_sorted_unique_tuples(filtered, selected_groups.columns))
    expected = len(selected_groups.values)
    warning = None
    if filtered and matched != expected:
        warning = (
            f"Se pidieron {expected} combinaciones en selected_groups "
            f"pero solo {matched} aparecen en los datos — puede haber "
            "un valor con error de tipeo/mayúsculas/acentos, o esa "
            "combinación no tiene datos con los 'filters' aplicados. "
            "Verificar con irex.list_column_values antes de asumir que "
            "el gráfico representa el análisis completo."
        )
    return filtered, matched, warning


def _selected_groups_incomplete_response(
    expected: int,
    matched: int,
    truncated_before_selection: bool,
    facet_columns: list[str],
) -> dict[str, Any]:
    """Construye la respuesta status='incomplete' cuando 'matched' < 'expected'
    — SIEMPRE, sin importar la causa (nunca 'success' con un gráfico
    parcial). 'incomplete_reason' distingue dos causas con acciones
    correctivas distintas para quien consuma la respuesta:

    - 'selected_groups_truncated': la consulta tocó el límite de seguridad
      incluso tras ampliarlo — ambiguo, puede haber más datos sin ver.
    - 'selected_groups_missing_data': la consulta corrió completa (sin
      tocar ningún límite) y esas combinaciones simplemente no tienen
      datos con los 'filters' aplicados — no ambiguo, pero igual es una
      discrepancia con lo pedido que el caller debe conocer explícitamente
      vía 'status', no inferirla de 'data_summary.complete'."""
    if truncated_before_selection:
        incomplete_reason = "selected_groups_truncated"
        cause = (
            f"la consulta tocó el límite de seguridad "
            f"({_SELECTED_GROUPS_MAX_ROW_LIMIT} filas) incluso tras "
            "ampliarlo — no se puede distinguir si las combinaciones "
            "faltantes no tienen datos o si fueron cortadas por el límite"
        )
        hint = (
            "Acotá 'selected_groups' a menos combinaciones, agregá "
            "'filters' más específicos sobre otras columnas, o reducí el "
            "rango de 'x' (ej. menos meses) y repetí."
        )
    else:
        incomplete_reason = "selected_groups_missing_data"
        cause = (
            "esas combinaciones no tienen datos con los 'filters' "
            "aplicados (la consulta se ejecutó completa, sin tocar ningún "
            "límite)"
        )
        hint = (
            "Verificar con irex.list_column_values si algún valor tiene "
            "error de tipeo/mayúsculas/acentos, o si "
            "'source_result_ref'/'filters' restringen un período/alcance "
            "donde esas combinaciones no vendieron."
        )
    return {
        "status": "incomplete",
        "incomplete_reason": incomplete_reason,
        "error": (
            f"No se puede mostrar el alcance completo de selected_groups: "
            f"se pidieron {expected} combinaciones, solo {matched} "
            f"aparecen en los datos — {cause}. {hint} NO se muestra un "
            "gráfico parcial como si fuera el análisis completo."
        ),
        "data_summary": {
            "complete": False,
            "facet_columns": facet_columns,
            "selected_group_count": expected,
            "matched_group_count": matched,
            "truncated_before_selection": truncated_before_selection,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def _small_multiples_completeness(
    truncated_before_selection: bool,
    selected_group_count: int | None,
    matched_group_count: int | None,
    requested_x_values: list[Any] | None,
    returned_x_values: list[Any],
) -> bool:
    """True solo si NINGÚN alcance quedó recortado: la consulta no tocó el
    límite antes de aplicar selected_groups, todas las combinaciones
    pedidas (si las hay) aparecen con datos, y el eje X devuelto cubre
    todas las categorías pedidas (si hubo un filtro IN explícito sobre
    'x'). Se expone aparte de chart_option() para poder testearla sin
    ejecutar una consulta real contra Superset."""
    x_domain_complete = (
        set(requested_x_values) <= set(returned_x_values)
        if requested_x_values is not None
        else True
    )
    return (
        not truncated_before_selection
        and (
            selected_group_count is None
            or matched_group_count == selected_group_count
        )
        and x_domain_complete
    )


def _selected_groups_from_cached_rows(
    cached_rows: list[dict[str, Any]], columns: list[str]
) -> "SelectedGroups":
    """Deriva un SelectedGroups a partir de las filas de un report_id
    cacheado (ver source_result_ref) — las tuplas EXACTAS que ese resultado
    ya calculó, sin que el caller tenga que retranscribirlas."""
    tuples = _sorted_unique_tuples(cached_rows, columns)
    return SelectedGroups(columns=columns, values=[list(t) for t in tuples])


def _resolve_source_result_ref(
    request: "ChartOptionRequest",
) -> tuple["ChartOptionRequest", dict[str, Any] | None]:
    """Si 'source_result_ref' está presente, recupera el reporte cacheado
    (report_cache.py — guardado por irex.query_dataset o irex.rank_partitions
    con save_as_report=True) y devuelve una copia de 'request' con 'filters'
    ampliados con los del reporte.

    IMPORTANTE — 'facet_by'/'series_by' NUNCA se derivan automáticamente del
    reporte: son decisiones de DISEÑO VISUAL (qué es panel y qué es serie),
    no del análisis — si el ranking agrupó por ['formato','articulo'] y se
    derivara facet_by=['formato','articulo'] a ciegas, cada combinación se
    volvería su propio panel en vez de 'un panel por formato, una línea por
    artículo dentro de cada uno'. Por eso, para small_multiples, el caller
    SIEMPRE debe declarar 'facet_by' (y opcionalmente 'series_by')
    explícitos junto con 'source_result_ref' — lo único que se deriva
    automáticamente (si no se pasó explícito) es 'selected_groups': las
    tuplas EXACTAS de esas columnas (facet_by ∪ series_by) presentes en las
    filas del reporte.

    Valida que 'facet_by'/'series_by' sean subconjunto de las columnas que
    el reporte agrupó — no tendría sentido (ni sería posible) derivar la
    selección exacta sobre una columna que el ranking/consulta original no
    incluyó.

    Retorna (request_efectivo, error_o_None). No toca 'request' si no hay
    'source_result_ref' (no-op, compatibilidad hacia atrás)."""
    if not request.source_result_ref:
        return request, None

    cached = report_cache.get_report(
        request.source_result_ref, dataset_id_hint=request.dataset_id
    )
    if cached is None:
        return request, {
            "status": "error",
            "error": (
                "source_result_ref inválido, vencido (2 horas), de otro "
                "usuario, o su dataset_id no coincide con el de esta "
                "llamada. Repetir irex.query_dataset o irex.rank_partitions "
                "con save_as_report=True y usar el nuevo report_id."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    cached_filters = [DatasetFilter(**f) for f in cached.get("filters", [])]
    updates: dict[str, Any] = {"filters": cached_filters + request.filters}

    if request.chart_type == "small_multiples":
        facet_cols = _facet_columns(request)
        if not facet_cols:
            return request, {
                "status": "error",
                "error": (
                    "source_result_ref requiere 'facet_by' explícito para "
                    "small_multiples — el reporte referenciado NO determina "
                    "automáticamente qué columna es el panel y cuál es la "
                    "serie (es una decisión de diseño visual). Pasar "
                    "'facet_by' (y opcionalmente 'series_by') junto con "
                    "'source_result_ref'."
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        cached_rows = cached.get("rows")
        cached_groupby = cached.get("groupby") or []
        if not cached_rows or not cached_groupby:
            if not request.selected_groups:
                return request, {
                    "status": "error",
                    "error": (
                        "source_result_ref no contiene filas de groupby "
                        "para derivar 'selected_groups' (fue guardado por "
                        "un modo distinto, o sin 'groupby'). Pasar "
                        "'selected_groups' explícito."
                    ),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
        else:
            selection_cols = _dedupe_preserve_order(
                facet_cols + list(request.series_by)
            )
            missing = [c for c in selection_cols if c not in cached_groupby]
            if missing:
                return request, {
                    "status": "error",
                    "error": (
                        f"'facet_by'/'series_by' incluye columna(s) que el "
                        f"reporte referenciado no agrupó: "
                        f"{', '.join(missing)} (el reporte agrupó por: "
                        f"{', '.join(cached_groupby)}) — no se puede derivar "
                        "la selección exacta sobre una columna ausente del "
                        "análisis original."
                    ),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            if not request.selected_groups:
                updates["selected_groups"] = _selected_groups_from_cached_rows(
                    cached_rows, selection_cols
                )

    return request.model_copy(update=updates), None


def _requested_x_domain(request: "ChartOptionRequest") -> list[Any] | None:
    """Si hay un filtro IN explícito sobre la columna 'x', esos son los
    valores que el caller espera ver en el eje — usarlos como dominio
    completo (con null donde falte dato) en vez de derivar el dominio solo
    de lo que trajo la consulta, que puede quedar corto por truncamiento o
    por combinaciones sin dato para alguna categoría."""
    for f in request.filters:
        if (
            f.column == request.x
            and f.op.strip().upper() == "IN"
            and isinstance(f.value, list)
        ):
            return list(f.value)
    return None


def _selected_groups_scope_filters(
    request: "ChartOptionRequest",
) -> list[dict[str, Any]]:
    """Filtros IN derivados automáticamente de cada columna de
    selected_groups (valores únicos observados en sus tuplas) — reducen el
    universo de filas que trae la consulta ANTES de agregar/truncar, sin
    cambiar el mecanismo de ejecución: van como filtros normales, AND-eados
    junto a los de 'request.filters', vía QueryContextFactory (preservan
    RLS igual que cualquier otro filtro — ver SelectedGroups.__doc__).

    Estos filtros NO reemplazan a 'selected_groups' (siguen trayendo el
    producto cruzado de esos valores) — 'selected_groups' se sigue
    aplicando después como filtro exacto; esto solo acota el volumen para
    reducir el riesgo de que row_limit corte antes de tener todas las
    tuplas pedidas. No se agrega un filtro derivado para una columna que el
    caller ya filtró explícitamente, para no pisar su intención."""
    sg = request.selected_groups
    if not sg:
        return []
    already_filtered = {f.column for f in request.filters}
    derived = []
    for i, col in enumerate(sg.columns):
        if col in already_filtered:
            continue
        seen: list[Any] = []
        for combo in sg.values:
            v = combo[i]
            if v not in seen:
                seen.append(v)
        derived.append({"col": col, "op": "IN", "val": seen})
    return derived


def _sorted_unique(rows: list[dict[str, Any]], column: str) -> list[Any]:
    """Valores únicos no nulos de 'column', ordenados por su tipo real."""
    values = {r.get(column) for r in rows if r.get(column) is not None}
    return sorted(values, key=_sort_key)


def _sorted_unique_tuples(
    rows: list[dict[str, Any]], columns: list[str]
) -> list[tuple[Any, ...]]:
    """Combinaciones únicas no nulas de varias columnas, ordenadas."""
    values = {
        tuple(r.get(c) for c in columns)
        for r in rows
        if all(r.get(c) is not None for c in columns)
    }
    return sorted(values, key=lambda t: tuple(_sort_key(v) for v in t))


class ChartBuildError(Exception):
    """Error de negocio al construir el chart (ej. cardinalidad excesiva)
    — se convierte en una respuesta {status: error} en vez de propagarse."""


def _table_sort_metric(request: ChartOptionRequest) -> str | None:
    """Métrica por la que ordenar la tabla.
    Prioridad: sort_by_metric explícito > última métrica si sort != 'default'."""
    if not request.metrics or request.sort == "default":
        return None
    if request.sort_by_metric and request.sort_by_metric in request.metrics:
        return request.sort_by_metric
    return request.metrics[-1]


def _sort_table_rows(
    table_rows: list[list[Any]],
    sort_col_idx: int,
    descending: bool,
) -> list[list[Any]]:
    """Ordena filas de tabla por el valor numérico de sort_col_idx."""
    return sorted(
        table_rows,
        key=lambda row: _to_number(row[sort_col_idx]) or 0,
        reverse=descending,
    )


def _build_table(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Tabla simple, tabla cruzada (pivot, 1 dimensión + 1 métrica) o tabla
    con filas adicionales planas (2+ dimensiones, o 1 dimensión con 2+
    métricas — el pivot no puede mostrar más de 1 métrica por celda)."""
    metric = request.metrics[0]
    extra_dims = _group_by_list(request)
    sort_metric = _table_sort_metric(request)

    if len(extra_dims) == 1 and len(request.metrics) == 1:
        group_col = extra_dims[0]
        x_raw = _sorted_unique(rows, request.x)
        x_values = [_short_label(v, request.x) for v in x_raw]
        groups = _sorted_unique(rows, group_col)
        if len(groups) > 15:
            raise ChartBuildError(
                f"'{group_col}' tiene {len(groups)} valores distintos — "
                "demasiados para pivotar en columnas (la tabla sería "
                "ilegible). Agregá un filtro para acotar a 15 o menos, o "
                "pedí 2+ métricas para que la tabla use filas en vez de "
                "columnas por cada valor."
            )
        lookup = {
            (_short_label(r.get(request.x), request.x), r.get(group_col)): _round(
                r.get(metric)
            )
            for r in rows
        }
        columns = [request.x] + [str(g) for g in groups]
        table_rows = [
            [x] + [lookup.get((x, g)) for g in groups] for x in x_values
        ]
        # Pivot sort no soportado (columnas son valores de group_col, no métricas fijas)
        return {"columns": columns, "rows": table_rows}

    if extra_dims:
        # 2+ dimensiones, o 1 dimensión con 2+ métricas (el pivot de arriba
        # solo tiene sentido con exactamente 1 métrica por celda).
        dims = [request.x] + extra_dims
        columns = dims + request.metrics
        combos = _sorted_unique_tuples(rows, dims)
        lookup = {tuple(r.get(d) for d in dims): r for r in rows}
        table_rows = []
        for combo in combos:
            r = lookup.get(combo, {})
            table_rows.append(
                [_short_label(v, d) for v, d in zip(combo, dims)]
                + [_round(r.get(m)) for m in request.metrics]
            )
        if sort_metric and sort_metric in request.metrics:
            sort_col_idx = len(dims) + request.metrics.index(sort_metric)
            table_rows = _sort_table_rows(
                table_rows, sort_col_idx, descending=(request.sort == "desc")
            )
        return {"columns": columns, "rows": table_rows}

    columns = [request.x] + request.metrics
    table_rows = [
        [_short_label(r.get(request.x), request.x)]
        + [_round(r.get(m)) for m in request.metrics]
        for r in rows
    ]
    if sort_metric and sort_metric in request.metrics:
        sort_col_idx = 1 + request.metrics.index(sort_metric)
        table_rows = _sort_table_rows(
            table_rows, sort_col_idx, descending=(request.sort == "desc")
        )
    return {"columns": columns, "rows": table_rows}


def _build_pareto(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Barras ordenadas descendente + línea de % acumulado (análisis 80/20)."""
    metric = request.metrics[0]
    metric_label = _metric_display_name(metric)
    title = {"text": request.title} if request.title else None

    totals: dict[str, float] = {}
    for r in rows:
        label = _short_label(r.get(request.x), request.x)
        totals[label] = totals.get(label, 0) + _safe_num(r.get(metric))

    sorted_items = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    x_values = [k for k, _ in sorted_items]
    values = [_round(v) for _, v in sorted_items]
    grand_total = sum(v for _, v in sorted_items) or 1

    cumulative: list[float] = []
    running = 0.0
    for _, v in sorted_items:
        running += v
        cumulative.append(round(running / grand_total * 100, 1))

    return {
        "title": title,
        "tooltip": {"trigger": "axis"},
        "legend": {"top": "bottom"},
        "xAxis": {"type": "category", "data": x_values},
        "yAxis": [
            {"type": "value", "name": metric_label},
            {
                "type": "value",
                "name": "% acumulado",
                "min": 0,
                "max": 100,
                "axisLabel": {"formatter": "{value}%"},
            },
        ],
        "series": [
            {
                "name": metric_label,
                "type": "bar",
                "data": values,
                "label": {"show": True, "position": "top"},
            },
            {
                "name": "% acumulado",
                "type": "line",
                "yAxisIndex": 1,
                "data": cumulative,
                "label": {"show": True, "position": "top", "formatter": "{c}%"},
            },
        ],
    }


def _build_stacked(
    request: ChartOptionRequest, rows: list[dict[str, Any]], kind: str
) -> dict[str, Any]:
    """Barras o área apiladas por group_by (1+ dimensiones, etiqueta
    compuesta si hay más de una)."""
    x_values = [_short_label(v, request.x) for v in _sorted_unique(rows, request.x)]
    dims = _group_by_list(request)
    groups = _sorted_unique_tuples(rows, dims) if dims else []
    metric = request.metrics[0]
    title = {"text": request.title} if request.title else None
    area_style = {"areaStyle": {}} if kind == "area" else {}
    series: list[dict[str, Any]] = []

    for combo in groups:
        lookup = {
            _short_label(r.get(request.x), request.x): _round(r.get(metric))
            for r in rows
            if tuple(r.get(d) for d in dims) == combo
        }
        series.append(
            {
                "name": " | ".join(_short_label(v, d) for v, d in zip(combo, dims)),
                "type": kind,
                "stack": "total",
                "data": [lookup.get(x) for x in x_values],
                "label": {"show": True, "position": "inside"},
                **area_style,
            }
        )

    return {
        "title": title,
        "tooltip": {"trigger": "axis"},
        "legend": {"top": "bottom"},
        "xAxis": {"type": "category", "data": x_values},
        "yAxis": {"type": "value"},
        "series": series,
    }


def _build_combo(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Dos métricas en el mismo gráfico: barras (eje izq) + línea (eje der)."""
    x_values = [_short_label(v, request.x) for v in _sorted_unique(rows, request.x)]
    bar_metric, line_metric = request.metrics[0], request.metrics[1]
    bar_label = _metric_display_name(bar_metric)
    line_label = _metric_display_name(line_metric)
    title = {"text": request.title} if request.title else None

    bar_lookup = {
        _short_label(r.get(request.x), request.x): _round(r.get(bar_metric))
        for r in rows
    }
    line_lookup = {
        _short_label(r.get(request.x), request.x): _round(r.get(line_metric))
        for r in rows
    }

    return {
        "title": title,
        "tooltip": {"trigger": "axis"},
        "legend": {"top": "bottom"},
        "xAxis": {"type": "category", "data": x_values},
        "yAxis": [
            {"type": "value", "name": bar_label},
            {"type": "value", "name": line_label},
        ],
        "series": [
            {
                "name": bar_label,
                "type": "bar",
                "data": [bar_lookup.get(x) for x in x_values],
                "label": {"show": True, "position": "top"},
            },
            {
                "name": line_label,
                "type": "line",
                "yAxisIndex": 1,
                "data": [line_lookup.get(x) for x in x_values],
                "label": {"show": True, "position": "top"},
            },
        ],
    }


def _round_heatmap_val(v: Any) -> float | int | None:
    """Para heatmap: entero si ≥10, 2 decimales si <10.
    Preserva precisión en ratios (0.0–2.0) que _round() convertiría a 0/1/2,
    perdiendo toda variación útil en la escala de color."""
    num = _to_number(v)
    if num is None:
        return None
    if isinstance(num, float) and (num != num or num in (float("inf"), float("-inf"))):
        return None
    if abs(num) >= 10:
        return round(num)
    return round(num, 2)


def _build_heatmap(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Mapa de calor cruzando 'x' (columnas) y la única dimensión de
    group_by (filas)."""
    group_col = _group_by_list(request)[0]
    metric = request.metrics[0]
    metric_label = _metric_display_name(metric)
    title = {"text": request.title} if request.title else None
    x_values = [_short_label(v, request.x) for v in _sorted_unique(rows, request.x)]
    y_values = [_short_label(v, group_col) for v in _sorted_unique(rows, group_col)]
    lookup = {
        (
            _short_label(r.get(request.x), request.x),
            _short_label(r.get(group_col), group_col),
        ): _round_heatmap_val(r.get(metric))
        for r in rows
    }

    # Usar [xCategory, yCategory, val] en vez de [xi, yi, val] para que el
    # modelo pueda leer el resultado directamente sin mapear índices a nombres
    # (ECharts acepta strings de categoría en datos de heatmap con ejes tipo
    # 'category'). El label formatter estático evita que ECharts muestre el
    # triplete completo en la celda.
    data: list[dict[str, Any]] = []
    min_val: float | None = None
    max_val = 0.0
    for xv in x_values:
        for yv in y_values:
            val = lookup.get((xv, yv))
            if val is not None:
                num = _to_number(val)
                if num is not None:
                    max_val = max(max_val, num)
                    min_val = num if min_val is None else min(min_val, num)
                data.append({
                    "value": [xv, yv, val],
                    "label": {"formatter": str(val)},
                })

    return {
        "title": title,
        "tooltip": {"position": "top"},
        "grid": {"height": "70%", "top": "10%", "left": "20%"},
        "xAxis": {"type": "category", "data": x_values, "splitArea": {"show": True}},
        "yAxis": {
            "type": "category",
            "data": y_values,
            "splitArea": {"show": True},
            "axisLabel": {"overflow": "truncate", "width": 150},
        },
        "visualMap": {
            "min": min_val if min_val is not None else 0,
            "max": max_val or 1,
            "calculable": True,
            "orient": "horizontal",
            "left": "center",
            "bottom": "0%",
            "inRange": {"color": ["#d94e5d", "#eac736", "#50a3ba"]},
        },
        "series": [
            {
                "name": metric_label,
                "type": "heatmap",
                "data": data,
                "label": {"show": True},
            }
        ],
    }


def _safe_num(v: Any) -> float:
    """0.0 para None/NaN/strings no numéricos — 'v or 0' NO alcanza porque
    NaN es truthy en Python (bool(float('nan')) es True), así que
    'NaN or 0' sigue dando NaN y contamina cualquier suma posterior.
    También coacciona strings numéricos (ver _to_number)."""
    num = _to_number(v)
    if num is None:
        return 0.0
    if isinstance(num, float) and num != num:
        return 0.0
    return num


def _build_treemap_level(
    rows: list[dict[str, Any]], dims: list[str], metrics: list[str]
) -> list[dict[str, Any]]:
    """Construye recursivamente N niveles de jerarquía para el treemap.
    Con 1 métrica, 'value' es un número (tamaño). Con 2, 'value' es
    [tamaño, color] — ver _build_treemap."""
    if not dims:
        return []
    dim = dims[0]
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        key = _short_label(r.get(dim), dim)
        groups.setdefault(key, []).append(r)

    nodes = []
    for key, sub_rows in groups.items():
        sums = [sum(_safe_num(r.get(m)) for r in sub_rows) for m in metrics]
        value: Any = (
            _round(sums[0]) if len(metrics) == 1 else [_round(s) for s in sums]
        )
        node: dict[str, Any] = {"name": key, "value": value}
        if len(dims) > 1:
            node["children"] = _build_treemap_level(sub_rows, dims[1:], metrics)
        nodes.append(node)
    return nodes


def _build_treemap(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Composición jerárquica. x = nivel 1, cada dimensión de group_by
    agrega un nivel más (jerarquía de N niveles). Con 1 métrica, el tamaño
    de cada casillero es la suma de esa métrica (debe ser una magnitud
    aditiva, ej. kg/monto/cantidad — NUNCA un % o ratio, sumar porcentajes
    entre ramas no tiene sentido). Con 2 métricas, la primera define el
    tamaño (magnitud) y la segunda el color (ej. % cumplimiento) vía
    visualMap, que es la forma correcta de mostrar una proporción dentro
    de un treemap."""
    metrics = request.metrics[:2]
    if len(metrics) == 1 and _looks_like_ratio_expression(metrics[0]):
        raise ChartBuildError(
            f"'{metrics[0]}' parece ser un % o ratio (tiene una función de "
            "agregación y un operador aritmético) — no se puede usar como "
            "única métrica de un treemap: sumar porcentajes entre ramas no "
            "tiene sentido y el gráfico sale con todo en 0 o ilegible. "
            "Pasá 2 métricas: la primera una magnitud aditiva real (ej. "
            "'SUM(sell_in)') que define el tamaño, esta expresión de ratio "
            "como segunda métrica para que defina el COLOR en vez del "
            "tamaño. Si lo que querés es solo el ranking del % por "
            "categoría (sin jerarquía de tamaño), usá chart_type='pareto' "
            "en su lugar."
        )
    title = {"text": request.title} if request.title else None
    dims = [request.x] + _group_by_list(request)
    data = _build_treemap_level(rows, dims, metrics)

    option: dict[str, Any] = {
        "title": title,
        "tooltip": {"formatter": "{b}: {c}"},
        "series": [
            {
                "type": "treemap",
                "data": data,
                "label": {"show": True, "formatter": "{b}: {c}"},
            }
        ],
    }

    if len(metrics) > 1:
        color_values = [
            node["value"][1]
            for node in _flatten_treemap_nodes(data)
            if isinstance(node["value"], list) and node["value"][1] is not None
        ]
        option["visualMap"] = {
            "type": "continuous",
            "dimension": 1,
            "min": min(color_values) if color_values else 0,
            "max": max(color_values) if color_values else 1,
            "calculable": True,
            "orient": "horizontal",
            "left": "center",
            "bottom": "0%",
            "inRange": {"color": ["#d94e5d", "#eac736", "#50a3ba"]},
        }

    return option


def _flatten_treemap_nodes(
    nodes: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    flat = list(nodes)
    for node in nodes:
        children = node.get("children")
        if children:
            flat.extend(_flatten_treemap_nodes(children))
    return flat


def _build_gauge(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """KPI gauge para UN solo valor de tipo porcentaje/cumplimiento.
    La query ya viene como agregado puro (sin dims), así que rows tiene 1 fila."""
    metric = request.metrics[0]
    metric_label = _metric_display_name(metric)
    title = {"text": request.title} if request.title else None

    raw = rows[0].get(metric) if rows else None
    num = _to_number(raw)
    if num is None:
        num = 0.0

    # Auto-escalar: ratio 0–1 (o negativo muy pequeño) → porcentaje *100
    if -2.0 < num < 2.0 and num != 0.0:
        val = round(float(num) * 100, 1)
    elif abs(num) < 10:
        val = round(float(num), 1)
    else:
        val = float(round(num))

    # Determinar si es porcentaje (≤110 cubre cumplimientos con leve sobreplan)
    is_pct = 0 <= val <= 110
    detail_fmt = "{value}%" if is_pct else "{value}"
    gauge_max = 100 if is_pct else max(round(val * 1.25), 1)

    return {
        "title": title,
        "series": [
            {
                "type": "gauge",
                "data": [{"value": val, "name": metric_label}],
                "min": 0,
                "max": gauge_max,
                "radius": "80%",
                "center": ["50%", "60%"],
                "startAngle": 225,
                "endAngle": -45,
                "axisLine": {
                    "lineStyle": {
                        "width": 25,
                        "color": [
                            [0.6, "#d94e5d"],
                            [0.8, "#eac736"],
                            [1.0, "#50a3ba"],
                        ],
                    }
                },
                "pointer": {"itemStyle": {"color": "auto"}},
                "axisTick": {"distance": -28, "length": 6, "lineStyle": {"color": "#fff", "width": 2}},
                "splitLine": {"distance": -35, "length": 14, "lineStyle": {"color": "#fff", "width": 3}},
                "axisLabel": {"color": "inherit", "distance": 40, "fontSize": 12},
                "detail": {
                    "valueAnimation": True,
                    "formatter": detail_fmt,
                    "fontSize": 28,
                    "fontWeight": "bold",
                    "color": "inherit",
                    "offsetCenter": [0, "30%"],
                },
                "title": {"offsetCenter": [0, "10%"], "fontSize": 14},
            }
        ],
    }


def _small_multiples_grid_dims(
    panel_count: int, max_cols: int = 4
) -> tuple[int, int]:
    """(columnas, filas) de la grilla más cuadrada posible (máx 'max_cols'
    columnas) para 'panel_count' paneles — misma fórmula que usa
    _panel_grid_layout para posicionar cada grid, expuesta aparte para el
    data_summary. 'max_cols' se baja cuando cada panel necesita más espacio
    propio (muchas series por panel, o leyenda por panel) — ver
    _build_small_multiples."""
    if panel_count <= 0:
        return 1, 1
    cols = min(max_cols, math.ceil(math.sqrt(panel_count)))
    return cols, math.ceil(panel_count / cols)


def _suggested_container_height_px(panel_rows: int) -> int:
    """Alto sugerido (px) del contenedor del widget para que 'panel_rows'
    filas de mini-gráficos no salgan aplastadas — no es parte de
    echarts_option, es un hint aparte en data_summary (ver chart_option())."""
    return max(320, panel_rows * 220)


def _panel_grid_layout(
    n: int,
    top_reserved_pct: float = 0.0,
    per_facet_legend: bool = False,
    max_cols: int = 4,
) -> tuple[list[dict[str, str]], list[dict[str, str]], list[dict[str, str]] | None]:
    """Posiciones (top/left/width/height en %) para N paneles en una grilla
    lo más cuadrada posible, dejando 'top_reserved_pct' de franja superior
    LIBRE de paneles (para título general y/o leyenda global — ver
    _build_small_multiples) y, dentro de cada celda, una franja para el
    título del panel y (si per_facet_legend) otra para su propia mini-
    leyenda, para que ningún elemento se superponga con otro.

    Devuelve (grids, title_positions, legend_positions) con índices
    paralelos — legend_positions es None si per_facet_legend es False."""
    cols, n_rows = _small_multiples_grid_dims(n, max_cols)
    h_gap, v_gap, label_h = 6, 14, 6  # % de la celda
    legend_h = 6 if per_facet_legend else 0
    available_h = 100 - top_reserved_pct
    cell_w, cell_h = 100 / cols, available_h / n_rows

    grids: list[dict[str, str]] = []
    title_positions: list[dict[str, str]] = []
    legend_positions: list[dict[str, str]] | None = [] if per_facet_legend else None
    for i in range(n):
        r, c = divmod(i, cols)
        cell_left = c * cell_w
        cell_top = top_reserved_pct + r * cell_h
        grids.append({
            "left": f"{cell_left + h_gap / 2:.1f}%",
            "top": f"{cell_top + v_gap / 2 + label_h + legend_h:.1f}%",
            "width": f"{cell_w - h_gap:.1f}%",
            "height": f"{cell_h - v_gap - label_h - legend_h:.1f}%",
        })
        title_positions.append({
            "left": f"{cell_left + h_gap / 2:.1f}%",
            "top": f"{cell_top + v_gap / 2:.1f}%",
        })
        if legend_positions is not None:
            legend_positions.append({
                "left": f"{cell_left + h_gap / 2:.1f}%",
                "top": f"{cell_top + v_gap / 2 + label_h:.1f}%",
                "width": f"{cell_w - h_gap:.1f}%",
            })
    return grids, title_positions, legend_positions


_SERIES_COLOR_PALETTE = [
    "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
    "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc", "#5c7bd9",
]


def _stable_series_colors(names_in_order: list[str]) -> dict[str, str]:
    """Asigna un color estable por NOMBRE único de serie, en orden de
    primera aparición — para que la misma serie (ej. mismo canal/artículo)
    tenga el mismo color en todos los paneles donde aparezca. Sin esto,
    ECharts asigna colores por índice de aparición en el array 'series'
    global, que puede variar entre paneles cuando no todos tienen las
    mismas series en el mismo orden."""
    unique_names = _dedupe_preserve_order(names_in_order)
    return {
        name: _SERIES_COLOR_PALETTE[i % len(_SERIES_COLOR_PALETTE)]
        for i, name in enumerate(unique_names)
    }


_LEGEND_UNIQUE_NAMES_THRESHOLD = 6


def _resolve_legend_mode(
    request: "ChartOptionRequest", unique_series_names: list[str]
) -> str:
    """Decide cómo mostrar la leyenda de small_multiples — ver
    'legend_mode' en ChartOptionRequest para la semántica completa.
    Devuelve 'none', 'global' o 'per_facet'.

    Nota técnica: ECharts recibe este option ya serializado a JSON puro
    (sin funciones) — 'legend.formatter' no puede truncar texto de forma
    dinámica sin una función JS, que el widget del chat no evalúa. Por eso
    la respuesta a "nombres largos/demasiados" acá es 'type: scroll'
    (navegable, nunca corta texto a medias) en vez de abreviar el label."""
    if request.legend_mode == "per_facet":
        return "per_facet"
    if request.legend_mode == "scroll":
        return "global"
    if not request.series_by and len(request.metrics) <= 1:
        return "none"
    if len(unique_series_names) > _LEGEND_UNIQUE_NAMES_THRESHOLD:
        return "per_facet"
    return "global"


def _build_small_multiples(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    """Grilla de mini-gráficos idénticos (mismo eje X, misma escala Y), uno
    por cada combinación única de 'facet_by' (o 'group_by' si 'facet_by' no
    se especificó) — para comparar la FORMA de la serie entre categorías de
    un vistazo, en vez de superponer muchas líneas en un solo gráfico.

    La identidad de cada panel es la TUPLA completa de valores de las
    columnas de facet — nunca una cadena concatenada (evita colisiones si
    algún valor contiene el separador usado en el título). Dentro de cada
    panel: si 'series_by' está vacío, cada métrica de 'metrics' es su propia
    serie; si no, cada combinación de 'series_by' es una serie (usando solo
    la primera métrica).

    El dominio del eje X respeta un filtro IN explícito sobre 'x' si existe
    (ver _requested_x_domain) — las categorías pedidas se muestran siempre,
    con null donde no haya dato, en vez de recortarse silenciosamente a lo
    que trajo la consulta."""
    facet_cols = _facet_columns(request)
    series_cols = list(request.series_by)
    combos = _sorted_unique_tuples(rows, facet_cols)
    if len(combos) > request.max_panels:
        raise ChartBuildError(
            f"'{', '.join(facet_cols)}' tiene {len(combos)} combinaciones "
            f"distintas — demasiadas para small multiples (máx "
            f"{request.max_panels} paneles, la grilla sería ilegible). "
            "Agregá un filtro (o 'selected_groups') para acotar la "
            "cantidad de categorías."
        )

    requested_x = _requested_x_domain(request)
    x_raw = (
        sorted(set(requested_x), key=_sort_key)
        if requested_x
        else _sorted_unique(rows, request.x)
    )
    x_values = [_short_label(v, request.x) for v in x_raw]
    kind = "line" if request.panel_type in ("line", "area") else "bar"
    area_style = {"areaStyle": {}} if request.panel_type == "area" else {}

    # Filas y nombres de serie por panel, precalculados ANTES de armar el
    # layout — la densidad (series por panel) y la cantidad de nombres
    # únicos determinan cuántas columnas caben y qué modo de leyenda usar.
    rows_by_panel: dict[tuple[Any, ...], list[dict[str, Any]]] = {
        combo: [r for r in rows if tuple(r.get(c) for c in facet_cols) == combo]
        for combo in combos
    }
    if series_cols:
        names_by_panel = {
            combo: [
                " | ".join(_short_label(v, c) for v, c in zip(sc, series_cols))
                for sc in _sorted_unique_tuples(rows_by_panel[combo], series_cols)
            ]
            for combo in combos
        }
    else:
        names_by_panel = {
            combo: [_metric_display_name(m) for m in request.metrics]
            for combo in combos
        }
    all_names_flat = [n for names in names_by_panel.values() for n in names]
    unique_names = _dedupe_preserve_order(all_names_flat)
    color_by_name = _stable_series_colors(all_names_flat)
    legend_mode = _resolve_legend_mode(request, unique_names)

    avg_series_per_panel = (len(all_names_flat) / len(combos)) if combos else 0
    if legend_mode == "per_facet" or avg_series_per_panel > 6:
        max_cols = 2
    elif avg_series_per_panel > 3:
        max_cols = 3
    else:
        max_cols = 4

    top_reserved = 0.0
    if request.title:
        top_reserved += 8.0
    if legend_mode == "global":
        top_reserved += 8.0

    grids, title_positions, legend_positions = _panel_grid_layout(
        len(combos),
        top_reserved_pct=top_reserved,
        per_facet_legend=(legend_mode == "per_facet"),
        max_cols=max_cols,
    )

    x_axes: list[dict[str, Any]] = []
    y_axes: list[dict[str, Any]] = []
    series: list[dict[str, Any]] = []
    panel_titles: list[dict[str, Any]] = []
    panel_legends: list[dict[str, Any]] = []
    all_values: list[float] = []

    for i, combo in enumerate(combos):
        panel_rows = rows_by_panel[combo]
        label = " · ".join(_short_label(v, c) for v, c in zip(combo, facet_cols))

        x_axes.append({
            "type": "category",
            "data": x_values,
            "gridIndex": i,
            "axisLabel": {"fontSize": 9},
        })
        y_axes.append({"type": "value", "gridIndex": i, "axisLabel": {"fontSize": 9}})
        panel_titles.append({
            "text": label,
            "left": title_positions[i]["left"],
            "top": title_positions[i]["top"],
            "textStyle": {"fontSize": 11, "fontWeight": "normal"},
        })
        if legend_mode == "per_facet":
            panel_names = names_by_panel[combo]
            panel_legends.append({
                "type": "scroll" if len(panel_names) > _LEGEND_UNIQUE_NAMES_THRESHOLD else "plain",
                "data": panel_names,
                "left": legend_positions[i]["left"],
                "top": legend_positions[i]["top"],
                "width": legend_positions[i]["width"],
                "itemWidth": 10,
                "itemHeight": 8,
                "textStyle": {"fontSize": 8},
            })

        if series_cols:
            series_combos = _sorted_unique_tuples(panel_rows, series_cols)
            metric = request.metrics[0]
            for series_combo in series_combos:
                series_rows = [
                    r
                    for r in panel_rows
                    if tuple(r.get(c) for c in series_cols) == series_combo
                ]
                lookup = {
                    _short_label(r.get(request.x), request.x): _round(r.get(metric))
                    for r in series_rows
                }
                values = [lookup.get(x) for x in x_values]
                all_values.extend(v for v in values if v is not None)
                series_name = " | ".join(
                    _short_label(v, c) for v, c in zip(series_combo, series_cols)
                )
                color = color_by_name.get(series_name)
                series.append({
                    "name": series_name,
                    "type": kind,
                    "xAxisIndex": i,
                    "yAxisIndex": i,
                    "data": values,
                    **({"itemStyle": {"color": color}, "lineStyle": {"color": color}} if color else {}),
                    **area_style,
                })
        else:
            for metric in request.metrics:
                lookup = {
                    _short_label(r.get(request.x), request.x): _round(r.get(metric))
                    for r in panel_rows
                }
                values = [lookup.get(x) for x in x_values]
                all_values.extend(v for v in values if v is not None)
                series_name = _metric_display_name(metric)
                color = color_by_name.get(series_name)
                series.append({
                    "name": series_name,
                    "type": kind,
                    "xAxisIndex": i,
                    "yAxisIndex": i,
                    "data": values,
                    **({"itemStyle": {"color": color}, "lineStyle": {"color": color}} if color else {}),
                    **area_style,
                })

    y_max = max(all_values) if all_values else 1
    for y_axis in y_axes:
        y_axis["min"] = 0
        y_axis["max"] = y_max

    titles: list[dict[str, Any]] = []
    if request.title:
        titles.append({"text": request.title, "left": "center", "top": "1%"})
    titles.extend(panel_titles)

    option: dict[str, Any] = {
        "title": titles,
        "tooltip": {"trigger": "axis"},
        "grid": grids,
        "xAxis": x_axes,
        "yAxis": y_axes,
        "series": series,
    }
    if legend_mode == "global":
        option["legend"] = {
            "top": "9%" if request.title else "1%",
            "type": "scroll" if len(unique_names) > 8 else "plain",
            "data": unique_names,
        }
    elif legend_mode == "per_facet":
        option["legend"] = panel_legends
    return option


def _build_option(
    request: ChartOptionRequest, rows: list[dict[str, Any]]
) -> dict[str, Any]:
    metric_labels = request.metrics
    title = {"text": request.title} if request.title else None
    value_label = {"show": True, "position": "top"}

    if request.chart_type == "pie":
        metric = metric_labels[0]
        data = [
            {
                "name": _short_label(r.get(request.x), request.x),
                "value": _round(r.get(metric)) or 0,
            }
            for r in rows
        ]
        return {
            "title": title,
            "tooltip": {"trigger": "item"},
            "legend": {"top": "bottom"},
            "series": [
                {
                    "type": "pie",
                    "radius": "60%",
                    "data": data,
                    "label": {"show": True, "formatter": "{b}: {c}"},
                }
            ],
        }

    if request.chart_type == "scatter":
        metric = metric_labels[0]
        data = [[r.get(request.x), _round(r.get(metric))] for r in rows]
        return {
            "title": title,
            "tooltip": {"trigger": "item"},
            "xAxis": {"type": "value"},
            "yAxis": {"type": "value"},
            "series": [{"type": "scatter", "data": data}],
        }

    # line / bar / area
    x_values = [_short_label(v, request.x) for v in _sorted_unique(rows, request.x)]
    kind = "line" if request.chart_type in ("line", "area") else "bar"
    area_style = {"areaStyle": {}} if request.chart_type == "area" else {}
    series: list[dict[str, Any]] = []

    dims = _group_by_list(request)
    if dims:
        groups = _sorted_unique_tuples(rows, dims)
        metric = metric_labels[0]
        for combo in groups:
            lookup = {
                _short_label(r.get(request.x), request.x): _round(r.get(metric))
                for r in rows
                if tuple(r.get(d) for d in dims) == combo
            }
            series.append(
                {
                    "name": " | ".join(_short_label(v, d) for v, d in zip(combo, dims)),
                    "type": kind,
                    "data": [lookup.get(x) for x in x_values],
                    "label": value_label,
                    **area_style,
                }
            )
    else:
        if len(rows) > len(x_values):
            raise ChartBuildError(
                f"Hay {len(rows)} filas pero solo {len(x_values)} valores "
                f"distintos de '{request.x}' — significa que hay más de una "
                "fila por cada punto del eje X (ej. varios productos/"
                "entidades filtrados a la vez) y sin 'group_by' se pisan "
                "entre sí en silencio, mostrando solo una serie en vez de "
                "comparar. Agregá la columna que las distingue (ej. "
                "'articulo', 'nombre_cliente') a 'group_by' para que cada "
                "una sea su propia serie."
            )
        # Ordenar x_values UNA sola vez antes del loop de series.
        # sort_by_metric explícito > primera métrica por defecto.
        # Solo aplica a 'bar' (ranking de categorías) — en 'line'/'area' el
        # eje X suele ser temporal/secuencial y reordenarlo por valor de
        # métrica rompe la lectura de la serie (ver _line_area_sort_ignored_warning).
        if request.sort in ("asc", "desc") and request.chart_type == "bar":
            sort_label = (
                request.sort_by_metric
                if request.sort_by_metric and request.sort_by_metric in metric_labels
                else metric_labels[0]
            )
            sort_lookup = {
                _short_label(r.get(request.x), request.x): _round(r.get(sort_label))
                for r in rows
            }
            x_values = sorted(
                x_values,
                key=lambda xv: _to_number(sort_lookup.get(xv)) or 0,
                reverse=(request.sort == "desc"),
            )
        for metric in metric_labels:
            lookup = {
                _short_label(r.get(request.x), request.x): _round(r.get(metric))
                for r in rows
            }
            series.append(
                {
                    "name": _metric_display_name(metric),
                    "type": kind,
                    "data": [lookup.get(x) for x in x_values],
                    "label": value_label,
                    **area_style,
                }
            )

    return {
        "title": title,
        "tooltip": {"trigger": "axis"},
        "legend": {"top": "bottom"},
        "xAxis": {"type": "category", "data": x_values},
        "yAxis": {"type": "value"},
        "series": series,
    }


_TRUNCATION_WARNING = (
    "Se alcanzó row_limit — pueden existir más combinaciones/categorías no "
    "mostradas en este gráfico/tabla. NO asumas que es el conjunto completo. "
    "Agregá filtros para acotar, reducí la cantidad de dimensiones en "
    "group_by, o usá irex.query_dataset con row_limit más alto si necesitás "
    "verificar el total exacto."
)


def _ungrouped_in_filter_warning(
    request: "ChartOptionRequest", dims: list[str]
) -> str | None:
    """Si hay un filtro IN con 2+ valores sobre una columna que NO está en
    x/group_by (o, en small_multiples, ni en facet_by/series_by), esos
    valores se agregan (SUM/AVG/etc.) en un solo número en vez de quedar
    comparables — el SQL agrupa solo por 'dims', así que la columna
    filtrada se mezcla ANTES de que el código Python pueda separarla.

    Esta advertencia solo tiene sentido cuando el request NO declaró NINGÚN
    mecanismo de agrupación/comparación (group_by, o facet_by/series_by en
    small_multiples) — ahí sí hay evidencia real de que el caller pudo
    haber olvidado agrupar. Si YA declaró alguno (aunque sea sobre otra
    columna), un filtro IN amplio en una columna distinta es casi siempre
    alcance intencional (acotar el universo de datos), no un descuido —
    advertir en ese caso sería una instrucción falsa (ver reporte del
    agente del chat: 'agregar valores filtrados es una operación válida')."""
    has_comparison_dims = (
        bool(_facet_columns(request) or request.series_by)
        if request.chart_type == "small_multiples"
        else bool(_group_by_list(request))
    )
    if has_comparison_dims:
        return None
    dim_hint = "'facet_by'/'series_by'" if request.chart_type == "small_multiples" else "'group_by'"
    for f in request.filters:
        if (
            f.op.strip().upper() == "IN"
            and isinstance(f.value, list)
            and len(f.value) > 1
            and f.column not in dims
        ):
            return (
                f"El filtro IN sobre '{f.column}' tiene {len(f.value)} "
                f"valores, pero esa columna no está en 'x' ni {dim_hint} — "
                "sus valores se agregaron juntos en un solo número por "
                "punto, no quedaron comparables entre sí. Si la intención "
                f"era comparar esos {len(f.value)} valores como series/"
                f"paneles separados, agregá '{f.column}' a {dim_hint} y "
                "repetí la consulta."
            )
    return None


def _line_area_sort_ignored_warning(request: "ChartOptionRequest") -> str | None:
    """Avisa cuando se pidió sort='asc'/'desc' en un line/area sin group_by
    y fue ignorado. En ese caso el eje X mantiene su orden natural (numérico/
    cronológico si aplica) — reordenarlo por valor de métrica, como hace
    'bar', desalinearía una serie temporal (ver commit del fix de este bug)."""
    if (
        request.chart_type in ("line", "area")
        and request.sort in ("asc", "desc")
        and not _group_by_list(request)
    ):
        return (
            f"sort='{request.sort}' no se aplicó: en gráficos 'line'/'area' "
            "sin group_by, el eje X mantiene su orden natural (cronológico/"
            "numérico) en vez de reordenarse por el valor de la métrica — "
            "reordenar rompería la lectura de la serie temporal. Si "
            "necesitás categorías ordenadas por valor, usá chart_type='bar'."
        )
    return None


def _execute_chart_query(
    request: "ChartOptionRequest",
    dims: list[str],
    row_limit: int,
    extra_filters: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]] | None, bool, dict[str, Any] | None]:
    """Ejecuta la consulta de chart_option con un 'row_limit' y filtros
    extra dados (AND-eados con los de 'request.filters' — ej. filtros IN
    derivados automáticamente para acotar el universo, ver
    _selected_groups_scope_filters). Sigue yendo por QueryContextFactory:
    mismo RLS, mismos filtros Jinja/nativos que cualquier otra llamada.

    Retorna (rows, truncated, error) — 'error' es un dict {status:'error',
    ...} listo para devolver tal cual si algo falló; None si la consulta
    corrió sin errores (rows puede seguir siendo una lista vacía)."""
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    with _jinja_filters_context(request.jinja_filters) as forced:
        factory = QueryContextFactory()
        query_context = factory.create(
            datasource={"id": request.dataset_id, "type": "table"},
            force=forced,
            queries=[
                {
                    "filters": [_parse_filter(f) for f in request.filters]
                    + list(extra_filters or []),
                    "columns": dims,
                    "metrics": [_parse_metric(m) for m in request.metrics],
                    "row_limit": row_limit,
                }
            ],
            form_data={
                "datasource": f"{request.dataset_id}__table",
                "viz_type": "table",
            },
        )
        command = ChartDataCommand(query_context)
        command.validate()
        try:
            result = command.run()
        except Exception as exc:
            err_str = str(exc)
            hint = ""
            if "division by zero" in err_str.lower() or "divide by zero" in err_str.lower():
                hint = (
                    " Si la métrica usa '%', agregar NULLIF al denominador: "
                    "ej. 'SUM(sell_out)/NULLIF(SUM(plan),0)*100'."
                )
            return None, False, {
                "status": "error",
                "error": f"Error ejecutando la consulta: {err_str}.{hint}",
            }

    query_result = (result or {}).get("queries", [{}])[0]

    if query_result.get("error"):
        return None, False, {
            "status": "error",
            "error": query_result["error"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    rejected_filters = query_result.get("rejected_filters", [])
    if rejected_filters and request.filters:
        rejected_cols = ", ".join(str(r.get("column", r)) for r in rejected_filters)
        return None, False, {
            "status": "error",
            "error": (
                f"Filtro rechazado — columna(s) no encontrada(s) en el dataset: "
                f"{rejected_cols}. Verificar el nombre exacto en dataset.columns de "
                "irex.get_query_context (con el dashboard_id correspondiente)."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    rows = query_result.get("data") or []
    truncated = len(rows) >= row_limit
    return rows, truncated, None


# Límite de seguridad para el reintento de small_multiples con
# selected_groups — techo máximo (igual al usado en query_dataset.py para
# summarize=True) para no arriesgar timeouts/payloads enormes cuando no se
# puede garantizar completitud ni ampliando el límite.
_SELECTED_GROUPS_MAX_ROW_LIMIT = 5000


@tool(
    name="irex.chart_option",
    description=(
        "Genera una visualización para renderizar en el chat, SIN crear ni "
        "guardar ningún objeto en Superset. Es la ÚNICA herramienta para "
        "mostrar gráficos. Si el usuario pide guardar el gráfico en Superset "
        "o agregarlo a un dashboard, responder: 'Esa función no está "
        "disponible desde el chat.' "
        "Tipos soportados:\n"
        "- line/bar/area/pie/scatter: gráficos simples (echarts_option)\n"
        "- table: tabla simple, tabla cruzada/pivot (group_by con 1 "
        "dimensión), o tabla con filas adicionales (group_by con 2+ "
        "dimensiones, ej. ['marca_nombre','familia_nombre']) — devuelve "
        "table_data con columns/rows\n"
        "- pareto: barras ordenadas descendente + línea de % acumulado — "
        "usar para análisis 80/20 ('qué causas explican el 80% de X')\n"
        "- stacked_bar/stacked_area: igual que bar/area pero con las series "
        "de group_by APILADAS en vez de lado a lado — usar para 'composición "
        "de X por Y a lo largo del tiempo'\n"
        "- combo: dos métricas en un gráfico, la primera como barras (eje "
        "izq) y la segunda como línea (eje der) — usar para comparar plan "
        "vs real, ej. sell_in vs forecast\n"
        "- heatmap: mapa de calor cruzando x y group_by (group_by debe ser "
        "EXACTAMENTE 1 dimensión). La métrica define el COLOR de cada celda "
        "— usar SOLO 1 métrica. IMPORTANTE para ratios/cumplimiento: SIEMPRE "
        "multiplicar por 100 para que las celdas muestren '88' en vez de "
        "'0.88' — ej. métrica = 'SUM(sell_in)/NULLIF(SUM(enfirme),0)*100'. "
        "Para volumen absoluto usar la métrica directa (ej. 'SUM(sell_in)'). "
        "El color por defecto va de ROJO (valores bajos / mal desempeño) a "
        "AZUL (valores altos / buen desempeño) — útil para cumplimiento donde "
        "rojo = bajo % (problema) y azul = alto % (bien).\n"
        "- treemap: composición jerárquica (x = nivel 1, cada dimensión de "
        "group_by agrega un nivel más) — usar para 'composición de X por "
        "marca/familia/producto'. Con 1 métrica, el tamaño de cada casillero "
        "es la SUMA de esa métrica — debe ser una magnitud aditiva (kg, "
        "monto, cantidad). NUNCA usar un %/ratio (ej. cumplimiento) como "
        "única métrica de un treemap: sumar porcentajes entre ramas no "
        "significa nada y el gráfico sale ilegible. Para mostrar cumplimiento "
        "o cualquier ratio EN un treemap, pasar 2 métricas: la primera una "
        "magnitud (ej. 'SUM(sell_in)') que define el tamaño, la segunda el "
        "ratio (ej. 'SUM(sell_in)/NULLIF(SUM(cuota),0)*100') que define el "
        "color vía escala de colores — así el tamaño muestra volumen real y "
        "el color muestra qué tan bien/mal va cada parte.\n"
        "- gauge: notómetro para UN SOLO KPI global (sin group_by). Ideal "
        "para responder '¿cuál es el % de cumplimiento total?' — muestra el "
        "valor con aguja y escala de color: rojo (0–60%), amarillo (60–80%), "
        "azul (80–100%). La métrica DEBE ser un ratio *100 (ej. "
        "'SUM(sell_in)/NULLIF(SUM(planv),0)*100') — si se pasa un ratio en "
        "escala 0–1 se auto-escala a porcentaje. x se ignora: pasar cualquier "
        "columna válida del dataset. NO usar si se quieren comparar VARIOS "
        "valores (usar heatmap o bar para eso).\n"
        "- small_multiples: grilla de mini-gráficos IDÉNTICOS (mismo eje X, "
        "misma escala Y), uno por cada combinación única de 'facet_by' — "
        "usar en vez de superponer muchas líneas/barras en un solo gráfico "
        "cuando lo que importa es comparar la FORMA de cada serie de un "
        "vistazo (ej. 'tendencia mensual de precio, un panel por artículo+"
        "formato'). 'facet_by' (lista de columnas, OBLIGATORIO salvo que se "
        "use 'group_by' heredado) define qué TUPLA de valores identifica "
        "cada panel — máx 'max_panels' combinaciones (default 12, "
        "configurable hasta 24; si hay más, filtrar antes o usar "
        "'selected_groups'). 'series_by' (opcional) agrega líneas separadas "
        "DENTRO de cada panel sin afectar de qué panel se trata (ej. "
        "facet_by=['articulo'], series_by=['canal'] → un panel por "
        "artículo, una línea por canal dentro de cada uno). 'panel_type' "
        "(line/bar/area, default 'line') define el tipo de gráfico dentro "
        "de cada panel. "
        "IMPORTANTE — 'selected_groups' para tuplas EXACTAS: cuando ya se "
        "conoce de antemano el conjunto exacto de combinaciones a graficar "
        "(ej. resultado de un ranking/top-N calculado con "
        "irex.query_dataset agrupando por esas mismas columnas), NO tratar "
        "de reproducirlo con 'filters' de tipo IN independientes por "
        "columna — eso selecciona el PRODUCTO CRUZADO de esos valores, no "
        "las combinaciones originales (ej. articulo IN ['A','B'] + formato "
        "IN ['X','Y'] trae 4 combinaciones aunque el ranking solo tuviera "
        "2). En su lugar, pasar esas combinaciones en "
        "'selected_groups': {'columns': [...], 'values': [[...], ...]} — "
        "se aplica sobre el resultado ya traído y garantiza EXACTAMENTE esas "
        "tuplas, ni una combinación cruzada de más. Internamente también "
        "derivan filtros IN amplios por cada columna de selected_groups "
        "para acotar el volumen consultado y evitar que row_limit corte "
        "antes de tener todas las tuplas — si aun así no se puede "
        "garantizar el alcance completo, la respuesta es status='incomplete' "
        "(NUNCA un gráfico parcial disfrazado de éxito). "
        "data_summary trae SIEMPRE: complete (bool — false si algo quedó "
        "recortado), facet_count, matched_group_count/selected_group_count "
        "(si se usó selected_groups), requested_x_values/returned_x_values "
        "(si 'x' tuvo un filtro IN explícito — el eje conserva esas "
        "categorías con null donde falte dato, nunca las recorta en "
        "silencio) y truncated_before_selection.\n"
        "'legend_mode' (auto/per_facet/scroll, default 'auto') controla la "
        "leyenda cuando 'series_by' genera varios nombres: 'auto' usa una "
        "leyenda por panel (solo sus propias series) si hay muchos nombres "
        "distintos en total, para no mezclar series de paneles distintos en "
        "una leyenda global gigante.\n"
        "MEJOR AÚN que redactar 'selected_groups' a mano: si el ranking/top-N "
        "se calculó con irex.query_dataset(save_as_report=True), pasar el "
        "'report_id' que devolvió como 'source_result_ref' acá — deriva "
        "'facet_by'/'selected_groups' automáticamente de ESE resultado ya "
        "verificado (sin retranscribir nada) y hereda sus 'filters' base, "
        "evitando que el gráfico reproduzca el ranking con un alcance "
        "ligeramente distinto.\n"
        "group_by acepta 1 dimensión (string) o varias (lista de strings) "
        "en todos los tipos salvo heatmap (exactamente 1) y pie/pareto/combo "
        "(no la usan); en small_multiples es el mecanismo HEREDADO para "
        "identidad de panel — preferir 'facet_by'. "
        "Respeta el row-level security del dataset igual que irex.query_dataset."
    ),
    tags=["irex", "chart", "grafico", "tabla", "echarts", "visualizacion"],
)
def chart_option(request: ChartOptionRequest) -> dict[str, Any]:
    from .dashboard_dataset_context import _reject_hidden_columns

    request, source_ref_error = _resolve_source_result_ref(request)
    if source_ref_error is not None:
        return source_ref_error

    extra_dims = _group_by_list(request)
    sm_dims: list[str] = []
    if request.chart_type == "small_multiples":
        sm_dims = _facet_columns(request) + list(request.series_by)
        if request.selected_groups:
            sm_dims += request.selected_groups.columns
        sm_dims = _dedupe_preserve_order(sm_dims)
    referenced = (
        {request.x}
        | set(extra_dims)
        | set(sm_dims)
        | {f.column for f in request.filters}
    )
    hidden_error = _reject_hidden_columns(request.dataset_id, referenced)
    if hidden_error:
        return {
            "status": "error",
            "error": hidden_error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # gauge es un agregado puro — no necesita ninguna dimensión en el GROUP BY
    if request.chart_type == "gauge":
        dims = []
    elif request.chart_type == "small_multiples":
        dims = _dedupe_preserve_order([request.x] + sm_dims)
    else:
        dims = [request.x] + extra_dims
    ungrouped_warning = _ungrouped_in_filter_warning(request, dims)
    sort_ignored_warning = _line_area_sort_ignored_warning(request)

    # Para small_multiples con selected_groups: derivar filtros IN amplios
    # por cada columna de selected_groups (acota el universo de datos ANTES
    # de agregar/truncar) y calcular un row_limit efectivo que cubra el
    # peor caso razonable (todas las tuplas pedidas × todos los valores de
    # x esperados) — sin esto, row_limit puede cortar la consulta ANTES de
    # que aparezcan todas las combinaciones pedidas, y el post-filtro de
    # selected_groups nunca las ve (ver _apply_selected_groups.__doc__).
    extra_query_filters: list[dict[str, Any]] = []
    effective_row_limit = request.row_limit
    if request.chart_type == "small_multiples" and request.selected_groups:
        extra_query_filters = _selected_groups_scope_filters(request)
        requested_x = _requested_x_domain(request)
        x_count_estimate = len(set(requested_x)) if requested_x else 30
        effective_row_limit = min(
            _SELECTED_GROUPS_MAX_ROW_LIMIT,
            max(
                request.row_limit,
                len(request.selected_groups.values) * x_count_estimate,
            ),
        )

    rows, truncated, error_response = _execute_chart_query(
        request, dims, effective_row_limit, extra_query_filters
    )
    if error_response is not None:
        return error_response
    if not rows:
        return {
            "status": "error",
            "error": (
                "La consulta no encontró ninguna fila — el gráfico saldría "
                "vacío. Lo más probable es que algún valor de 'filters' no "
                "coincida exactamente con los datos reales (ej. mayúsculas, "
                "acentos, o un valor inventado como 'Kgs' en vez de 'Kg'). "
                "Verificá los valores exactos con irex.list_column_values "
                "ANTES de reintentar, no asumas el formato del valor."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    _remap_rows_to_raw_metrics(rows, request.metrics)

    matched_group_count: int | None = None
    truncated_before_selection = truncated
    if request.chart_type == "small_multiples" and request.selected_groups:
        expected = len(request.selected_groups.values)
        filtered_rows, matched_group_count, _ = _apply_selected_groups(
            rows, request.selected_groups
        )
        if truncated and matched_group_count < expected:
            # No se puede distinguir "esas tuplas no tienen datos" de
            # "existen pero row_limit las cortó" — reintentar UNA vez con
            # el límite máximo de seguridad antes de resignarse.
            if effective_row_limit < _SELECTED_GROUPS_MAX_ROW_LIMIT:
                retry_rows, retry_truncated, retry_error = _execute_chart_query(
                    request,
                    dims,
                    _SELECTED_GROUPS_MAX_ROW_LIMIT,
                    extra_query_filters,
                )
                if retry_error is None and retry_rows:
                    _remap_rows_to_raw_metrics(retry_rows, request.metrics)
                    rows, truncated = retry_rows, retry_truncated
                    truncated_before_selection = retry_truncated
                    filtered_rows, matched_group_count, _ = _apply_selected_groups(
                        rows, request.selected_groups
                    )
        rows = filtered_rows
        if not rows:
            return {
                "status": "error",
                "error": (
                    "selected_groups no coincidió con ninguna fila de la "
                    "consulta — revisar que los valores sean EXACTOS "
                    "(mayúsculas, acentos, espacios) con "
                    "irex.list_column_values, y que 'filters' no excluya "
                    "esas combinaciones."
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        # CUALQUIER discrepancia entre lo pedido y lo obtenido es
        # 'incomplete' — nunca 'success' con un gráfico parcial.
        if matched_group_count < expected:
            return _selected_groups_incomplete_response(
                expected=expected,
                matched=matched_group_count,
                truncated_before_selection=truncated_before_selection,
                facet_columns=_facet_columns(request),
            )

    try:
        if request.chart_type == "table":
            response: dict[str, Any] = {
                "status": "success",
                "table_data": _build_table(request, rows),
                "row_count": len(rows),
                "truncated": truncated,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            warnings = [w for w in (ungrouped_warning, _TRUNCATION_WARNING if truncated else None) if w]
            if warnings:
                response["warning"] = " ".join(warnings)
            return response

        builders = {
            "pareto": _build_pareto,
            "stacked_bar": lambda req, r: _build_stacked(req, r, "bar"),
            "stacked_area": lambda req, r: _build_stacked(req, r, "area"),
            "combo": _build_combo,
            "heatmap": _build_heatmap,
            "treemap": _build_treemap,
            "gauge": _build_gauge,
            "small_multiples": _build_small_multiples,
        }
        builder = builders.get(request.chart_type, _build_option)
        option = builder(request, rows)
    except ChartBuildError as exc:
        return {
            "status": "error",
            "error": str(exc),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    response = {
        "status": "success",
        "echarts_option": option,
        "row_count": len(rows),
        "truncated": truncated,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Para small_multiples: el widget del chat renderiza el contenedor con
    # una altura pensada para UN gráfico — con varios paneles apilados en
    # filas necesita más alto o los paneles salen aplastados. Se informa
    # cuántas filas resultaron para que el frontend pueda ajustar el alto
    # del contenedor si quiere (no es un campo de echarts_option).
    if request.chart_type == "small_multiples":
        facet_cols = _facet_columns(request)
        panel_count = len(_sorted_unique_tuples(rows, facet_cols))
        cols, panel_rows = _small_multiples_grid_dims(panel_count)
        requested_x_raw = _requested_x_domain(request)
        returned_x_values = [
            _short_label(v, request.x) for v in _sorted_unique(rows, request.x)
        ]
        requested_x_values = (
            [_short_label(v, request.x) for v in sorted(set(requested_x_raw), key=_sort_key)]
            if requested_x_raw
            else None
        )
        selected_group_count = (
            len(request.selected_groups.values) if request.selected_groups else None
        )
        complete = _small_multiples_completeness(
            truncated_before_selection=truncated_before_selection,
            selected_group_count=selected_group_count,
            matched_group_count=matched_group_count,
            requested_x_values=requested_x_values,
            returned_x_values=returned_x_values,
        )
        data_summary: dict[str, Any] = {
            "complete": complete,
            "facet_count": panel_count,
            "facet_columns": facet_cols,
            "grid_columns": cols,
            "grid_rows": panel_rows,
            "suggested_container_height_px": _suggested_container_height_px(panel_rows),
            "truncated_before_selection": truncated_before_selection,
            "returned_x_values": returned_x_values,
        }
        if requested_x_values is not None:
            data_summary["requested_x_values"] = requested_x_values
        if selected_group_count is not None:
            data_summary["selected_group_count"] = selected_group_count
            data_summary["matched_group_count"] = matched_group_count
        if request.source_result_ref:
            data_summary["source_result_ref"] = request.source_result_ref
        response["data_summary"] = data_summary

    # Para heatmap: añadir top-5 pre-ordenado por valor para que el modelo
    # no tenga que escanear el array de datos completo (que está ordenado
    # alfabéticamente por x/y, no por valor) para identificar el máximo.
    if request.chart_type == "heatmap":
        gb = _group_by_list(request)
        y_dim = gb[0] if gb else request.x
        metric = request.metrics[0]
        metric_label = _metric_display_name(metric)
        sorted_rows = sorted(
            rows,
            key=lambda r: _to_number(r.get(metric)) or 0,
            reverse=True,
        )
        response["data_summary"] = {
            "metric": metric_label,
            "total_cells": len(rows),
            "top5_by_value": [
                {
                    "x": _short_label(r.get(request.x), request.x),
                    "y": _short_label(r.get(y_dim), y_dim),
                    "value": _round_heatmap_val(r.get(metric)),
                }
                for r in sorted_rows[:5]
            ],
        }

    warnings = [
        w
        for w in (
            ungrouped_warning,
            sort_ignored_warning,
            _TRUNCATION_WARNING if truncated else None,
        )
        if w
    ]
    if warnings:
        response["warning"] = " ".join(warnings)
    return response
