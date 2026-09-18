from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from . import partition_ranking_core as core
from . import report_cache
from .query_dataset import DatasetFilter, JinjaFilterOverride
from .sql_analysis import _MAX_FETCH_ROW_LIMIT, _fetch_source_rows


class RankPartitionsRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    metrics: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Métricas a preagregar en Superset — mismo formato que "
            "irex.query_dataset, SIEMPRE con alias: 'SUM(plan_anio_seleccion) AS "
            "plan_2027'. La preagregación es OBLIGATORIA en esta tool (no se "
            "cargan filas crudas): debe incluir al menos las dos métricas que "
            "luego se referencian en metric_a/metric_b por su alias."
        ),
    )
    partition_by: list[str] = Field(
        default_factory=list,
        description=(
            "Columnas que definen cada partición (ej. ['area_comercial_nombre']) "
            "— el top_n se aplica DENTRO de cada partición, no globalmente. "
            "Vacío = una sola partición global."
        ),
    )
    detail_by: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Columnas del detalle a rankear dentro de cada partición (ej. "
            "['marca_familia_nombre']). No pueden repetirse en partition_by."
        ),
    )
    metric_a: str = Field(
        ...,
        description=(
            "Alias EXACTO (tal como quedó en 'metrics') de la métrica A. La "
            "brecha se calcula SIEMPRE como COALESCE(metric_a,0) - "
            "COALESCE(metric_b,0) — una combinación presente solo en A vale +A."
        ),
    )
    metric_b: str = Field(
        ...,
        description=(
            "Alias EXACTO de la métrica B. Una combinación presente solo en B "
            "vale -B (no desaparece del ranking por NULL)."
        ),
    )
    filters: list[DatasetFilter] = Field(
        default_factory=list,
        description="Filtros WHERE aplicados en Superset (respetan RLS).",
    )
    jinja_filters: list[JinjaFilterOverride] | None = Field(
        None,
        description="Mismo contrato que en irex.query_dataset_sql — solo para "
        "datasets con columnas calculadas vía filter_values()/get_filters().",
    )
    rank_by: Literal["abs_delta", "delta", "metric_a", "metric_b"] = Field(
        "abs_delta",
        description=(
            "Métrica de ordenamiento del ranking. Para explicar QUÉ MUEVE el "
            "total de la partición usar 'abs_delta' (recomendado): captura tanto "
            "las caídas grandes como las subas grandes."
        ),
    )
    direction: Literal["desc", "asc"] = Field(
        "desc", description="Dirección del ordenamiento del ranking."
    )
    top_n: int = Field(
        10, ge=1, le=100,
        description="Filas de detalle a devolver POR PARTICIÓN (los totales "
        "siempre se calculan sobre el universo completo, no sobre el top_n).",
    )
    fetch_row_limit: int = Field(
        5000, ge=1, le=_MAX_FETCH_ROW_LIMIT,
        description="Máximo de filas preagregadas a traer de Superset.",
    )
    require_complete_source: bool = Field(
        True,
        description=(
            "Si true (default), una fuente truncada por fetch_row_limit devuelve "
            "status='incomplete' SIN ranking — un ranking sobre un subconjunto "
            "no es confiable. Solo pasar false de forma consciente; el resultado "
            "irá marcado result_exact=false."
        ),
    )
    save_as_report: bool = Field(
        False,
        description="Si True, guarda este ranking (filas y parámetros) y "
        "devuelve 'report_id' — reutilizable en irex.chart_option vía "
        "'source_result_ref' para graficar EXACTAMENTE las combinaciones de "
        "este Top-N POR PARTICIÓN (ej. 'top 5 artículos dentro de cada "
        "formato') sin retranscribirlas a mano. Para esto, en "
        "irex.chart_option pasar facet_by=partition_by y "
        "series_by=detail_by (o al revés, según qué se quiera usar como "
        "panel) junto con source_result_ref — NUNCA se derivan "
        "automáticamente, son decisiones de diseño visual. Vence en 2 horas.",
    )


