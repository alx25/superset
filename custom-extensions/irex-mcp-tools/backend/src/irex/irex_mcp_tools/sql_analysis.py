import re
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .dashboard_dataset_context import _is_hidden_from_ia
from .query_dataset import (
    DatasetFilter,
    JinjaFilterOverride,
    _jinja_filters_context,
    _parse_filter,
    _parse_metric,
    _parse_orderby,
    _sanitize_rows,
)

# Defensa en profundidad — aunque enable_external_access=false ya bloquea
# I/O de archivos/red en DuckDB, se rechaza explícitamente cualquier intento
# de tocar el sistema, extensiones, u otras sentencias que no sean lectura.
_SQL_UNSAFE_RE = re.compile(
    r"\b(attach|detach|copy|export|import|install|load|pragma|create|insert|"
    r"update|delete|alter|drop|call|set|vacuum|checkpoint|read_csv|read_json|"
    r"read_parquet|glob|httpfs)\b",
    re.I,
)
_MAX_FETCH_ROW_LIMIT = 20000
_MAX_RESULT_ROW_LIMIT = 500

_SYNTHETIC_DUP_COLUMN_RE = re.compile(r"^(.+)__\d+$")


def _is_synthetic_duplicate_column(column: Any, all_names: set[str]) -> bool:
    """True si esta es una columna 'nombre__N' que Superset generó porque el
    SQL virtual del dataset ya trae dos columnas de salida con el mismo
    nombre real (ej. dataset 198: 'vendedor_id' listado dos veces en el
    SELECT de sus 3 ramas UNION ALL, sin alias que las distinga). Referenciar
    ese nombre base (no el sintético __N) sin calificar contra la subconsulta
    del dataset falla con 'column reference ... is ambiguous' en Postgres,
    porque de las dos columnas duplicadas ninguna se puede distinguir por
    nombre. Se excluyen del fallback 'traer todas las columnas' — si el LLM
    las pide explícitamente en 'groupby' el error de Postgres sigue apareciendo
    pero ahí ya no es un fallo silencioso del modo automático."""
    if column.expression:
        return False
    match = _SYNTHETIC_DUP_COLUMN_RE.match(column.column_name)
    return bool(match) and match.group(1) in all_names


def _validate_sql(sql: str) -> str | None:
    stripped = sql.strip().rstrip(";").strip()
    if not stripped:
        return "sql no puede estar vacío."
    if ";" in stripped:
        return "sql no puede contener múltiples sentencias separadas por ';'."
    if not re.match(r"^\s*(SELECT|WITH|PIVOT|UNPIVOT)\b", stripped, re.I):
        return (
            "sql debe ser una consulta de solo lectura — debe empezar con "
            "SELECT, WITH, PIVOT o UNPIVOT."
        )
    if _SQL_UNSAFE_RE.search(stripped):
        return (
            "sql contiene palabras clave no permitidas (solo se permiten consultas "
            "SELECT/WITH de lectura sobre la tabla 'data')."
        )
    return None


_VALID_TABLE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _validate_extra_table_name(name: str, seen: set[str]) -> str | None:
    """Valida el nombre de una tabla extra: identificador SQL válido, distinto
    de 'data' (reservado para la fuente principal) y no duplicado. 'seen'
    contiene los nombres ya usados en minúscula (incluido 'data')."""
    if not name or not _VALID_TABLE_NAME_RE.match(name):
        return (
            f"Nombre de tabla extra inválido: {name!r}. Debe ser un identificador "
            "SQL (letras, números y '_', empezando por letra o '_')."
        )
    if name.lower() in seen:
        if name.lower() == "data":
            return (
                "'data' está reservado para la fuente principal — usá otro nombre "
                "para la tabla extra (ej. 'data2')."
            )
        return (
            f"Nombre de tabla extra duplicado: {name!r}. Cada tabla extra debe "
            "tener un nombre único."
        )
    return None


