import hashlib
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from . import report_cache

_AGG_PATTERN = re.compile(
    r"""^(SUM|COUNT|AVG|MIN|MAX|COUNT_DISTINCT)\(\s*(?:"([^"]+)"|'([^']+)'|(\w+))\s*\)$""",
    re.I,
)
_RATIO_PATTERN = re.compile(r"^RATIO\((.+)\)$", re.I | re.S)
# Detecta expresiones SQL "sueltas" (sin envolver en RATIO(...)) como
# 'SUM(sell_in)/NULLIF(SUM(cuota),0)*100' — para no depender de que el LLM
# recuerde siempre el wrapper RATIO(). Requiere AMBOS: una función de
# agregación reconocible Y un operador aritmético, para no confundir nombres
# de métricas guardadas que ya traen paréntesis (ej. 'Plan 24 vs Real 23(proy)').
_EXPR_FUNC_PATTERN = re.compile(r"(SUM|COUNT|AVG|MIN|MAX|NULLIF)\s*\(", re.I)
_EXPR_OPERATORS = ("/", "*", "+", "-")
# Alias legible tipo SQL: 'SUM(a)/NULLIF(SUM(b),0) AS % Cumplimiento' — sin esto,
# el label de una métrica-fórmula es la fórmula cruda, que termina siendo el
# nombre de columna en export_to_excel/chart_option/query_dataset (ilegible para
# el usuario final, ej. un header de Excel literal 'SUM(x)/NULLIF(SUM(y),0) - 1').
# Solo se aplica si la parte ANTES de ' AS ' matea a un patrón de fórmula conocido
# (ver _looks_like_formula) — así una métrica GUARDADA cuyo nombre contenga
# ' AS ' de casualidad (rarísimo, pero posible) no se trunca por error.
_AS_LABEL_RE = re.compile(r"^(.*)\s+AS\s+(.+)$", re.I | re.S)
_AUTO_LABEL_AGG_PATTERN = re.compile(
    r"""\b(SUM|COUNT|AVG|MIN|MAX|COUNT_DISTINCT|NULLIF)\(\s*(?:"([^"]+)"|'([^']+)'|(\w+))""",
    re.I,
)


def _looks_like_formula(expr: str) -> bool:
    return bool(
        _AGG_PATTERN.match(expr)
        or _RATIO_PATTERN.match(expr)
        or (
            _EXPR_FUNC_PATTERN.search(expr)
            and any(op in expr for op in _EXPR_OPERATORS)
        )
    )


def _auto_label_from_formula(expr: str) -> str:
    columns: list[str] = []
    for match in _AUTO_LABEL_AGG_PATTERN.finditer(expr):
        column = match.group(2) or match.group(3) or match.group(4)
        if column and column not in columns:
            columns.append(column)
    if columns:
        return " / ".join(columns[:3])
    return f"Métrica calculada {hashlib.md5(expr.encode()).hexdigest()[:6]}"


def _metric_label(metric: str, label_override: str | None) -> str:
    if label_override is None:
        return _auto_label_from_formula(metric)
    cleaned = re.sub(
        r"[^\w\s%.,()/áéíóúñÁÉÍÓÚÑ-]",
        "",
        label_override,
    ).strip()
    return cleaned or _auto_label_from_formula(metric)


class DatasetFilter(BaseModel):
    column: str
    op: str = Field(
        "==",
        description="Operador: ==, !=, >, <, >=, <=, IN, NOT IN, LIKE, ILIKE",
    )
    value: Any


