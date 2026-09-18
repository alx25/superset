import math
import re
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from . import report_cache
from .query_dataset import (
    DatasetFilter,
    JinjaFilterOverride,
    _jinja_filters_context,
    _parse_filter,
    _parse_metric,
)


class ComparePeriodsRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    metrics: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Métricas a comparar. Mismo formato que irex.query_dataset: "
            "'AVG(precio)', 'SUM(ventas)', 'COUNT(id_producto)', etc."
        ),
    )
    groupby: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Columnas de agrupación que se usan como clave del JOIN entre períodos. "
            "Ej. ['articulo', 'formato'] — cada combinación única se compara entre A y B."
        ),
    )
    base_filters: list[DatasetFilter] = Field(
        default_factory=list,
        description=(
            "Filtros comunes a AMBOS períodos — NO incluir aquí la columna que "
            "distingue los períodos (ej. 'mes'). Solo filtros que aplican igual "
            "a A y B, como anio, familia, segmento. "
            "Ej. [{'column':'anio','op':'IN','value':[2026]}, "
            "{'column':'familia','op':'IN','value':['Suavizantes']}]. "
            "Si una columna aparece en base_filters Y en period_a/b_filters, "
            "el filtro de período tiene precedencia (base queda ignorado para ese campo)."
        ),
    )
    period_a_filters: list[DatasetFilter] = Field(
        ...,
        description=(
            "Filtros que definen el período A (referencia / anterior). "
            "Ej. [{'column':'mes','op':'IN','value':[4]}]"
        ),
    )
    period_b_filters: list[DatasetFilter] = Field(
        ...,
        description=(
            "Filtros que definen el período B (actual / nuevo). "
            "Ej. [{'column':'mes','op':'IN','value':[5]}]"
        ),
    )
    period_a_label: str | None = Field(
        None,
        description=(
            "Etiqueta LEGIBLE del período A para usar en encabezados de "
            "columna si este análisis se exporta después con "
            "irex.export_to_excel (ej. 'julio 2026', 'Q1 2026'). Si no se "
            "especifica, se infiere de 'period_a_filters' (ej. 'mes=7') — "
            "un texto legible explícito siempre es preferible cuando se "
            "sabe de antemano que el resultado se va a exportar."
        ),
    )
    period_b_label: str | None = Field(
        None,
        description="Etiqueta legible del período B (ej. 'agosto 2026'). "
        "Mismo criterio que 'period_a_label'.",
    )
    min_variation_pct: float | None = Field(
        None,
        ge=0,
        description=(
            "Si se especifica, devuelve SOLO las filas cuya variación absoluta "
            "sea >= este porcentaje. Ej. 6.0 para alertas >6%. "
            "Filas que aparecen o desaparecen entre períodos siempre se incluyen."
        ),
    )
    row_limit: int = Field(
        500,
        ge=1,
        le=2000,
        description=(
            "Cantidad máxima de filas a devolver en 'rows', tomando las de MAYOR "
            "variación absoluta (%) entre período A y B. NO es un límite de la "
            "consulta cruda por período — esa se trae completa (hasta un tope "
            "interno fijo) para poder calcular la variación real de TODAS las "
            "combinaciones antes de recortar. Bajar este valor no cambia qué se "
            "compara, solo cuántas filas de 'rows' se devuelven al final. "
            "Default 500."
        ),
    )
    sort_by: Literal["variation_pct", "abs_delta"] = Field(
        "variation_pct",
        description=(
            "Criterio de orden de 'rows' (y de qué filas se conservan al aplicar "
            "row_limit). 'variation_pct' (default): por mayor variación % absoluta "
            "— resalta los swings porcentuales más grandes (útil para alertas, pero "
            "un ítem chico con +900% puede tapar al que realmente movió el total). "
            "'abs_delta': por mayor cambio ABSOLUTO (b - a) — resalta las "
            "combinaciones que más movieron el número en magnitud real. Usar "
            "'abs_delta' para '¿qué explica la caída/subida del total?'."
        ),
    )
    aggregate_by: list[str] | None = Field(
        None,
        description=(
            "Columnas (subconjunto de 'groupby') por las que agregar un conteo de "
            "aumentos/disminuciones. USAR cuando la pregunta es del tipo '¿qué canal/"
            "marca/categoría tuvo MÁS aumentos o disminuciones?' — evita que el LLM "
            "tenga que contar manualmente cientos de alertas fila por fila. "
            "Ej. con groupby=['articulo','formato','marca'] y aggregate_by=['formato'], "
            "la respuesta incluye un conteo de aumentos/disminuciones por cada valor "
            "de 'formato', ya ordenado de mayor a menor. "
            "Requiere min_variation_pct para tener sentido (si no se especifica, se "
            "usa 0 — cualquier variación distinta de cero cuenta). "
            "IMPORTANTE — nivel de granularidad: usar la columna que corresponde "
            "EXACTAMENTE a la entidad que la pregunta menciona (ej. si preguntan "
            "'qué canal', usar la columna de canal, no una columna más fina que "
            "pueda tener varios valores por cada canal — verificar contra el "
            "schema del dataset devuelto por get_query_context si hay dudas de "
            "cuál columna corresponde). Agregar por una columna más fina que la "
            "que pide la pregunta reparte el total real de cada entidad en varias "
            "filas en vez de sumarlo, y produce comparaciones injustas entre "
            "grupos de tamaño desigual."
        ),
    )
    jinja_filters: list[JinjaFilterOverride] | None = Field(
        None,
        description="AVANZADO — usar solo cuando el dataset tiene columnas "
        "calculadas en su SQL vía filter_values()/get_filters() (típicamente "
        "lógica de 'año seleccionado vs año anterior' u otra dependiente de un "
        "filtro nativo del dashboard) y se necesita fijar ese valor SIN pedirle "
        "al usuario que cambie el filtro en el dashboard. Cada entry simula la "
        "selección de un filtro nativo: {'column': '<target del filtro, ej. "
        "anio_ids>', 'value': [<valor>]}. Se aplica IDÉNTICO a ambos períodos "
        "(simula un filtro nativo de DASHBOARD, que es único — no varía entre "
        "período A y B). Descubrir el nombre de columna correcto leyendo el SQL "
        "virtual del dataset o la configuración de filtros nativos del dashboard "
            "— NO adivinar. No confundir con 'base_filters' (WHERE normal sobre "
            "columnas reales del dataset, aplicado a ambos períodos igual).",
    )
    totals: bool = Field(
        False,
        description=(
            "Si True, calcula totales agregados reales por período SIN groupby, "
            "además del detalle comparado por groupby."
        ),
    )
    dashboard_id: int | None = Field(
        None,
        description=(
            "ID del dashboard para detectar automáticamente filtros nativos que "
            "deben aplicarse como jinja_filters en vez de filtros WHERE normales."
        ),
    )


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