def _rows_to_numeric_df(rows: list[dict[str, Any]], pd: Any) -> Any:
    """Construye un DataFrame y coacciona a numérico las columnas que se dejen
    (las de texto quedan como object) — así DuckDB ve tipos correctos."""
    df = pd.DataFrame(rows)
    for col in df.columns:
        try:
            df[col] = pd.to_numeric(df[col])
        except (ValueError, TypeError):
            pass
    return df


def _describe_columns(df: Any, pd: Any) -> tuple[list[str], dict[str, str]]:
    """Devuelve (nombres, tipos) de las columnas de la tabla cargada, con el
    tipo simplificado a 'number'/'datetime'/'text' — le dice al LLM qué
    columnas puede agregar/promediar antes de escribir el SQL, sin tener que
    adivinar por el nombre."""
    columns = [str(c) for c in df.columns]
    types: dict[str, str] = {}
    for c in df.columns:
        dtype = df[c].dtype
        if pd.api.types.is_numeric_dtype(dtype):
            types[str(c)] = "number"
        elif pd.api.types.is_datetime64_any_dtype(dtype):
            types[str(c)] = "datetime"
        else:
            types[str(c)] = "text"
    return columns, types


def _fetch_source_rows(
    dataset_id: int,
    metrics: list[str],
    groupby: list[str],
    filters: list[DatasetFilter],
    fetch_row_limit: int,
    jinja_filters: list[JinjaFilterOverride] | None,
) -> tuple[list[dict[str, Any]] | None, str | None, bool]:
    """Trae filas de un dataset de Superset (respetando RLS) para cargarlas como
    una tabla del análisis SQL. Devuelve (rows, error, truncated):
      - (None, error, False)   → falló (columna oculta, rejected, Empty query…)
      - ([],   None,  False)   → corrió pero no devolvió filas
      - (rows, None,  trunc)   → trunc=True si se alcanzó fetch_row_limit (el
                                  resultado es un subconjunto, no el universo)

    Encapsula la lógica de fetch única compartida por la fuente principal y las
    tablas extra de execute_sql_analysis."""
    from .dashboard_dataset_context import _reject_hidden_columns

    referenced = set(groupby) | {f.column for f in filters}
    hidden_error = _reject_hidden_columns(dataset_id, referenced)
    if hidden_error:
        return None, hidden_error, False

    # 'metrics' no vacío + 'groupby' vacío colapsa la consulta a Superset a una
    # sola fila agregada sin ninguna columna de dimensión — la tabla queda con
    # una sola columna (el metric) y el sql no puede referenciar ninguna otra.
    if metrics and not groupby:
        return None, (
            "'metrics' está definido pero 'groupby' está vacío — esto trae una "
            "sola fila agregada sin columnas de dimensión, y el sql no podrá "
            "referenciar ninguna otra columna. Si el sql necesita agrupar/filtrar "
            "por columnas (ej. familia, mes, formato), agregarlas a 'groupby'. "
            "Si en cambio se quiere trabajar con datos crudos (sin agregar en "
            "Superset), dejar 'metrics' también vacío ([]) — así se traen todas "
            "las columnas del dataset y el sql hace su propia agregación."
        ), False

    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    metrics_parsed = [_parse_metric(m) for m in metrics]
    adhoc_filters = [_parse_filter(f) for f in filters]

    # Si no se especifica 'metrics' ni 'groupby', Superset no tiene qué
    # seleccionar y rechaza la consulta ("Empty query?") — en ese caso el
    # pedido implícito es "traer TODAS las columnas crudas", así que se
    # completan automáticamente desde el schema del dataset.
    fetch_columns = list(groupby)
    if not metrics and not fetch_columns:
        from superset.daos.dataset import DatasetDAO

        dataset = DatasetDAO.find_by_id(dataset_id)
        if dataset is None:
            return None, f"Dataset {dataset_id} no encontrado.", False
        all_names = {c.column_name for c in dataset.columns if c.column_name}
        fetch_columns = sorted(
            c.column_name
            for c in dataset.columns
            if c.column_name
            and not _is_synthetic_duplicate_column(c, all_names)
            and not _is_hidden_from_ia(c.description)
        )

    with _jinja_filters_context(jinja_filters) as forced:
        factory = QueryContextFactory()
        qc = factory.create(
            datasource={"id": dataset_id, "type": "table"},
            force=forced,
            queries=[{
                "filters": adhoc_filters,
                "columns": fetch_columns,
                "metrics": metrics_parsed,
                "row_limit": fetch_row_limit,
            }],
            form_data={"datasource": f"{dataset_id}__table", "viz_type": "table"},
        )
        cmd = ChartDataCommand(qc)
        cmd.validate()
        try:
            result = cmd.run()
        except Exception as exc:
            exc_str = str(exc)
            if "Empty query" in exc_str or "Consulta vacía" in exc_str:
                exc_str += (
                    " — no se pudo determinar qué columnas traer. Especificar "
                    "columnas en 'groupby' (con metrics=[] para traerlas crudas), "
                    "o dejar ambos vacíos para traer todas las columnas del dataset."
                )
            return None, exc_str, False

    qr = (result or {}).get("queries", [{}])[0]
    if qr.get("error"):
        return None, qr["error"], False
    rejected = qr.get("rejected_filters", [])
    if rejected:
        return None, (
            "Columna(s) no encontrada(s): "
            + ", ".join(str(r.get("column", r)) for r in rejected)
        ), False

    rows = _sanitize_rows(qr.get("data", []))
    truncated = len(rows) >= fetch_row_limit
    return rows, None, truncated