class JinjaFilterOverride(BaseModel):
    column: str = Field(
        ...,
        description="Nombre EXACTO del target usado en el SQL virtual del dataset "
        "vía filter_values('<column>') o get_filters('<column>') — NO es "
        "necesariamente una columna real del dataset (puede no existir en absoluto "
        "como columna consultable, si el filtro nativo target es de OTRO dataset "
        "del mismo dashboard). FUENTE CONFIRMADA: 'native_filter_targets' en la "
        "respuesta de irex.get_query_context/get_dashboard_dataset_context — usar "
        "SOLO un 'column' que aparezca ahí con usable_as='jinja_filters'. NO "
        "adivinar ni inventar nombres (ej. probar 'anio' cuando el target real es "
        "'anio_ids') — si el nombre no está confirmado en esa lista, no usar este "
        "parámetro y avisar la limitación en vez de arriesgar un resultado "
        "silenciosamente incompleto. Ejemplo típico: datasets con lógica "
        "'año seleccionado vs año anterior' calculada en el SQL con "
        "'{% set selected_year = filter_values(\"anio_ids\")[0] ... %}' — para forzar "
        "selected_year=2025 sin que el usuario cambie nada en el dashboard, usar "
        "column='anio_ids', value=[2025].",
    )
    value: list[Any] = Field(
        ...,
        description="Valor(es) que debe devolver filter_values()/get_filters() para "
        "esa columna, ej. [2025]. Siempre una lista, incluso para un solo valor.",
    )


@contextmanager
def _jinja_filters_context(jinja_filters: "list[JinjaFilterOverride] | None"):
    """Simula, desde el servidor, el efecto de un filtro nativo de dashboard
    sobre columnas que el SQL virtual de un dataset usa SOLO vía
    filter_values()/get_filters() (ej. 'anio_ids' controlando un
    selected_year/previous_year calculado en Jinja) — sin depender de que el
    usuario cambie nada en el navegador ni de native_filters_key.

    superset.views.utils.get_form_data() (que es lo que filter_values() usa
    internamente) cae a flask.g.form_data cuando no hay un request HTTP real
    con body detrás — que es siempre el caso acá, porque las tools MCP arman
    la query directamente contra ChartDataCommand, no vía una request real a
    /api/v1/chart/data.

    Yields True si se aplicó un override (el caller DEBE entonces pasar
    force=True a QueryContextFactory.create — filter_values() no participa
    en la cache key de Superset, así que sin 'force' se puede devolver un
    resultado cacheado de un año/valor distinto, con apariencia de éxito)."""
    if not jinja_filters:
        yield False
        return
    from flask import g

    had_form_data = hasattr(g, "form_data")
    previous = getattr(g, "form_data", None)
    g.form_data = {
        "extra_form_data": {
            "filters": [
                {"col": jf.column, "op": "IN", "val": jf.value}
                for jf in jinja_filters
            ]
        }
    }
    try:
        yield True
    finally:
        if had_form_data:
            g.form_data = previous
        else:
            del g.form_data


class QueryDatasetRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    debug_sql: bool = Field(
        False,
        description=(
            "DEBUG solamente — no usar en consultas normales. "
            "Si True, incluye en '_debug_sql': filtros recibidos, filtros "
            "aplicados/rechazados por Superset, y el SQL generado. "
            "Usar solo cuando los filtros parecen ignorarse."
        ),
    )
    metrics: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Columnas a agregar. Formato 'AGREGADO(columna)', ej. 'SUM(pedido)', "
            "'COUNT(cliente_id)'. Si el nombre de columna tiene espacios u "
            "otros caracteres especiales, envolverlo en comillas: "
            "'SUM(\"Venta Real\")'. También se acepta el nombre de una métrica "
            "guardada del dataset, ej. 'count' o el metric_name exacto que "
            "devuelva get_dashboard_dataset_context/get_dataset_info. Para "
            "métricas calculadas/ratio (ej. % cumplimiento), escribir la "
            "expresión SQL directamente — SIEMPRE como ratio de sumas, NUNCA "
            "promedio de ratios por fila, ej. "
            "'SUM(sell_in)/NULLIF(SUM(planv),0)*100' para % cumplimiento (el "
            "NULLIF evita división por cero). El wrapper 'RATIO(...)' "
            "también funciona si se prefiere, pero no es obligatorio. "
            "Para fórmulas/ratios, se puede agregar un alias legible con "
            "' AS <nombre>' al final, ej. "
            "'SUM(plan)/NULLIF(SUM(proyeccion),0) - 1 AS % Decrecimiento' — el "
            "alias reemplaza a la fórmula cruda como nombre de columna en el "
            "resultado (clave de 'rows', y header de columna en "
            "irex.export_to_excel). Usar SIEMPRE que el resultado de una métrica "
            "calculada vaya a exportarse a Excel o mostrarse tal cual — sin "
            "alias, el header queda con la fórmula SQL cruda, ilegible para el "
            "usuario final."
        ),
    )
    groupby: list[str] = Field(
        default_factory=list,
        description="Columnas para agrupar, ej. ['pais_nombre', 'marca_nombre']",
    )
    filters: list[DatasetFilter] = Field(
        default_factory=list,
        description="Filtros simples tipo WHERE, ej. "
        "[{'column':'fecha_id','op':'>=','value':'2026-06-01'}]",
    )
    orderby: list[str] = Field(
        default_factory=list,
        description="Columnas o métricas para ordenar el resultado. "
        "Cada elemento puede ser: la métrica tal como aparece en 'metrics', o "
        "solo su ALIAS si la métrica usó ' AS <nombre>' (ej. 'Brecha'). "
        "Dirección: sufijo ' DESC'/' ASC' (recomendado) o prefijo '-' para "
        "descendente; sin nada = ASCENDENTE. "
        "Ej. ['Brecha DESC'] o ['-SUM(sell_out)']. "
        "⚠️ CRÍTICO al combinar con row_limit: el límite corta el extremo "
        "contrario al orden — para 'los N con MAYOR brecha' el orden debe ser "
        "DESC; ascendente + límite devuelve los MENORES y los mayores quedan "
        "fuera. La respuesta incluye 'ordered_by' con la dirección aplicada "
        "para verificar.",
    )
    summarize: bool = Field(
        False,
        description=(
            "Si True, ejecuta la consulta completa (hasta 10.000 filas) y devuelve "
            "un resumen estadístico en lugar de filas crudas: media, std, min, max y "
            "percentiles para columnas numéricas; distribución de valores para "
            "columnas categóricas. Usar cuando el dataset es grande y se necesita "
            "análisis preciso sobre el total, no una muestra truncada. "
            "Compatible con post_filter_expr: primero filtra, luego resume el "
            "subconjunto resultante."
        ),
    )
    post_filter_expr: str | None = Field(
        None,
        description=(
            "Expresión pandas aplicada DESPUÉS de la consulta sobre el resultado "
            "completo (hasta 10.000 filas). Permite filtrar por métricas calculadas "
            "que no existen en la BD. Columnas con caracteres especiales (paréntesis, "
            "espacios) deben ir entre backticks. "
            "Ejemplos: "
            "`` `AVG(precio)` > 1000 `` — filas con precio mayor a 1000; "
            "`` abs(`AVG(precio)`) > 500 `` — desviación absoluta mayor a 500; "
            "`` `articulo`.str.contains('IREX') `` — artículos que contengan IREX; "
            "`` `SUM(sell_out)` > `SUM(cuota)` `` — sell_out supera la cuota. "
            "Combinar con summarize=True para resumir el subconjunto filtrado."
        ),
    )
    row_limit: int = Field(100, ge=1, le=5000)
    save_as_report: bool = Field(
        False,
        description="Si True, guarda este resultado (filas y parámetros) y "
        "devuelve 'report_id' — reutilizable en irex.chart_option vía "
        "'source_result_ref' para graficar EXACTAMENTE estas combinaciones "
        "sin tener que retranscribirlas a mano. Usar cuando esta consulta "
        "calcula un top-N GLOBAL (groupby + orderby + row_limit) que "
        "probablemente se va a visualizar después — evita el riesgo de que "
        "el gráfico reproduzca el ranking con filtros/orden/granularidad "
        "ligeramente distintos. Para un top-N DENTRO de cada partición (ej. "
        "'top 5 artículos por cada formato') usar irex.rank_partitions con "
        "su propio save_as_report en su lugar — row_limit acá solo recorta "
        "GLOBALMENTE, no sirve para ranking particionado. No tiene efecto si "
        "summarize=True (no hay filas individuales que guardar en ese "
        "modo). Vence en 2 horas.",
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


def _parse_metric(metric: str) -> dict[str, Any] | str:
    """Convierte 'SUM(col)' al formato adhoc metric de Superset, 'RATIO(expr)'
    a una métrica de expresión SQL cruda, o devuelve el string tal cual si es
    el nombre de una métrica guardada.

    Soporta alias legible con ' AS <nombre>' al final (ej. 'SUM(a)/NULLIF(SUM(b),0)
    AS % Cumplimiento') — el alias se usa como 'label' en vez de la fórmula cruda,
    así el nombre de columna resultante (en export_to_excel, o la clave en las
    filas que devuelve query_dataset/chart_option) es legible."""
    metric = metric.strip()

    label_override: str | None = None
    as_m = _AS_LABEL_RE.match(metric)
    if as_m and _looks_like_formula(as_m.group(1).strip()):
        metric, label_override = as_m.group(1).strip(), as_m.group(2).strip()
        # El LLM suele citar el alias al estilo SQL si tiene espacios (ej.
        # AS "Precio Promedio") — tratar esas comillas como delimitador, no
        # como parte del nombre, cuando envuelven TODO el alias.
        if (
            len(label_override) >= 2
            and label_override[0] == label_override[-1]
            and label_override[0] in "\"'"
        ):
            label_override = label_override[1:-1].strip()

    m = _AGG_PATTERN.match(metric)
    if m:
        aggregate = m.group(1)
        column = m.group(2) or m.group(3) or m.group(4)
        return {
            "expressionType": "SIMPLE",
            "column": {"column_name": column},
            "aggregate": aggregate.upper(),
            "label": _metric_label(metric, label_override) if label_override else metric,
        }

    ratio_m = _RATIO_PATTERN.match(metric)
    if ratio_m:
        return {
            "expressionType": "SQL",
            "sqlExpression": ratio_m.group(1).strip(),
            "label": _metric_label(metric, label_override),
        }

    if _EXPR_FUNC_PATTERN.search(metric) and any(
        op in metric for op in _EXPR_OPERATORS
    ):
        return {
            "expressionType": "SQL",
            "sqlExpression": metric,
            "label": _metric_label(metric, label_override),
        }

    return metric


def _remap_rows_to_raw_metrics(
    rows: list[dict[str, Any]], raw_metrics: list[str]
) -> None:
    """Algunos callers (irex.chart_option, irex.forecast) indexan cada fila
    con el string CRUDO de sus 'metrics' (ej. 'AVG(precio) AS "Precio
    Promedio"'), pero Superset devuelve 'data' con clave = 'label' de la
    métrica ya parseada por _parse_metric — el alias después de ' AS <nombre>'
    si se usó esa sintaxis. Sin este remapeo, cualquier métrica con alias
    rompe a esos callers (valores None/vacíos) porque la clave real de la
    fila no coincide con el string que buscan. Muta 'rows' in-place;
    no-op si ninguna métrica usó alias."""
    label_to_raw: dict[str, str] = {}
    for raw in raw_metrics:
        parsed = _parse_metric(raw)
        label = parsed.get("label", raw) if isinstance(parsed, dict) else parsed
        if label != raw:
            label_to_raw[label] = raw
    if not label_to_raw:
        return
    for row in rows:
        for label, raw in label_to_raw.items():
            if label in row:
                row[raw] = row.pop(label)


def _sanitize_value(v: Any) -> Any:
    """Convierte NaN/Inf (ej. de métricas RATIO con denominador 0 en algunas
    bases) a None — no son valores JSON-válidos ni tienen sentido para
    mostrar como resultado."""
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    return v


def _sanitize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: _sanitize_value(v) for k, v in row.items()} for row in rows]


