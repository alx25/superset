"""Núcleo de cálculo de irex.rank_partitions — SIN imports de Superset.

Separado del módulo de la tool para poder testearlo con fixtures sintéticos
fuera del proceso de Superset (el módulo de la tool importa superset_core y
solo es importable dentro del servicio MCP). Todo el SQL se genera acá, con
semántica fija que el LLM no puede degradar:

  - delta = COALESCE(metric_a, 0) - COALESCE(metric_b, 0) SIEMPRE — una
    combinación presente solo en una de las dos métricas vale +A o -B, nunca
    desaparece por propagación de NULL;
  - ROW_NUMBER() OVER (PARTITION BY ...) con desempate determinístico por las
    columnas de dimensión — top_n se aplica DENTRO de cada partición;
  - los totales por partición se calculan sobre TODAS las filas preagregadas
    de la partición, antes de aplicar top_n.
"""

from typing import Any

RANK_MODES = ("abs_delta", "delta", "metric_a", "metric_b")
_RECONCILIATION_TOLERANCE = 1e-6
_MAX_OUTPUT_ROWS = 500
# Nombres que la salida agrega junto a las columnas del usuario — las
# dimensiones y aliases de métricas no pueden usarlos ni empezar con el
# prefijo interno, o colisionarían en el SELECT final.
_RESERVED_OUTPUT_NAMES = ("delta", "abs_delta", "rank")
_INTERNAL_PREFIX = "__pr_"


def rows_to_numeric_df(rows: list[dict[str, Any]], pd: Any) -> Any:
    """Igual criterio que _rows_to_numeric_df de sql_analysis: coacciona a
    numérico lo que se deje, el resto queda como texto."""
    df = pd.DataFrame(rows)
    for col in df.columns:
        try:
            df[col] = pd.to_numeric(df[col])
        except (ValueError, TypeError):
            pass
    return df


def _qi(name: str) -> str:
    """Identificador SQL citado — soporta espacios, paréntesis y comillas
    internas (ej. columnas 'SUM(plan)' o 'marca familia')."""
    return '"' + name.replace('"', '""') + '"'


def _to_native(v: Any) -> Any:
    """numpy escalar → python nativo; NaN/Inf → None (no son JSON válidos)."""
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    return v


def _df_records(df: Any) -> list[dict[str, Any]]:
    return [
        {k: _to_native(v) for k, v in row.items()}
        for row in df.to_dict("records")
    ]


def validate_inputs(
    columns: list[str],
    column_types: dict[str, str],
    partition_by: list[str],
    detail_by: list[str],
    metric_a: str,
    metric_b: str,
    rank_by: str,
) -> str | None:
    """Valida contra el schema REAL de la tabla cargada (no infiere nombres).
    Devuelve un mensaje de error accionable, o None si todo es válido."""
    if rank_by not in RANK_MODES:
        return f"rank_by inválido: {rank_by!r}. Modos soportados: {', '.join(RANK_MODES)}."
    if not detail_by:
        return "detail_by no puede estar vacío — define las filas del ranking."
    overlap = set(partition_by) & set(detail_by)
    if overlap:
        return (
            "partition_by y detail_by no pueden compartir columnas: "
            + ", ".join(sorted(overlap))
        )
    if metric_a == metric_b:
        return "metric_a y metric_b deben ser métricas distintas."
    available = set(columns)
    for name in list(partition_by) + list(detail_by) + [metric_a, metric_b]:
        if name.lower() in _RESERVED_OUTPUT_NAMES or name.startswith(_INTERNAL_PREFIX):
            return (
                f"El nombre {name!r} está reservado para columnas de la salida "
                f"({', '.join(_RESERVED_OUTPUT_NAMES)}) — usar otro alias, ej. "
                f"'SUM(x) AS {name}_kg'."
            )
    for dim in list(partition_by) + list(detail_by):
        if dim not in available:
            return (
                f"Columna de dimensión {dim!r} no existe en la fuente. "
                f"Columnas disponibles: {', '.join(columns)}."
            )
    numeric = sorted(c for c, t in column_types.items() if t == "number")
    for label, m in (("metric_a", metric_a), ("metric_b", metric_b)):
        if m not in available:
            return (
                f"{label}={m!r} no existe en la fuente — debe ser el alias EXACTO "
                "de una métrica pedida en 'metrics' (ej. 'SUM(x) AS plan_2027' → "
                f"usar 'plan_2027'). Columnas numéricas disponibles: "
                f"{', '.join(numeric) or '(ninguna)'}."
            )
        if column_types.get(m) != "number":
            return (
                f"{label}={m!r} no es numérica (tipo: {column_types.get(m)}). "
                f"Columnas numéricas disponibles: {', '.join(numeric) or '(ninguna)'}."
            )
        if m in partition_by or m in detail_by:
            return f"{label}={m!r} no puede ser también una columna de partición/detalle."
    return None