class ExtraTable(BaseModel):
    name: str = Field(
        ...,
        description=(
            "Nombre de la tabla en el SQL (ej. 'data2', 'pns', 'plan'). Debe ser "
            "un identificador SQL válido (letras/números/'_', empezando por letra "
            "o '_') y distinto de 'data' (reservado para la fuente principal). El "
            "sql la referencia por este nombre: FROM data JOIN data2 ON ..."
        ),
    )
    dataset_id: int = Field(
        ..., description="ID del dataset de Superset de esta fuente extra."
    )
    metrics: list[str] = Field(
        default_factory=list,
        description="Métricas a agregar para ESTA fuente (mismo formato/reglas "
        "que el 'metrics' principal).",
    )
    groupby: list[str] = Field(
        default_factory=list,
        description="Columnas de ESTA fuente (mismas reglas que el 'groupby' "
        "principal). metrics+groupby ambos vacíos = todas las columnas crudas.",
    )
    filters: list[DatasetFilter] = Field(
        default_factory=list,
        description="Filtros WHERE de ESTA fuente (respetan RLS).",
    )
    fetch_row_limit: int = Field(
        5000, ge=1, le=_MAX_FETCH_ROW_LIMIT,
        description="Máximo de filas a traer de ESTA fuente hacia su tabla.",
    )
    jinja_filters: list[JinjaFilterOverride] | None = Field(
        None,
        description="jinja_filters de ESTA fuente (ver el campo homónimo de la "
        "consulta principal).",
    )


class QueryDatasetSqlRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    metrics: list[str] = Field(
        default_factory=list,
        description=(
            "Métricas a agregar ANTES de cargar los datos en la tabla 'data' — mismo "
            "formato que irex.query_dataset ('AVG(precio)', 'SUM(ventas)', etc.). "
            "⚠️ IMPORTANTE: si el 'sql' necesita calcular sus PROPIAS estadísticas sobre "
            "una columna (STDDEV, MIN, MAX, COUNT DISTINCT, percentiles, correlaciones, "
            "dispersión, etc.), esa columna NO debe agregarse acá — debe traerse CRUDA. "
            "Ej.: para calcular desviación estándar de precio por mes en el SQL, este "
            "campo debe quedar vacío ([]) y 'groupby' debe incluir 'precio' (y cualquier "
            "otra columna cruda necesaria, ej. 'nombre_ubicacion') — el 'sql' hace su "
            "propio GROUP BY anio, mes con STDDEV(precio), COUNT(DISTINCT nombre_ubicacion), "
            "etc. Si en cambio 'metrics' ya trae 'AVG(precio)' agregado, esa es la ÚNICA "
            "forma de precio disponible en 'data' — no se puede recalcular STDDEV/MIN/MAX "
            "de algo que ya llegó promediado."
        ),
    )
    groupby: list[str] = Field(
        default_factory=list,
        description=(
            "Si 'metrics' NO está vacío: columnas de agrupación de la agregación en Superset "
            "(igual que irex.query_dataset). "
            "Si 'metrics' SÍ está vacío: columnas crudas a traer, una fila por registro — "
            "incluir aquí TODAS las columnas (dimensiones y numéricas) que el 'sql' vaya a "
            "necesitar para sus propios cálculos (ej. ['anio','mes','precio','nombre_ubicacion']). "
            "Si 'metrics' Y 'groupby' quedan AMBOS vacíos, se traen automáticamente TODAS las "
            "columnas del dataset (crudas) — útil para SQL que necesita muchas columnas sin "
            "tener que enumerarlas todas a mano."
        ),
    )
    filters: list[DatasetFilter] = Field(
        default_factory=list, description="Filtros WHERE aplicados en Superset (respetan RLS).",
    )
    fetch_row_limit: int = Field(
        5000, ge=1, le=_MAX_FETCH_ROW_LIMIT,
        description="Máximo de filas a traer de Superset hacia la tabla 'data' (antes de aplicar el SQL).",
    )
    sql: str = Field(
        ...,
        description=(
            "Consulta SQL (dialecto DuckDB) de SOLO LECTURA sobre la tabla 'data' "
            "(y las tablas de 'extra_tables', si se definen). 'data' contiene el "
            "resultado de la consulta anterior (columnas = groupby + metrics). "
            "Soporta: funciones de ventana (ROW_NUMBER, RANK, DENSE_RANK, LAG/LEAD, "
            "PARTITION BY) y su filtro QUALIFY; PIVOT/UNPIVOT nativo; agregaciones "
            "estadísticas (CORR, COVAR_POP, STDDEV, VAR_POP, PERCENTILE_CONT, MEDIAN, "
            "MODE, ENTROPY, MAD, SKEWNESS, KURTOSIS); regresión lineal en SQL puro "
            "(REGR_SLOPE, REGR_INTERCEPT, REGR_R2 → pendiente/intercepto/R² sin traer "
            "los puntos al LLM); HISTOGRAM(col) para distribuciones; CTEs (WITH); "
            "JOINs entre subconsultas o entre 'data' y las tablas extra (incluido "
            "ASOF JOIN para emparejar por fecha aproximada). "
            "Columnas con espacios o paréntesis (ej. 'AVG(precio)') deben citarse con "
            "comillas dobles: \"AVG(precio)\". Ejemplo: "
            'SELECT canal, RANK() OVER (ORDER BY "AVG(precio)" DESC) AS puesto FROM data.'
        ),
    )
    result_row_limit: int = Field(
        100, ge=1, le=_MAX_RESULT_ROW_LIMIT,
        description="Máximo de filas a devolver del resultado del SQL (se agrega LIMIT automáticamente).",
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
    extra_tables: list[ExtraTable] | None = Field(
        None,
        description=(
            "AVANZADO — fuentes ADICIONALES para hacer JOINs entre datasets o "
            "granularidades distintas dentro del mismo 'sql'. Cada entry se "
            "consulta a Superset por separado (respetando RLS) y se registra como "
            "una tabla con su 'name' (ej. 'data2'), junto a la tabla principal "
            "'data'. Usar SOLO cuando la pregunta cruza dos fuentes que no se "
            "pueden traer en un solo fetch — ej. ventas ('data') vs PNS ('data2') "
            "por producto, o real vs plan desde datasets distintos. El 'sql' hace: "
            "FROM data JOIN data2 ON data.producto_id = data2.producto_id. Si NO se "
            "necesita cruzar fuentes, dejar en null y usar solo 'data'."
        ),
    )


@tool(
    name="irex.query_dataset_sql",
    description=(
        "Herramienta GENÉRICA de análisis: ejecuta una consulta contra un dataset de "
        "Superset (respetando RLS, igual que irex.query_dataset) y carga el resultado "
        "en una tabla 'data' sobre la que se puede correr SQL libre (dialecto DuckDB). "
        "Usar cuando irex.query_dataset / irex.compare_periods no alcanzan porque la "
        "pregunta requiere: pivotear categorías en columnas (comparar el mismo artículo "
        "entre 3 canales lado a lado), funciones de ventana (top-N por grupo, ranking), "
        "percentiles, correlaciones, desviación estándar, error estándar/confiabilidad de "
        "una muestra, o cualquier cálculo que el LLM tendría que hacer 'mentalmente' sobre "
        "una lista de filas. "
        "NO usar para preguntas simples que ya cubre irex.query_dataset (agregación básica) "
        "o irex.compare_periods (comparación de dos períodos con % de variación) — esos "
        "son más baratos y predecibles. "
        "El SQL debe ser de solo lectura (SELECT/WITH) — no se permite crear, modificar "
        "ni acceder a archivos o red.\n\n"
        "REGLA CLAVE — modo crudo vs. agregado: en caso de duda, dejar 'metrics' vacío "
        "([]) y traer las columnas crudas necesarias en 'groupby' — es el modo más "
        "flexible porque el SQL puede calcular cualquier estadística (AVG, STDDEV, MIN, "
        "MAX, COUNT DISTINCT, percentiles) libremente. Solo usar 'metrics' pre-agregado "
        "cuando el SQL NO necesita recalcular nada sobre esa columna (ej. solo pivotear "
        "o rankear un valor que Superset ya agregó).\n\n"
        "EJEMPLO — analizar si el precio promedio de un producto es confiable según la "
        "cantidad de puntos de venta muestreados por mes (STDDEV/MIN/MAX/percentil no se "
        "pueden calcular sobre un precio ya promediado, por eso 'metrics' va vacío y "
        "'precio' se trae crudo en 'groupby'):\n"
        "{\"metrics\": [], \"groupby\": [\"mes\", \"id_cliente\", \"nombre_ubicacion\", \"precio\"], "
        "\"filters\": [{\"column\": \"articulo\", \"op\": \"==\", \"value\": \"<producto>\"}], "
        "\"sql\": \"SELECT mes, COUNT(DISTINCT id_cliente) AS puntos_venta, AVG(precio) AS "
        "promedio, STDDEV(precio) AS desv_std, MIN(precio) AS precio_min, MAX(precio) AS "
        "precio_max, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY precio) AS mediana "
        "FROM data GROUP BY mes ORDER BY mes\"}\n\n"
        "MULTI-FUENTE — para cruzar dos datasets/granularidades distintos en un "
        "mismo análisis, usar 'extra_tables': cada fuente extra se trae por "
        "separado (respetando RLS) y se registra como una tabla ('data2', etc.) "
        "junto a 'data', para hacer JOINs en el 'sql'. Ej.: comparar ventas por "
        "producto (dataset A → 'data') contra PNS por producto (dataset B → "
        "'data2') en una sola consulta.\n\n"
        "PRECISIÓN — la respuesta incluye 'source_column_types' (number/text/"
        "datetime de cada columna cargada) para elegir bien qué agregar. Si una "
        "fuente alcanza su fetch_row_limit, la respuesta trae 'result_exact'=false, "
        "'source_truncated'=true y 'source_truncated_warning': en ese caso las "
        "estadísticas se calcularon sobre un SUBCONJUNTO truncado — subir "
        "fetch_row_limit o agregar filtros antes de dar los números por exactos.\n\n"
        "REGLAS PARA SQL CORRECTO — (1) BRECHAS entre dos métricas: SIEMPRE "
        "COALESCE(a,0) - COALESCE(b,0); una resta directa 'a - b' hace desaparecer "
        "silenciosamente toda combinación presente en una sola de las métricas "
        "(delta NULL) y el ranking/total queda mal. (2) TOP-N POR GRUPO: usar "
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY grupo ORDER BY x DESC) <= N — un "
        "ORDER BY + LIMIT global NO es un top-N por grupo. (3) Para rankings de "
        "brechas entre dos métricas con totales reconciliados, preferir la tool "
        "irex.rank_partitions, que aplica estas reglas automáticamente."
    ),
)
def query_dataset_sql(request: QueryDatasetSqlRequest) -> dict[str, Any]:
    return execute_sql_analysis(
        dataset_id=request.dataset_id,
        metrics=request.metrics,
        groupby=request.groupby,
        filters=request.filters,
        fetch_row_limit=request.fetch_row_limit,
        sql=request.sql,
        result_row_limit=request.result_row_limit,
        jinja_filters=request.jinja_filters,
        extra_tables=request.extra_tables,
    )