_ORDERBY_DIR_SUFFIX_RE = re.compile(r"\s+(ASC|DESC)\s*$", re.I)


def _parse_orderby(
    orderby_items: list[str], metrics: list[str] | None = None
) -> list[list[Any]]:
    """Convierte ['SUM(cuota)', '-SUM(sell_out)'] al formato [[metric, ascending], ...]
    que espera QueryContextFactory.

    Dirección: prefijo '-' O sufijo ' DESC' (estilo SQL, que es lo que un LLM
    escribe naturalmente) indican descendente; ' ASC' explícito o nada =
    ascendente.

    Con 'metrics' (los strings crudos de la request), un item que sea el ALIAS
    de una métrica ya definida (ej. 'Brecha' cuando metrics trae
    'SUM(a)-SUM(b) AS \"Brecha\"') se resuelve a esa misma métrica parseada —
    sin esto, el alias suelto se manda a Superset como nombre de métrica
    guardada y la consulta falla."""
    alias_map: dict[str, Any] = {}
    for raw in metrics or []:
        parsed_m = _parse_metric(raw)
        label = parsed_m.get("label") if isinstance(parsed_m, dict) else None
        if label:
            alias_map[label] = parsed_m

    result = []
    for item in orderby_items:
        item = item.strip()
        ascending = True
        dir_m = _ORDERBY_DIR_SUFFIX_RE.search(item)
        if dir_m:
            item = item[: dir_m.start()].strip()
            ascending = dir_m.group(1).upper() == "ASC"
        if item.startswith("-"):
            item = item[1:].strip()
            ascending = False
        # Alias citado al estilo SQL ('"Brecha"') — quitar las comillas si
        # envuelven todo el item, para matchear contra el label real.
        if len(item) >= 2 and item[0] == item[-1] and item[0] in "\"'":
            unquoted = item[1:-1].strip()
            if unquoted in alias_map:
                item = unquoted
        parsed = alias_map.get(item) or _parse_metric(item)
        result.append([parsed, ascending])
    return result