def compute_partition_ranking(
    df: Any,
    partition_by: list[str],
    detail_by: list[str],
    metric_a: str,
    metric_b: str,
    rank_by: str,
    direction: str,
    top_n: int,
) -> dict[str, Any]:
    """Corre el ranking sobre un DataFrame ya validado. Devuelve dict con
    'rows', 'partition_totals', 'reconciliation' y 'null_diagnostics'
    (+ 'output_truncated_warning' si se recortó la salida)."""
    import duckdb

    dims = list(partition_by) + list(detail_by)
    dims_sql = ", ".join(_qi(c) for c in dims)
    part_sql = ", ".join(_qi(c) for c in partition_by)
    qa, qb = _qi(metric_a), _qi(metric_b)
    # Las columnas de salida llevan los nombres REALES de las métricas (y
    # '<alias>_total' en los totales) — claves genéricas tipo 'metric_a' hacen
    # ilegible la tabla que el chat renderiza. Internamente se usa el prefijo
    # __pr_ para que ninguna dimensión/alias del usuario colisione en el SQL.
    total_a, total_b = f"{metric_a}_total", f"{metric_b}_total"

    rank_expr = {
        "abs_delta": "ABS(__pr_delta)",
        "delta": "__pr_delta",
        "metric_a": "__pr_a",
        "metric_b": "__pr_b",
    }[rank_by]
    order_dir = "ASC" if direction == "asc" else "DESC"
    # Desempate determinístico por las dimensiones — un empate en la métrica
    # de ranking no puede cambiar el resultado entre ejecuciones.
    tiebreak = ", ".join(_qi(c) for c in dims)
    over_partition = f"PARTITION BY {part_sql} " if partition_by else ""

    base_cte = f"""
        WITH base AS (
            SELECT {dims_sql},
                   {qa} AS __pr_raw_a,
                   {qb} AS __pr_raw_b,
                   COALESCE({qa}, 0) AS __pr_a,
                   COALESCE({qb}, 0) AS __pr_b,
                   COALESCE({qa}, 0) - COALESCE({qb}, 0) AS __pr_delta
            FROM src
        )
    """

    con = duckdb.connect(":memory:")
    try:
        con.execute("SET enable_external_access=false")
        con.execute("SET autoinstall_known_extensions=false")
        con.execute("SET autoload_known_extensions=false")
        con.register("src", df)

        detail_df = con.execute(
            base_cte
            + f"""
            , ranked AS (
                SELECT {dims_sql}, __pr_a, __pr_b, __pr_delta,
                       ABS(__pr_delta) AS __pr_abs,
                       ROW_NUMBER() OVER (
                           {over_partition}ORDER BY {rank_expr} {order_dir}, {tiebreak}
                       ) AS __pr_rank
                FROM base
            )
            SELECT {dims_sql},
                   __pr_a AS {qa},
                   __pr_b AS {qb},
                   __pr_delta AS delta,
                   __pr_abs AS abs_delta,
                   __pr_rank AS "rank"
            FROM ranked WHERE __pr_rank <= {int(top_n)}
            ORDER BY {(part_sql + ', ') if partition_by else ''}__pr_rank
            """
        ).df()

        totals_sql = (
            base_cte
            + f"""
            SELECT {(part_sql + ',') if partition_by else ''}
                   SUM(__pr_a) AS {_qi(total_a)},
                   SUM(__pr_b) AS {_qi(total_b)},
                   SUM(__pr_delta) AS delta_total,
                   CASE WHEN SUM(__pr_b) = 0 THEN NULL
                        ELSE (SUM(__pr_a) - SUM(__pr_b)) / SUM(__pr_b) * 100
                   END AS variation_pct,
                   COUNT(*) AS detail_row_count
            FROM base
            """
        )
        if partition_by:
            totals_sql += f" GROUP BY {part_sql} ORDER BY {part_sql}"
        totals_df = con.execute(totals_sql).df()

        nulls_df = con.execute(
            base_cte
            + """
            SELECT
                COUNT(*) FILTER (WHERE __pr_raw_a IS NULL) AS metric_a_null_rows,
                COUNT(*) FILTER (WHERE __pr_raw_b IS NULL) AS metric_b_null_rows,
                COUNT(*) FILTER (WHERE __pr_raw_a IS NOT NULL AND __pr_raw_b IS NULL) AS only_metric_a_rows,
                COUNT(*) FILTER (WHERE __pr_raw_b IS NOT NULL AND __pr_raw_a IS NULL) AS only_metric_b_rows,
                COUNT(*) FILTER (WHERE __pr_raw_a IS NULL AND __pr_raw_b IS NULL) AS both_null_rows
            FROM base
            """
        ).df()
    finally:
        con.close()

    rows = _df_records(detail_df)
    totals = _df_records(totals_df)
    null_diag = _df_records(nulls_df)[0]
    # Nada se excluye del ranking: COALESCE garantiza que toda combinación
    # participa (una fila con ambas métricas NULL vale delta=0).
    null_diag["excluded_rows"] = 0

    # Agregados del Top-N por partición (en Python, sobre el detalle ya
    # rankeado) — hacen explícito que el Top-N NO es el universo completo.
    def part_key(row: dict[str, Any]) -> tuple:
        return tuple(row[c] for c in partition_by)

    top_delta: dict[tuple, float] = {}
    top_count: dict[tuple, int] = {}
    for row in rows:
        k = part_key(row)
        top_delta[k] = top_delta.get(k, 0.0) + (row["delta"] or 0.0)
        top_count[k] = top_count.get(k, 0) + 1

    reconciliation_details: list[dict[str, Any]] = []
    reconciled = 0
    for t in totals:
        k = tuple(t[c] for c in partition_by)
        t["top_n_row_count"] = top_count.get(k, 0)
        t["top_n_delta_sum"] = top_delta.get(k, 0.0)
        t["remaining_delta"] = (t["delta_total"] or 0.0) - t["top_n_delta_sum"]

        expected = (t[total_a] or 0.0) - (t[total_b] or 0.0)
        detail_sum = t["delta_total"] or 0.0
        difference = detail_sum - expected
        ok = abs(difference) <= _RECONCILIATION_TOLERANCE * max(1.0, abs(expected))
        if ok:
            reconciled += 1
        else:
            reconciliation_details.append({
                "partition": {c: t[c] for c in partition_by},
                total_a: t[total_a],
                total_b: t[total_b],
                "expected_delta": expected,
                "detail_delta_sum": detail_sum,
                "difference": difference,
            })

    result: dict[str, Any] = {
        "rows": rows[:_MAX_OUTPUT_ROWS],
        "partition_totals": totals[:_MAX_OUTPUT_ROWS],
        "reconciliation": {
            "status": "ok" if reconciled == len(totals) else "warning",
            "tolerance": _RECONCILIATION_TOLERANCE,
            "partitions_checked": len(totals),
            "partitions_reconciled": reconciled,
            "details": reconciliation_details,
        },
        "null_diagnostics": null_diag,
    }
    if len(rows) > _MAX_OUTPUT_ROWS or len(totals) > _MAX_OUTPUT_ROWS:
        result["output_truncated_warning"] = (
            f"La salida supera {_MAX_OUTPUT_ROWS} filas de detalle o de totales "
            "— se recortó. Reducir top_n, acotar con 'filters' o particionar "
            "por una dimensión de menor cardinalidad."
        )
    return result