def execute_sql_analysis(
    dataset_id: int,
    metrics: list[str],
    groupby: list[str],
    filters: list[DatasetFilter],
    fetch_row_limit: int,
    sql: str,
    result_row_limit: int,
    jinja_filters: list[JinjaFilterOverride] | None = None,
    extra_tables: "list[ExtraTable] | None" = None,
) -> dict[str, Any]:
    """Fetch a Superset (respetando RLS) + ejecuta SQL de solo lectura sobre el
    resultado vía DuckDB en memoria. Compartido por irex.query_dataset_sql y el
    modo SQL de irex.export_to_excel — mantiene una única implementación de la
    lógica de fetch/sandboxing/errores.

    Con 'extra_tables', trae fuentes adicionales (cada una respetando RLS) y las
    registra como tablas extra ('data2', etc.) junto a la principal 'data', para
    poder cruzar datasets/granularidades distintos en un mismo SQL."""
    sql_error = _validate_sql(sql)
    if sql_error:
        return {"status": "error", "error": sql_error}

    # Validar nombres de las tablas extra ANTES de cualquier fetch — evita
    # trabajo desperdiciado si el nombre choca con 'data' o no es un
    # identificador SQL válido.
    seen_names: set[str] = {"data"}
    for et in extra_tables or []:
        name_error = _validate_extra_table_name(et.name, seen_names)
        if name_error:
            return {"status": "error", "error": name_error}
        seen_names.add(et.name.lower())

    # Fuente principal ('data')
    main_rows, main_error, main_truncated = _fetch_source_rows(
        dataset_id, metrics, groupby, filters, fetch_row_limit, jinja_filters
    )
    if main_error:
        return {"status": "error", "error": main_error}
    if not main_rows:
        return {
            "status": "no_data",
            "row_count": 0,
            "message": "La consulta a Superset no devolvió filas — no hay datos para analizar con SQL.",
        }

    # Fuentes extra (JOINs entre datasets/granularidades)
    fetched_extras: list[tuple[str, int, list[dict[str, Any]], bool]] = []
    for et in extra_tables or []:
        et_rows, et_error, et_truncated = _fetch_source_rows(
            et.dataset_id, et.metrics, et.groupby, et.filters,
            et.fetch_row_limit, et.jinja_filters,
        )
        if et_error:
            return {"status": "error", "error": f"Fuente extra '{et.name}': {et_error}"}
        if not et_rows:
            return {
                "status": "error",
                "error": (
                    f"La fuente extra '{et.name}' (dataset {et.dataset_id}) no "
                    "devolvió filas — el JOIN no puede resolverse. Revisá sus "
                    "'filters' o quitala si no aplica a esta consulta."
                ),
            }
        fetched_extras.append((et.name, et.dataset_id, et_rows, et_truncated))

    try:
        import duckdb
        import pandas as pd
    except ImportError as exc:
        return {"status": "error", "error": f"Dependencia no disponible: {exc}"}

    main_df = _rows_to_numeric_df(main_rows, pd)
    main_columns, main_types = _describe_columns(main_df, pd)

    con = duckdb.connect(":memory:")
    try:
        # Sandboxing: bloquea acceso a archivos/red/extensiones desde el SQL del LLM.
        con.execute("SET enable_external_access=false")
        con.execute("SET autoinstall_known_extensions=false")
        con.execute("SET autoload_known_extensions=false")
        con.register("data", main_df)

        extra_sources: list[dict[str, Any]] = []
        for name, ds_id, rows_e, trunc_e in fetched_extras:
            df_e = _rows_to_numeric_df(rows_e, pd)
            cols_e, types_e = _describe_columns(df_e, pd)
            con.register(name, df_e)
            extra_sources.append({
                "name": name,
                "dataset_id": ds_id,
                "row_count": len(rows_e),
                "truncated": trunc_e,
                "columns": cols_e,
                "column_types": types_e,
            })

        wrapped_sql = (
            f"SELECT * FROM ({sql.strip().rstrip(';')}) AS _result "
            f"LIMIT {result_row_limit}"
        )
        try:
            result_df = con.execute(wrapped_sql).df()
        except Exception as exc:
            exc_str = str(exc)
            hint = (
                "Verificar nombres de columna (citar con comillas dobles si tienen "
                "espacios o paréntesis, ej. \"AVG(precio)\") y sintaxis DuckDB."
            )
            if "not found" in exc_str.lower() or "binder error" in exc_str.lower():
                hint = (
                    "La columna no existe en la tabla referenciada — revisar "
                    "'source_columns'/'source_column_types' (y 'extra_sources' si "
                    "se usaron tablas extra). CAUSA COMÚN: si el sql intenta "
                    "calcular STDDEV/MIN/MAX/COUNT DISTINCT sobre una columna que "
                    "en 'metrics' ya llegó agregada (ej. pediste 'AVG(precio)' pero "
                    "el sql busca 'precio' crudo), repetir con metrics=[] y esa "
                    "columna incluida en 'groupby' para traerla cruda, y agregar "
                    "dentro del sql."
                )
            error_resp: dict[str, Any] = {
                "status": "error",
                "error": f"Error ejecutando SQL: {exc_str}. {hint}",
                "source_row_count": len(main_rows),
                "source_columns": main_columns,
                "source_column_types": main_types,
            }
            if extra_sources:
                error_resp["extra_sources"] = extra_sources
            return error_resp
    finally:
        con.close()

    result_rows = _sanitize_rows(result_df.to_dict("records"))

    response: dict[str, Any] = {
        "status": "success",
        "source_row_count": len(main_rows),
        "source_columns": main_columns,
        "source_column_types": main_types,
        "source_truncated": main_truncated,
        "result_row_count": len(result_rows),
        "rows": result_rows,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if extra_sources:
        response["extra_sources"] = extra_sources

    truncated_sources = (["data"] if main_truncated else []) + [
        s["name"] for s in extra_sources if s["truncated"]
    ]
    # Contrato para el chat: 'result_exact' de primer nivel (no solo un warning
    # enterrado) — false cuando cualquier fuente quedó truncada, porque el SQL
    # corrió sobre un subconjunto. 'status' sigue siendo "success" por
    # retrocompatibilidad con llamadas existentes.
    response["result_exact"] = not truncated_sources
    if truncated_sources:
        response["incomplete_reason"] = "source_truncated"
        response["source_truncated_warning"] = (
            "Fuente(s) truncada(s) al alcanzar su fetch_row_limit: "
            + ", ".join(truncated_sources)
            + ". El SQL corrió sobre un SUBCONJUNTO de esas tablas, así que las "
            "estadísticas (STDDEV, percentiles, correlaciones, conteos, sumas) "
            "pueden NO ser exactas. Subí fetch_row_limit de esa(s) fuente(s) o "
            "agregá filtros para acotar el universo antes de dar los números por "
            "definitivos."
        )
    if len(result_rows) >= result_row_limit:
        response["warning"] = (
            f"El resultado alcanzó result_row_limit={result_row_limit} — "
            "puede haber más filas. Agregar más condiciones al SQL (WHERE/LIMIT) o "
            "subir result_row_limit si es necesario."
        )
    return response