def _describe_orderby(parsed_orderby: list[list[Any]]) -> list[dict[str, str]]:
    """Eco legible del orden APLICADO — para que el LLM pueda auto-verificar
    la dirección (ej. pidió ascendente cuando buscaba los valores más altos)."""
    described = []
    for metric, ascending in parsed_orderby:
        label = metric.get("label", "") if isinstance(metric, dict) else str(metric)
        described.append({
            "by": label,
            "direction": "ascending" if ascending else "descending",
        })
    return described


_POST_FILTER_UNSAFE_RE = re.compile(
    r"\b(import|exec|eval|open|os|sys|subprocess|__)\b", re.I
)


def _apply_post_filter(
    rows: list[dict[str, Any]], expr: str
) -> tuple[list[dict[str, Any]], str | None]:
    """Aplica una expresión pandas sobre las filas ya obtenidas. Retorna (filas, error)."""
    try:
        import pandas as pd
    except ImportError:
        return rows, "pandas no disponible en este entorno"
    if _POST_FILTER_UNSAFE_RE.search(expr):
        return rows, "post_filter_expr contiene términos no permitidos"
    try:
        df = pd.DataFrame(rows)
        for col in df.columns:
            try:
                df[col] = pd.to_numeric(df[col])
            except (ValueError, TypeError):
                pass
        filtered = df.query(expr, engine="python")
        return filtered.to_dict("records"), None
    except Exception as exc:
        return rows, (
            f"post_filter_expr inválido: {exc}. "
            "Recordar que columnas con paréntesis u otros caracteres especiales "
            "deben ir entre backticks, ej: `AVG(precio)` > 1000"
        )