@tool(
    name="irex.rank_partitions",
    description=(
        "Ranking Top-N POR PARTICIÓN de la brecha entre dos métricas, con "
        "totales reconciliados — USAR ESTA TOOL (no SQL libre en "
        "irex.query_dataset_sql) cuando la pregunta es del tipo: '¿qué "
        "productos/marcas/clientes explican la diferencia entre plan y "
        "proyección (o entre dos métricas cualesquiera) dentro de cada "
        "área/canal/mes?'. "
        "Garantías que el SQL libre no da: (1) la brecha es SIEMPRE "
        "COALESCE(a,0)-COALESCE(b,0) — una combinación presente solo en una de "
        "las métricas cuenta como +A o -B, nunca desaparece por NULL; (2) el "
        "top_n se aplica DENTRO de cada partición (ROW_NUMBER OVER PARTITION "
        "BY); (3) los totales por partición se calculan sobre TODAS las filas, "
        "no solo el Top-N — 'remaining_delta' muestra cuánto queda fuera del "
        "Top-N; (4) 'reconciliation' verifica que el detalle cierre contra "
        "metric_a_total - metric_b_total; (5) si la fuente queda truncada por "
        "fetch_row_limit, devuelve status='incomplete' en vez de un ranking "
        "engañoso. "
        "La fuente SIEMPRE se preagrega en Superset (metrics + partition_by + "
        "detail_by como groupby, respetando RLS). "
        "Interpretación de la respuesta: en 'rows' las dos métricas aparecen "
        "como columnas con su ALIAS REAL (ej. 'plan_2027', 'proy_cierre_2026') "
        "junto a 'delta', 'abs_delta' y 'rank'; en 'partition_totals' los "
        "totales se llaman '<alias>_total' (ej. 'plan_2027_total'). delta>0 = "
        "metric_a por encima de metric_b; 'remaining_delta' con signo contrario "
        "al delta_total indica que fuera del Top-N hay movimientos en sentido "
        "opuesto. Para un Top-N simple de UNA sola métrica sin comparación, "
        "usar irex.query_dataset o SQL con QUALIFY en irex.query_dataset_sql. "
        "Si este ranking se va a graficar después (ej. small_multiples con un "
        "panel por partición y una línea por detalle), pasar "
        "save_as_report=True — la respuesta trae 'report_id', reutilizable en "
        "irex.chart_option vía 'source_result_ref' para usar EXACTAMENTE las "
        "combinaciones de este Top-N POR PARTICIÓN sin retranscribirlas a "
        "mano (a diferencia de irex.query_dataset, que solo sirve para un "
        "Top-N global, no 'top N por cada partición')."
    ),
)
def rank_partitions(request: RankPartitionsRequest) -> dict[str, Any]:
    groupby = list(request.partition_by) + list(request.detail_by)

    rows, error, truncated = _fetch_source_rows(
        request.dataset_id,
        request.metrics,
        groupby,
        request.filters,
        request.fetch_row_limit,
        request.jinja_filters,
    )
    if error:
        return {"status": "error", "error": error}
    if not rows:
        return {
            "status": "no_data",
            "row_count": 0,
            "message": "La consulta a Superset no devolvió filas — no hay datos para rankear.",
        }

    if truncated and request.require_complete_source:
        return {
            "status": "incomplete",
            "result_exact": False,
            "incomplete_reason": "source_truncated",
            "source_row_count": len(rows),
            "source_truncated": True,
            "error": (
                f"La fuente alcanzó fetch_row_limit={request.fetch_row_limit} — "
                "el ranking se calcularía sobre un SUBCONJUNTO y los totales/"
                "posiciones serían engañosos, así que no se devuelve. Opciones: "
                f"subir fetch_row_limit (máx {_MAX_FETCH_ROW_LIMIT}), acotar con "
                "'filters', o usar dimensiones de menor cardinalidad. Como último "
                "recurso, require_complete_source=false devuelve el ranking "
                "marcado como NO exacto."
            ),
        }

    try:
        import pandas as pd
    except ImportError as exc:
        return {"status": "error", "error": f"Dependencia no disponible: {exc}"}

    df = core.rows_to_numeric_df(rows, pd)
    columns = [str(c) for c in df.columns]
    column_types: dict[str, str] = {}
    for c in df.columns:
        dtype = df[c].dtype
        if pd.api.types.is_numeric_dtype(dtype):
            column_types[str(c)] = "number"
        elif pd.api.types.is_datetime64_any_dtype(dtype):
            column_types[str(c)] = "datetime"
        else:
            column_types[str(c)] = "text"

    validation_error = core.validate_inputs(
        columns, column_types,
        request.partition_by, request.detail_by,
        request.metric_a, request.metric_b, request.rank_by,
    )
    if validation_error:
        return {
            "status": "error",
            "error": validation_error,
            "source_columns": columns,
            "source_column_types": column_types,
        }

    computed = core.compute_partition_ranking(
        df,
        request.partition_by, request.detail_by,
        request.metric_a, request.metric_b,
        request.rank_by, request.direction, request.top_n,
    )

    response: dict[str, Any] = {
        "status": "success",
        "result_exact": not truncated,
        "source_row_count": len(rows),
        "source_truncated": truncated,
        "ranking": {
            "partition_by": request.partition_by,
            "detail_by": request.detail_by,
            "metric_a": request.metric_a,
            "metric_b": request.metric_b,
            "rank_by": request.rank_by,
            "direction": request.direction,
            "top_n": request.top_n,
        },
        **computed,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if truncated:
        response["incomplete_reason"] = "source_truncated"
        response["source_truncated_warning"] = (
            "La fuente quedó truncada en fetch_row_limit y "
            "require_complete_source=false — rankings, totales y reconciliación "
            "se calcularon sobre un SUBCONJUNTO. NO presentar estos números como "
            "exactos."
        )

    if request.save_as_report:
        response["report_id"] = report_cache.store_report(
            dataset_id=request.dataset_id,
            mode="rank_partitions",
            params={
                "dataset_id": request.dataset_id,
                "groupby": groupby,
                "filters": [f.model_dump() for f in request.filters],
                "metrics": request.metrics,
                "rows": computed["rows"],
            },
        )
    return response