def _variation_pct(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    if a == 0:
        return None  # indefinida — no dividir por cero
    return round((b - a) / abs(a) * 100, 2)


def _delta(a: float | None, b: float | None) -> float | None:
    """Cambio ABSOLUTO b - a. Trata un lado ausente como 0 — una combinación que
    aparece o desaparece entre períodos cuenta como cambio completo (+b o -a).
    None solo si faltan AMBOS lados."""
    if a is None and b is None:
        return None
    return (b or 0.0) - (a or 0.0)


def _infer_period_label(filters: list[DatasetFilter], fallback: str) -> str:
    """Etiqueta legible genérica derivada de los filtros de un período — NO
    asume semántica de fecha/mes/columna alguna (evita hardcodear nombres
    de columna), solo concatena 'columna=valor' de cada filtro. Se usa
    únicamente si el caller no pasó 'period_a_label'/'period_b_label'
    explícito — un texto explícito siempre es más legible que esto."""
    if not filters:
        return fallback
    parts = []
    for f in filters:
        val = f.value
        val_str = ", ".join(str(v) for v in val) if isinstance(val, list) else str(val)
        parts.append(f"{f.column}={val_str}")
    return " · ".join(parts)


_ADDITIVE_METRIC_RE = re.compile(r"^\s*(SUM|COUNT)\s*\(", re.I)


def _is_additive_metric(raw_metric: str) -> bool:
    """True si la métrica es ADITIVA entre grupos (SUM/COUNT simples) — condición
    para que 'contribución al cambio total' (delta_fila / delta_total) tenga
    sentido: el total es la suma de los grupos. AVG/MIN/MAX/ratios y COUNT_DISTINCT
    NO son aditivos, así que para esas no se calcula contribución (solo delta,
    que sí es interpretable fila por fila). Un metric_name guardado (string
    opaco) se trata como NO aditivo por seguridad."""
    m = raw_metric.strip()
    if re.match(r"^\s*COUNT_DISTINCT\b", m, re.I):
        return False
    return bool(_ADDITIVE_METRIC_RE.match(m))


def _detect_period_inversion(
    period_a_filters: list[DatasetFilter],
    period_b_filters: list[DatasetFilter],
) -> str | None:
    """Heurística: si A y B filtran la misma columna con un único valor numérico
    y A > B (ej. mes=6 en A, mes=5 en B), es probable que el usuario haya
    invertido 'anterior' y 'actual', lo que invierte el signo de la variación."""
    b_by_col = {f.column: f.value for f in period_b_filters}
    for f in period_a_filters:
        b_val = b_by_col.get(f.column)
        if b_val is None:
            continue
        a_val, b_val_norm = f.value, b_val
        if isinstance(a_val, list) and len(a_val) == 1:
            a_val = a_val[0]
        if isinstance(b_val_norm, list) and len(b_val_norm) == 1:
            b_val_norm = b_val_norm[0]
        if isinstance(a_val, (int, float)) and isinstance(b_val_norm, (int, float)):
            if a_val > b_val_norm:
                return (
                    f"period_a_filters tiene '{f.column}'={a_val} y period_b_filters "
                    f"tiene '{f.column}'={b_val_norm} — A es NUMÉRICAMENTE MAYOR que B. "
                    "Si el objetivo es comparar 'mes anterior vs mes actual', A debería "
                    "ser el valor MENOR (más antiguo) y B el mayor (más reciente); "
                    "de lo contrario el signo de la variación % queda invertido "
                    "(un aumento real aparecerá como disminución y viceversa)."
                )
    return None


def _aggregate_by_direction(
    combined: list[dict[str, Any]],
    metric_labels: list[str],
    aggregate_by: list[str],
    threshold: float,
    additive_labels: set[str],
) -> dict[str, Any]:
    groups: dict[tuple, dict[str, Any]] = {}
    for row in combined:
        key = tuple(row.get(col) for col in aggregate_by)
        g = groups.setdefault(key, dict(zip(aggregate_by, key)))
        for label in metric_labels:
            # Cambio absoluto por grupo (solo métricas aditivas). NO se filtra por
            # el umbral: la contribución de un grupo al total suma TODO su
            # movimiento, no solo el de las combinaciones que superan
            # min_variation_pct.
            if label in additive_labels:
                delta = row.get(f"{label}_delta")
                if delta is not None:
                    dkey = f"{label}_total_delta" if len(metric_labels) > 1 else "total_delta"
                    g[dkey] = g.get(dkey, 0.0) + delta
            var_pct = row.get(f"{label}_var_pct")
            if var_pct is None or abs(var_pct) < threshold:
                continue
            inc_key = f"{label}_increases_count" if len(metric_labels) > 1 else "increases_count"
            dec_key = f"{label}_decreases_count" if len(metric_labels) > 1 else "decreases_count"
            sum_key = f"{label}_sum_var_pct" if len(metric_labels) > 1 else "_sum_var_pct"
            g[inc_key] = g.get(inc_key, 0) + (1 if var_pct > 0 else 0)
            g[dec_key] = g.get(dec_key, 0) + (1 if var_pct < 0 else 0)
            g[sum_key] = g.get(sum_key, 0.0) + var_pct

    breakdown: list[dict[str, Any]] = []
    for g in groups.values():
        row_out = dict(g)
        for label in metric_labels:
            inc_key = f"{label}_increases_count" if len(metric_labels) > 1 else "increases_count"
            dec_key = f"{label}_decreases_count" if len(metric_labels) > 1 else "decreases_count"
            sum_key = f"{label}_sum_var_pct" if len(metric_labels) > 1 else "_sum_var_pct"
            inc = row_out.get(inc_key, 0)
            dec = row_out.get(dec_key, 0)
            total = inc + dec
            avg_key = f"{label}_avg_var_pct" if len(metric_labels) > 1 else "avg_var_pct"
            row_out[avg_key] = round(row_out.pop(sum_key, 0.0) / total, 2) if total else None
            dkey = f"{label}_total_delta" if len(metric_labels) > 1 else "total_delta"
            if dkey in row_out:
                row_out[dkey] = round(row_out[dkey], 4)
        breakdown.append(row_out)

    inc_field = "increases_count" if len(metric_labels) == 1 else f"{metric_labels[0]}_increases_count"
    dec_field = "decreases_count" if len(metric_labels) == 1 else f"{metric_labels[0]}_decreases_count"
    avg_field = "avg_var_pct" if len(metric_labels) == 1 else f"{metric_labels[0]}_avg_var_pct"
    delta_field = "total_delta" if len(metric_labels) == 1 else f"{metric_labels[0]}_total_delta"

    breakdown.sort(key=lambda r: -(r.get(inc_field) or 0))

    # top_increases/top_decreases: respuesta directa y compacta para "¿qué grupo
    # tuvo MÁS aumentos/disminuciones?" (CANTIDAD de combinaciones que subieron/
    # bajaron) — evita que el LLM (o un fallback por timeout) tenga que reordenar/
    # leer el 'breakdown' completo o, peor, contar manualmente sobre 'rows'.
    # OJO: esto es cantidad, no magnitud — un grupo con muchas combinaciones que
    # subieron apenas un poco sale primero acá aunque otro grupo con pocas
    # combinaciones haya subido mucho más en promedio. Para "¿qué grupo tuvo
    # MAYOR variación de precio?" (magnitud %) usar 'top_by_variation'; para
    # "¿qué grupo MOVIÓ más el total?" (magnitud absoluta) usar 'top_by_delta'.
    top_increases = sorted(
        breakdown, key=lambda r: -(r.get(inc_field) or 0)
    )[:5]
    top_decreases = sorted(
        breakdown, key=lambda r: -(r.get(dec_field) or 0)
    )[:5]
    # top_by_variation: ordenado por MAGNITUD de la variación % promedio
    # (|avg_var_pct|), sin importar cuántas combinaciones tenga el grupo. Es el
    # campo correcto para "¿qué [marca/canal/...] tuvo MAYOR variación de
    # precio?" — top_increases/top_decreases NO sirven para esa pregunta.
    top_by_variation = sorted(
        breakdown, key=lambda r: -abs(r.get(avg_field) or 0)
    )[:5]
    # top_by_delta: grupos que más MOVIERON el total en términos ABSOLUTOS
    # (aporte real al cambio del total). Solo aplica si la métrica primaria es
    # aditiva (SUM/COUNT) — para AVG/ratios el total no es la suma de grupos, así
    # que queda vacío para no dar un número engañoso.
    primary_additive = metric_labels[0] in additive_labels
    top_by_delta = (
        sorted(breakdown, key=lambda r: -abs(r.get(delta_field) or 0))[:5]
        if primary_additive
        else []
    )

    return {
        "aggregate_by": aggregate_by,
        "threshold_used": threshold,
        "groups_count": len(breakdown),
        "answer_hint": (
            f"'{top_increases[0][aggregate_by[0]]}' tuvo más aumentos "
            f"({top_increases[0].get(inc_field)}); "
            f"'{top_decreases[0][aggregate_by[0]]}' tuvo más disminuciones "
            f"({top_decreases[0].get(dec_field)})."
            if breakdown and len(aggregate_by) == 1
            else None
        ),
        "variation_hint": (
            f"'{top_by_variation[0][aggregate_by[0]]}' tuvo la MAYOR variación "
            f"promedio ({top_by_variation[0].get(avg_field)}%) — para preguntas "
            "de '¿qué grupo tuvo MAYOR variación de precio?' usar este campo "
            "(top_by_variation), NO top_increases/top_decreases (esos son por "
            "cantidad de combinaciones que subieron/bajaron, no por magnitud)."
            if breakdown and len(aggregate_by) == 1
            else None
        ),
        "delta_hint": (
            f"'{top_by_delta[0][aggregate_by[0]]}' es quien más MOVIÓ el total "
            f"({top_by_delta[0].get(delta_field)} de cambio absoluto) — para "
            "'¿qué grupo explica/impulsó el cambio del total?' usar este campo "
            "(top_by_delta): pondera por magnitud real del aporte, no por cantidad "
            "de combinaciones (top_increases) ni por % individual (top_by_variation)."
            if top_by_delta and len(aggregate_by) == 1
            else None
        ),
        "top_increases": top_increases,
        "top_decreases": top_decreases,
        "top_by_variation": top_by_variation,
        "top_by_delta": top_by_delta,
        "breakdown": breakdown,
    }


def _reclassify_dashboard_filters(
    dashboard_id: int | None,
    base_filters: list[DatasetFilter],
    period_a_filters: list[DatasetFilter],
    period_b_filters: list[DatasetFilter],
    explicit_jinja_filters: list[JinjaFilterOverride] | None,
) -> tuple[
    list[DatasetFilter],
    list[DatasetFilter],
    list[DatasetFilter],
    list[JinjaFilterOverride] | None,
    list[str],
]:
    if dashboard_id is None:
        return (
            base_filters,
            period_a_filters,
            period_b_filters,
            explicit_jinja_filters,
            [],
        )
    try:
        from .dashboard_dataset_context import get_dashboard_dataset_context_data

        context = get_dashboard_dataset_context_data(dashboard_id)
        targets = context.get("native_filter_targets") if isinstance(context, dict) else None
    except Exception:
        targets = None
    if not targets:
        return (
            base_filters,
            period_a_filters,
            period_b_filters,
            explicit_jinja_filters,
            [],
        )

    jinja_columns = {
        t.get("column")
        for t in targets
        if isinstance(t, dict) and t.get("usable_as") == "jinja_filters"
    }
    if not jinja_columns:
        return (
            base_filters,
            period_a_filters,
            period_b_filters,
            explicit_jinja_filters,
            [],
        )

    auto_jinja: list[JinjaFilterOverride] = []
    moved: list[str] = []

    def split(filters: list[DatasetFilter]) -> list[DatasetFilter]:
        kept: list[DatasetFilter] = []
        for f in filters:
            if f.column in jinja_columns:
                moved.append(f.column)
                auto_jinja.append(
                    JinjaFilterOverride(
                        column=f.column,
                        value=f.value if isinstance(f.value, list) else [f.value],
                    )
                )
            else:
                kept.append(f)
        return kept

    base_filters = split(base_filters)
    period_a_filters = split(period_a_filters)
    period_b_filters = split(period_b_filters)

    merged_by_column = {jf.column: jf for jf in auto_jinja}
    for jf in explicit_jinja_filters or []:
        merged_by_column[jf.column] = jf

    return (
        base_filters,
        period_a_filters,
        period_b_filters,
        list(merged_by_column.values()) or None,
        sorted(set(moved)),
    )


# Tope de fetch por defecto de la consulta cruda por período, para callers
# (como irex.compare_periods) donde 'row_limit' solo debe acotar el resultado
# YA cruzado y ordenado por variación — no el fetch crudo. La variación % solo
# se puede calcular DESPUÉS de cruzar A y B por 'groupby'; truncar cada período
# por separado antes del cruce puede descartar categorías con la mayor
# variación real si su valor absoluto de la métrica no las pone entre las
# primeras N de CADA período (ej. una marca con precio moderado pero que subió
# mucho puede no entrar al top-10 por precio, aunque sí sea el top-1 por
# variación).
# Otros callers (ej. irex.export_to_excel, que exporta el detalle completo y
# SÍ necesita que 'row_limit' controle cuántas filas crudas trae, hasta 50.000)
# pueden pasar su propio 'fetch_limit' explícito en vez de usar este default.
_INTERNAL_FETCH_LIMIT = 2000


def _run_period_query(
    dataset_id: int,
    metrics_parsed: list[Any],
    groupby: list[str],
    base_filters: list[DatasetFilter],
    period_filters: list[DatasetFilter],
    fetch_limit: int = _INTERNAL_FETCH_LIMIT,
    jinja_filters: list[JinjaFilterOverride] | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    # Si una columna aparece en base_filters y también en period_filters,
    # el filtro de período tiene precedencia para evitar contradicción (ej. mes=5 AND mes=4).
    period_cols = {f.column for f in period_filters}
    effective_base = [f for f in base_filters if f.column not in period_cols]
    adhoc_filters = [_parse_filter(f) for f in (effective_base + list(period_filters))]
    with _jinja_filters_context(jinja_filters) as forced:
        factory = QueryContextFactory()
        qc = factory.create(
            datasource={"id": dataset_id, "type": "table"},
            force=forced,
            queries=[{
                "filters": adhoc_filters,
                "columns": groupby,
                "metrics": metrics_parsed,
                "row_limit": fetch_limit,
                # Orden por defecto (best-effort) para el caso extremo en que el
                # tope de fetch igual truncara: priorizar valores absolutos altos
                # de la primera métrica es mejor que el orden arbitrario de la BD,
                # aunque no reemplaza ordenar por variación (imposible en esta etapa).
                "orderby": [[metrics_parsed[0], False]],
            }],
            form_data={"datasource": f"{dataset_id}__table", "viz_type": "table"},
        )
        cmd = ChartDataCommand(qc)
        cmd.validate()
        try:
            result = cmd.run()
        except Exception as exc:
            return [], str(exc)
    qr = (result or {}).get("queries", [{}])[0]
    err = qr.get("error")
    if err:
        return [], err
    rejected = qr.get("rejected_filters", [])
    if rejected:
        cols = ", ".join(str(r.get("column", r)) for r in rejected)
        return [], f"Columna(s) no encontrada(s) en el dataset: {cols}"
    return qr.get("data", []), None


def _build_comparison(
    dataset_id: int,
    metrics_parsed: list[Any],
    metric_labels: list[str],
    additive_labels: set[str],
    groupby: list[str],
    base_filters: list[DatasetFilter],
    period_a_filters: list[DatasetFilter],
    period_b_filters: list[DatasetFilter],
    sort_by: str,
    min_variation_pct: float | None,
    jinja_filters: list[JinjaFilterOverride] | None,
    fetch_limit: int = _INTERNAL_FETCH_LIMIT,
) -> dict[str, Any]:
    """Corazón del cálculo de irex.compare_periods: corre ambas queries de
    período, cruza por 'groupby', calcula '{metric}_a'/'_b'/'_var_pct'/
    '_delta' (y '_contribution_pct' para métricas aditivas) por fila,
    filtra por 'min_variation_pct' y ordena por 'sort_by'.

    Extraída como función standalone para que irex.export_to_excel (modo
    comparación, o vía report_id) use EXACTAMENTE este mismo cálculo en vez
    de una reimplementación paralela — la causa raíz de que un Excel
    exportado divergiera de la tabla mostrada en el chat (sin '_delta', sin
    respetar 'sort_by') era justamente tener dos implementaciones separadas
    del mismo cruce A/B.

    Retorna dict con 'error' (None si OK) y, si no hay error: 'combined'
    (filas ya calculadas y ordenadas), 'rows_a', 'rows_b', 'total_delta',
    'total_delta_seen', 'alerts_count', 'matched', 'unmatched_a',
    'unmatched_b'."""
    rows_a, err_a = _run_period_query(
        dataset_id, metrics_parsed, groupby, base_filters, period_a_filters,
        fetch_limit=fetch_limit, jinja_filters=jinja_filters,
    )
    if err_a:
        return {"error": f"Error en período A: {err_a}"}

    rows_b, err_b = _run_period_query(
        dataset_id, metrics_parsed, groupby, base_filters, period_b_filters,
        fetch_limit=fetch_limit, jinja_filters=jinja_filters,
    )
    if err_b:
        return {"error": f"Error en período B: {err_b}"}

    def index_rows(rows: list[dict[str, Any]]) -> dict[tuple, dict[str, float | None]]:
        idx: dict[tuple, dict[str, float | None]] = {}
        for row in rows:
            key = tuple(row.get(col) for col in groupby)
            idx[key] = {label: _to_float(row.get(label)) for label in metric_labels}
        return idx

    idx_a = index_rows(rows_a)
    idx_b = index_rows(rows_b)
    all_keys = set(idx_a.keys()) | set(idx_b.keys())

    combined: list[dict[str, Any]] = []
    alerts_count = 0
    total_delta: dict[str, float] = {label: 0.0 for label in metric_labels}
    total_delta_seen: dict[str, bool] = {label: False for label in metric_labels}

    for key in all_keys:
        a_vals = idx_a.get(key)
        b_vals = idx_b.get(key)
        in_a = a_vals is not None
        in_b = b_vals is not None

        row: dict[str, Any] = dict(zip(groupby, key))

        max_abs_var = 0.0
        for label in metric_labels:
            va = a_vals.get(label) if a_vals else None
            vb = b_vals.get(label) if b_vals else None
            var_pct = _variation_pct(va, vb)
            delta = _delta(va, vb)
            row[f"{label}_a"] = va
            row[f"{label}_b"] = vb
            row[f"{label}_var_pct"] = var_pct
            row[f"{label}_delta"] = delta
            if delta is not None:
                total_delta[label] += delta
                total_delta_seen[label] = True
            if var_pct is not None and abs(var_pct) > max_abs_var:
                max_abs_var = abs(var_pct)

        missing_in_one = not in_a or not in_b
        passes_threshold = (
            missing_in_one or (min_variation_pct is None) or (max_abs_var >= min_variation_pct)
        )
        if not passes_threshold:
            continue

        if max_abs_var >= (min_variation_pct or 0) or missing_in_one:
            alerts_count += 1

        combined.append(row)

    for label in metric_labels:
        if label not in additive_labels or not total_delta_seen[label]:
            continue
        denom = total_delta[label]
        if denom == 0:
            continue
        for row in combined:
            d = row.get(f"{label}_delta")
            row[f"{label}_contribution_pct"] = (
                round(d / denom * 100, 2) if d is not None else None
            )

    if sort_by == "abs_delta":
        combined.sort(key=lambda r: -max(
            abs(r.get(f"{l}_delta") or 0) for l in metric_labels
        ))
    else:  # "variation_pct" (default)
        combined.sort(key=lambda r: -max(
            abs(r.get(f"{l}_var_pct") or 0) for l in metric_labels
        ))

    matched = sum(1 for k in all_keys if k in idx_a and k in idx_b)
    unmatched_a = sum(1 for k in idx_a if k not in idx_b)
    unmatched_b = sum(1 for k in idx_b if k not in idx_a)

    return {
        "error": None,
        "combined": combined,
        "rows_a": rows_a,
        "rows_b": rows_b,
        "total_delta": total_delta,
        "total_delta_seen": total_delta_seen,
        "alerts_count": alerts_count,
        "matched": matched,
        "unmatched_a": unmatched_a,
        "unmatched_b": unmatched_b,
    }


@tool(
    name="irex.compare_periods",
    description=(
        "Compara métricas entre dos períodos (ej. mes anterior vs mes actual) "
        "haciendo el JOIN y el cálculo de variación % en el servidor, sin inflar "
        "el contexto del LLM. Usar cuando el usuario pide: variaciones de precio, "
        "alertas de cambio entre períodos, evolución de indicadores, "
        "comparativas mes/año anterior vs actual. "
        "Acepta un umbral min_variation_pct para devolver SOLO las alertas relevantes. "
        "Más eficiente que dos llamadas a irex.query_dataset cuando hay muchas "
        "combinaciones — evita el JOIN manual por el LLM. "
        "Si la pregunta es sobre un [canal/marca/categoría] agregado — usar SIEMPRE "
        "aggregate_by con esa columna en la misma llamada, y elegir el campo correcto "
        "según el tipo de pregunta (son criterios de orden DISTINTOS, no intercambiables): "
        "'¿qué grupo tuvo MÁS aumentos/disminuciones?' (CANTIDAD de combinaciones que "
        "subieron/bajaron) → aggregation.answer_hint / top_increases[0] / top_decreases[0]. "
        "'¿qué grupo tuvo MAYOR variación de precio?' (MAGNITUD, sin importar cuántas "
        "combinaciones) → aggregation.variation_hint / top_by_variation[0]. "
        "Un grupo con muchas combinaciones que subieron apenas un poco puede ganar en "
        "top_increases pero no aparecer en top_by_variation, y viceversa — no mezclar. "
        "NO contar manualmente sobre 'rows' — ese campo es solo una muestra de "
        "ejemplo cuando se usa aggregate_by, no el conjunto completo. "
        "Cada fila incluye, además del %: '{metric}_delta' (cambio ABSOLUTO b - a) "
        "y, para métricas aditivas (SUM/COUNT), '{metric}_contribution_pct' (qué "
        "parte del cambio TOTAL de esa métrica explica esa fila). Para '¿qué "
        "explica la caída/subida del total?' ordenar con sort_by='abs_delta' (o, "
        "con aggregate_by, usar aggregation.top_by_delta / delta_hint) en vez del "
        "% individual, que sobre-representa ítems chicos con swings grandes. "
        "Soporta 'jinja_filters' (igual que irex.query_dataset) para datasets con "
        "columnas calculadas vía filter_values()/get_filters() en su SQL virtual — "
        "usar cuando 'get_query_context'/'get_dashboard_dataset_context' clasifiquen "
        "un filtro nativo del dashboard como usable_as='jinja_filters'. "
        "La respuesta incluye 'report_id', reutilizable en irex.export_to_excel "
        "para exportar EXACTAMENTE ese análisis sin reconstruir parámetros."
    ),
    tags=["irex", "negocio", "comparación", "variación", "alertas", "períodos"],
)
def compare_periods(request: ComparePeriodsRequest) -> dict[str, Any]:
    from .dashboard_dataset_context import _reject_hidden_columns

    referenced = (
        set(request.groupby)
        | {f.column for f in request.base_filters}
        | {f.column for f in request.period_a_filters}
        | {f.column for f in request.period_b_filters}
    )
    hidden_error = _reject_hidden_columns(request.dataset_id, referenced)
    if hidden_error:
        return {"status": "error", "error": hidden_error, "rows": []}

    if request.aggregate_by:
        invalid = [c for c in request.aggregate_by if c not in request.groupby]
        if invalid:
            return {
                "status": "error",
                "error": (
                    f"aggregate_by contiene columnas que no están en groupby: {invalid}. "
                    "aggregate_by debe ser un subconjunto de groupby."
                ),
                "rows": [],
            }
        if set(request.aggregate_by) == set(request.groupby):
            return {
                "status": "error",
                "error": (
                    "aggregate_by debe ser un subconjunto ESTRICTO de groupby: "
                    "debe tener menos columnas que groupby para agregar a un nivel "
                    "más resumido."
                ),
                "rows": [],
            }

    (
        base_filters,
        period_a_filters,
        period_b_filters,
        jinja_filters,
        dashboard_filters_reclassified,
    ) = _reclassify_dashboard_filters(
        request.dashboard_id,
        request.base_filters,
        request.period_a_filters,
        request.period_b_filters,
        request.jinja_filters,
    )

    metrics_parsed = [_parse_metric(m) for m in request.metrics]
    metric_labels: list[str] = [
        m if isinstance(m, str) else m.get("label", str(m))
        for m in metrics_parsed
    ]
    # Métricas aditivas (SUM/COUNT) → la contribución al cambio total tiene
    # sentido. request.metrics y metric_labels van en el mismo orden.
    additive_labels = {
        label
        for raw, label in zip(request.metrics, metric_labels)
        if _is_additive_metric(raw)
    }

    period_inversion_warning = _detect_period_inversion(period_a_filters, period_b_filters)
    possible_repeat_inverted_call = report_cache.find_recent_inverted_call(
        request.dataset_id,
        request.groupby,
        [f.model_dump() for f in period_a_filters],
        [f.model_dump() for f in period_b_filters],
    )

    # Detectar columnas de base_filters que colisionan con period_filters
    period_a_cols = {f.column for f in period_a_filters}
    period_b_cols = {f.column for f in period_b_filters}
    overridden_cols = sorted(
        {f.column for f in base_filters if f.column in period_a_cols | period_b_cols}
    )

    comparison = _build_comparison(
        request.dataset_id, metrics_parsed, metric_labels, additive_labels,
        request.groupby, base_filters, period_a_filters, period_b_filters,
        request.sort_by, request.min_variation_pct, jinja_filters,
    )
    if comparison["error"]:
        return {"status": "error", "error": comparison["error"], "rows": []}

    rows_a = comparison["rows_a"]
    rows_b = comparison["rows_b"]
    combined = comparison["combined"]
    alerts_count = comparison["alerts_count"]
    total_delta = comparison["total_delta"]
    total_delta_seen = comparison["total_delta_seen"]
    combined_total = len(combined)
    matched = comparison["matched"]
    unmatched_a = comparison["unmatched_a"]
    unmatched_b = comparison["unmatched_b"]

    # Con aggregate_by, el valor está en el conteo agregado ('aggregation') — devolver
    # solo una muestra chica de filas individuales, como referencia/ejemplo.
    # Sin aggregate_by, 'row_limit' se aplica ACÁ — sobre 'combined' ya cruzado
    # y ordenado por variación — para que un recorte parcial siga siendo el
    # top-N real por variación, no un subconjunto arbitrario.
    rows_out = combined[:10] if request.aggregate_by else combined[: request.row_limit]

    response: dict[str, Any] = {
        "status": "success",
        "period_a_row_count": len(rows_a),
        "period_b_row_count": len(rows_b),
        "matched_count": matched,
        "unmatched_a_only_count": unmatched_a,
        "unmatched_b_only_count": unmatched_b,
        "alerts_count": alerts_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    # Cambio total (delta) por métrica aditiva — denominador auditable de la
    # contribución: las contribuciones de todas las combinaciones suman ~100%.
    change_totals = {
        label: round(total_delta[label], 4)
        for label in metric_labels
        if label in additive_labels and total_delta_seen[label]
    }
    if change_totals:
        response["change_totals"] = change_totals
        response["contribution_note"] = (
            "En 'rows', '{metric}_delta' es el cambio ABSOLUTO (B - A) y "
            "'{metric}_contribution_pct' es qué porcentaje del cambio TOTAL de esa "
            "métrica (ver 'change_totals') explica esa combinación. Solo se calcula "
            "para métricas aditivas (SUM/COUNT). Un signo negativo indica que la "
            "fila se movió en sentido CONTRARIO al total (lo amortiguó). Para "
            "responder '¿qué explica la caída/subida?' rankear por "
            "contribution_pct / delta (sort_by='abs_delta'), no por el % individual."
        )
    if dashboard_filters_reclassified:
        response["dashboard_filters_reclassified"] = dashboard_filters_reclassified
    if possible_repeat_inverted_call:
        response["possible_repeat_inverted_call_warning"] = (
            "Esta llamada tiene los mismos filtros que una llamada reciente "
            "(últimos 10 min) con período A y B invertidos. Verificar que el "
            "orden A=referencia/anterior y B=actual/nuevo sea intencional."
        )

    if request.aggregate_by:
        # 'aggregation' se coloca ANTES que 'rows' a propósito: contiene la
        # respuesta directa ('answer_hint', 'top_increases', 'top_decreases').
        aggregation = _aggregate_by_direction(
            combined, metric_labels, request.aggregate_by,
            request.min_variation_pct or 0,
            additive_labels,
        )
        response["aggregation"] = aggregation
        response["rows"] = rows_out

        # Un solo grupo agregado significa que no hubo nada contra qué comparar
        # — típicamente porque algún filtro (base_filters/period_a/b_filters)
        # restringió el alcance a un único valor de la entidad que se está
        # comparando, antes de llegar a agrupar. Genérico: no depende de qué
        # columna sea 'aggregate_by' ni de qué valores tenga.
        if aggregation["groups_count"] == 1:
            response["aggregation_scope_warning"] = (
                "El resultado agregado tiene un solo grupo — no hubo nada contra "
                "qué comparar. Si la pregunta esperaba comparar varias categorías "
                "de esa misma columna, revisar si algún filtro (base_filters, "
                "period_a_filters o period_b_filters) restringió el alcance a un "
                "único valor antes de agrupar, y repetir la consulta incluyendo "
                "todos los valores relevantes."
            )
        if len(combined) > 10:
            response["rows_note"] = (
                f"'rows' es solo una MUESTRA de {len(rows_out)} filas de ejemplo "
                f"(de {len(combined)} alertas totales) — NO usar 'rows' para contar "
                "ni para responder cuál grupo tuvo más aumentos/disminuciones. "
                "La respuesta ya calculada está en 'aggregation.answer_hint', "
                "'aggregation.top_increases'/'top_decreases' (cantidad) y "
                "'aggregation.top_by_delta'/'delta_hint' (cuál grupo movió más el total)."
            )
    else:
        response["rows"] = rows_out
        if combined_total > request.row_limit:
            criterio = (
                "mayor cambio ABSOLUTO (delta)"
                if request.sort_by == "abs_delta"
                else "mayor variación absoluta (%)"
            )
            response["rows_note"] = (
                f"'rows' contiene las {request.row_limit} combinaciones con "
                f"{criterio} (de {combined_total} comparadas en total, tras cruzar "
                "ambos períodos) — no es una muestra arbitraria. Para ver más filas, "
                "subir row_limit; para cambiar el criterio, usar sort_by."
            )

    if period_inversion_warning:
        response["period_order_warning"] = period_inversion_warning

    if overridden_cols:
        response["filter_warning"] = (
            f"Las columnas {overridden_cols} estaban en base_filters Y en "
            "period_a/b_filters — el filtro de período tuvo precedencia y el "
            "de base fue ignorado para esas columnas. "
            "Para evitar esto, no incluir en base_filters la columna que distingue "
            "los períodos (ej. 'mes'); solo incluir columnas comunes a ambos (ej. 'anio')."
        )

    if len(rows_a) >= _INTERNAL_FETCH_LIMIT or len(rows_b) >= _INTERNAL_FETCH_LIMIT:
        response["row_limit_warning"] = (
            f"Se alcanzó el tope interno de {_INTERNAL_FETCH_LIMIT} filas en al "
            "menos un período — pueden existir más combinaciones no comparadas "
            "(esto es independiente de row_limit, que solo limita 'rows' de "
            "salida). Agregar más filtros en base_filters para acotar el dataset."
        )

    if request.totals:
        try:
            total_a, total_err_a = _run_period_query(
                request.dataset_id,
                metrics_parsed,
                [],
                base_filters,
                period_a_filters,
                jinja_filters=jinja_filters,
            )
            if total_err_a:
                raise RuntimeError(f"Error en total período A: {total_err_a}")
            total_b, total_err_b = _run_period_query(
                request.dataset_id,
                metrics_parsed,
                [],
                base_filters,
                period_b_filters,
                jinja_filters=jinja_filters,
            )
            if total_err_b:
                raise RuntimeError(f"Error en total período B: {total_err_b}")
            row_a = total_a[0] if total_a else {}
            row_b = total_b[0] if total_b else {}
            response["totals"] = {
                label: {
                    "a": _to_float(row_a.get(label)),
                    "b": _to_float(row_b.get(label)),
                    "var_pct": _variation_pct(
                        _to_float(row_a.get(label)),
                        _to_float(row_b.get(label)),
                    ),
                }
                for label in metric_labels
            }
        except Exception as exc:
            response["totals_error"] = str(exc)

    report_params: dict[str, Any] = {
        "dataset_id": request.dataset_id,
        "metrics": request.metrics,
        "groupby": request.groupby,
        "base_filters": [f.model_dump() for f in base_filters],
        "period_a_filters": [f.model_dump() for f in period_a_filters],
        "period_b_filters": [f.model_dump() for f in period_b_filters],
        "min_variation_pct": request.min_variation_pct,
        # Guardados para que irex.export_to_excel(report_id=...) reconstruya
        # EXACTAMENTE este mismo análisis (mismo orden, mismos encabezados
        # legibles) en vez de recalcular con valores por defecto distintos.
        "sort_by": request.sort_by,
        "period_a_label": request.period_a_label or _infer_period_label(period_a_filters, "Período A"),
        "period_b_label": request.period_b_label or _infer_period_label(period_b_filters, "Período B"),
    }
    if jinja_filters:
        report_params["jinja_filters"] = [f.model_dump() for f in jinja_filters]
    response["report_id"] = report_cache.store_report(
        dataset_id=request.dataset_id,
        mode="compare_periods",
        params=report_params,
    )

    return response