def _summarize_df(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Genera un resumen estadístico compacto de un conjunto de filas."""
    import math

    try:
        import pandas as pd
    except ImportError:
        return {"error": "pandas no disponible en este entorno"}

    df = pd.DataFrame(rows)
    for col in df.columns:
        try:
            df[col] = pd.to_numeric(df[col])
        except (ValueError, TypeError):
            pass

    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    cat_cols = df.select_dtypes(exclude="number").columns.tolist()

    def _fval(v: Any) -> float | None:
        if v is None:
            return None
        try:
            f = float(v)
            return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
        except (TypeError, ValueError):
            return None

    numeric_summary: dict[str, Any] = {}
    for col in numeric_cols:
        s = df[col].describe().to_dict()
        numeric_summary[col] = {
            "mean": _fval(s.get("mean")),
            "std": _fval(s.get("std")),
            "min": _fval(s.get("min")),
            "p25": _fval(s.get("25%")),
            "p50": _fval(s.get("50%")),
            "p75": _fval(s.get("75%")),
            "max": _fval(s.get("max")),
            "null_count": int(df[col].isna().sum()),
        }

    cat_summary: dict[str, Any] = {}
    for col in cat_cols:
        vc = df[col].value_counts(dropna=False)
        cat_summary[col] = {
            "unique_count": int(df[col].nunique(dropna=False)),
            "top_10": {str(k): int(v) for k, v in vc.head(10).items()},
        }

    sample = df.head(5).to_dict("records")
    return {
        "numeric": numeric_summary,
        "categorical": cat_summary,
        "sample_rows": [{k: _sanitize_value(v) for k, v in row.items()} for row in sample],
    }


def _parse_filter(f: DatasetFilter) -> dict[str, Any]:
    """QueryContextFactory espera el formato QueryObjectFilterClause
    {col, op, val} — NO el formato de adhoc_filters de form_data
    {subject, operator, comparator}. Ver chart_utils.py para referencia."""
    op = f.op.strip()
    op_map = {"=": "==", "==": "==", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<="}
    operator = op_map.get(op, op.upper())
    return {
        "col": f.column,
        "op": operator,
        "val": f.value,
    }


@tool(
    name="irex.query_dataset",
    description=(
        "Ejecuta una consulta agregada simple (tipo SELECT...GROUP BY...WHERE) "
        "contra un dataset de Superset, respetando el row-level security "
        "(RLS) del usuario autenticado. Usar cuando el usuario pide datos "
        "en texto/tabla; usar irex.chart_option cuando pide un gráfico. "
        "Si esta consulta calcula un ranking/top-N que probablemente se "
        "vaya a graficar después (ej. 'top 8 artículo+formato por ventas'), "
        "pasar save_as_report=True — la respuesta trae 'report_id', "
        "reutilizable en irex.chart_option vía 'source_result_ref' para que "
        "el gráfico use EXACTAMENTE esas combinaciones sin tener que "
        "retranscribirlas a mano en 'selected_groups'."
    ),
    tags=["irex", "negocio", "consulta", "sql", "rls"],
    class_permission_name="SQLLab",
    method_permission_name="execute_sql_query",
)
def query_dataset(request: QueryDatasetRequest) -> dict[str, Any]:
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    from .dashboard_dataset_context import _reject_hidden_columns

    referenced = set(request.groupby) | {f.column for f in request.filters}
    hidden_error = _reject_hidden_columns(request.dataset_id, referenced)
    if hidden_error:
        return {
            "status": "error",
            "error": hidden_error,
            "rows": [],
            "row_count": 0,
            "truncated": False,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    metrics = [_parse_metric(m) for m in request.metrics]
    adhoc_filters = [_parse_filter(f) for f in request.filters]
    orderby = (
        _parse_orderby(request.orderby, request.metrics) if request.orderby else []
    )

    # summarize y post_filter necesitan el resultado completo — usar límite mayor
    effective_limit = (
        10000 if (request.summarize or request.post_filter_expr) else request.row_limit
    )

    with _jinja_filters_context(request.jinja_filters) as forced:
        factory = QueryContextFactory()
        query_context = factory.create(
            datasource={"id": request.dataset_id, "type": "table"},
            force=forced,
            queries=[
                {
                    "filters": adhoc_filters,
                    "columns": request.groupby,
                    "metrics": metrics,
                    "row_limit": effective_limit,
                    "orderby": orderby,
                }
            ],
            form_data={
                "datasource": f"{request.dataset_id}__table",
                "viz_type": "table",
            },
        )

        command = ChartDataCommand(query_context)
        command.validate()

        debug_sql_info: dict[str, Any] | None = None
        if request.debug_sql:
            ds = query_context.datasource
            debug_sql_info = {
                "request_filters_raw": [f.model_dump() for f in request.filters],
                "adhoc_filters_parsed": adhoc_filters,
                "query_object_filter": list(query_context.queries[0].filter),
                "datasource_column_names": (
                    [c.column_name for c in ds.columns] if hasattr(ds, "columns") else None
                ),
            }
            try:
                debug_sql_info["sql"] = ds.get_query_str(
                    query_context.queries[0].to_dict()
                )
            except Exception as sql_exc:
                debug_sql_info["sql_error"] = str(sql_exc)

        try:
            result = command.run()
        except Exception as exc:
            err_str = str(exc)
            hint = ""
            if "division by zero" in err_str.lower() or "divide by zero" in err_str.lower():
                hint = (
                    " Si el error es 'division by zero' en una métrica con '%', "
                    "usar NULLIF en el denominador: "
                    "ej. 'SUM(sell_out)/NULLIF(SUM(plan),0)*100'."
                )
            return {
                "status": "error",
                "error": f"Error ejecutando la consulta: {err_str}.{hint}",
                "rows": [],
                "row_count": 0,
                "truncated": False,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

    query_result = (result or {}).get("queries", [{}])[0]
    error = query_result.get("error")
    rows = _sanitize_rows(query_result.get("data", []))
    truncated = len(rows) >= effective_limit
    rejected_filters = query_result.get("rejected_filters", [])
    total_before_filter = len(rows)

    if debug_sql_info is not None:
        debug_sql_info["rejected_filters"] = rejected_filters
        debug_sql_info["applied_filters"] = query_result.get("applied_filters", [])

    has_text_filter = any(
        f.op.strip().upper() in ("LIKE", "ILIKE", "IN", "NOT IN")
        for f in request.filters
        if isinstance(f.value, str)
    )

    if error:
        status = "error"
        rows = []
    elif rejected_filters and request.filters:
        status = "error"
        rows = []
        error = (
            f"Filtro rechazado — columna(s) no encontrada(s) en el dataset: "
            + ", ".join(
                str(r.get("column", r)) for r in rejected_filters
            )
            + ". Verificar el nombre exacto en dataset.columns de "
            "irex.get_query_context (con el dashboard_id correspondiente)."
        )
    elif not rows and has_text_filter:
        status = "no_data"
    else:
        status = "success"

    # Aplicar post_filter sobre el resultado completo (antes de resumir)
    post_filter_error: str | None = None
    if status == "success" and request.post_filter_expr and rows:
        rows, post_filter_error = _apply_post_filter(rows, request.post_filter_expr)

    # Modo summarize: reemplazar filas crudas por resumen estadístico
    summary: dict[str, Any] | None = None
    if status == "success" and request.summarize:
        summary = _summarize_df(rows)

    response: dict[str, Any] = {
        "status": status,
        "error": error,
        "rows": [] if summary else rows,
        "row_count": len(rows),
        "truncated": truncated if status == "success" else False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if status == "success":
        # Mismo contrato que query_dataset_sql/rank_partitions — false cuando
        # el resultado tocó el límite y puede haber más filas.
        response["result_exact"] = not truncated
    if orderby:
        response["ordered_by"] = _describe_orderby(orderby)
    if summary is not None:
        response["summary"] = summary
        response["mode"] = "summary"
        # 'rows' queda vacío por diseño en este modo — dejarlo explícito para
        # que no se confunda con "sin resultados" (row_count > 0 = SÍ hay datos).
        response["message"] = (
            f"Se encontraron {len(rows)} filas — NO es un resultado vacío. "
            "Las filas individuales no se devuelven en modo summarize (por eso "
            "'rows' está vacío); el resumen estadístico completo está en 'summary' "
            "(numeric, categorical, sample_rows). Usar esos datos para responder."
            if len(rows) > 0
            else "La consulta no encontró filas con estos filtros."
        )
    if request.post_filter_expr and status == "success":
        response["total_before_filter"] = total_before_filter
        if post_filter_error:
            response["post_filter_error"] = post_filter_error
    if debug_sql_info is not None:
        response["_debug_sql"] = debug_sql_info
    if truncated and not request.summarize:
        response["warning"] = (
            f"Se alcanzó row_limit={request.row_limit} — pueden existir más "
            "combinaciones no mostradas. Si necesitás el total exacto, agregá "
            "más filtros para acotar, pedí menos columnas de groupby, o subí "
            "row_limit (hasta 5000) si la respuesta no supera el límite de "
            "tokens. Alternativa: usar summarize=True para estadísticas sobre "
            "el total sin truncar (hasta 10.000 filas). "
            "NO asumas que estas filas son el conjunto completo."
        )
        # Límite + orden = un extremo entero quedó afuera. Decir CUÁL, con
        # nombre — es el aviso que evita presentar un "top" que en realidad es
        # el fondo de la lista (ej. orden ascendente cortando las brechas
        # positivas más altas).
        if orderby:
            first = _describe_orderby(orderby)[0]
            cut = "ALTOS" if first["direction"] == "ascending" else "BAJOS"
            response["warning"] += (
                f" ⚠️ ADEMÁS: el orden es {'ASCENDENTE' if cut == 'ALTOS' else 'DESCENDENTE'} "
                f"por '{first['by']}', así que los valores más {cut} de "
                f"'{first['by']}' quedaron FUERA de estas {len(rows)} filas. Si "
                "buscás justamente esos, invertí la dirección del orderby "
                "(sufijo ' DESC'/' ASC' o prefijo '-')."
            )
    elif truncated and request.summarize:
        response["warning"] = (
            f"El resumen está basado en {effective_limit} filas (límite interno "
            "de summarize=True). Pueden existir más filas en el dataset — "
            "agregá filtros para acotar si necesitás mayor precisión."
        )
    elif status == "no_data":
        response["must_action"] = (
            "DETENER — no llamar a irex.chart_option todavía. "
            "Un filtro de texto (LIKE/ILIKE/IN) no encontró coincidencias: el "
            "valor en 'filters' no existe exactamente así en el dataset. "
            "Usar irex.list_column_values con un 'search' de 3-4 letras "
            "(raíz corta, ej. si el usuario dijo 'detergente' → search='det'; "
            "si dijo 'El Salvador' → search='salva') para descubrir los "
            "valores reales. Luego repetir irex.query_dataset con el valor "
            "exacto encontrado."
        )
    elif not error and not rows and not request.post_filter_expr:
        response["warning"] = (
            "La consulta devolvió 0 filas sin filtros de texto activos. "
            "Puede ser un rango de fechas sin datos o criterio muy restrictivo."
        )

    if request.save_as_report and status == "success" and not request.summarize:
        report_params: dict[str, Any] = {
            "dataset_id": request.dataset_id,
            "groupby": request.groupby,
            "filters": [f.model_dump() for f in request.filters],
            "metrics": request.metrics,
            "rows": rows,
        }
        if request.jinja_filters:
            report_params["jinja_filters"] = [
                f.model_dump() for f in request.jinja_filters
            ]
        response["report_id"] = report_cache.store_report(
            dataset_id=request.dataset_id,
            mode="query_dataset",
            params=report_params,
        )
    return response
