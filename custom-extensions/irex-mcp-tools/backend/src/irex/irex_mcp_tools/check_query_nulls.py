"""Tool de solo lectura que corre una muestra acotada de una consulta SELECT
y devuelve, por columna, cuántas filas son NULL — nunca los valores en sí.

Motivada por un caso real: un LEFT JOIN puede devolver filas y "correr bien"
sin que eso signifique nada — si el JOIN no matchea, las columnas del lado
derecho quedan NULL en TODAS las filas, y ni un EXPLAIN normal ni un
EXPLAIN ANALYZE lo detectan (ven la estructura/conteo del plan, no los
valores; un LEFT JOIN sin match sigue devolviendo el mismo conteo de filas
del lado izquierdo). `irex.explain_query` verifica plan/costo/fila-count;
esta tool verifica si el CONTENIDO tiene sentido, sin exponer ese contenido.

Motores soportados: mismos que `irex.explain_query` — PostgreSQL y
ClickHouse con soporte probado; MSSQL y Oracle best-effort, sin validar
contra una instancia real en este entorno.

Seguridad — por qué esto es seguro pese a ejecutar la consulta real:
- `sql` está restringido a una única sentencia SELECT/WITH (mismo criterio
  que `explain_query`/`sql_analysis`): nunca puede terminar en una
  escritura, y se valida DESPUÉS de renderizar Jinja, nunca antes.
- La muestra está acotada (`sample_size`, tope duro) — nunca se procesa la
  consulta completa sin límite.
- El resultado NUNCA incluye valores de columna, ni siquiera para debug:
  solo nombres de columna y conteos (`null_count`/`non_null_count`/
  `null_ratio`). Los valores reales se leen en memoria del proceso del MCP
  para contar `None` y se descartan inmediatamente — no hay ningún campo
  en la respuesta capaz de transportarlos.
"""

import re
from typing import Any

from pydantic import AliasChoices, BaseModel, Field
from superset_core.mcp.decorators import tool

_SUPPORTED_ENGINES = {"postgresql", "clickhouse", "clickhousedb", "mssql", "oracle"}
_UNVALIDATED_ENGINES = {"mssql", "oracle"}

_SELECT_ONLY_RE = re.compile(r"^\s*(SELECT|WITH)\b", re.I)

_MAX_SAMPLE_SIZE = 1000
_DEFAULT_SAMPLE_SIZE = 100


def _validate_select_only(sql: str) -> str | None:
    stripped = sql.strip().rstrip(";").strip()
    if not stripped:
        return "sql no puede estar vacío."
    if ";" in stripped:
        return "sql no puede contener múltiples sentencias separadas por ';'."
    if not _SELECT_ONLY_RE.match(stripped):
        return (
            "sql debe ser una consulta de solo lectura — debe empezar con SELECT "
            "o WITH. No se permite verificar nulls de INSERT/UPDATE/DELETE/DDL."
        )
    return None


class CheckQueryNullsRequest(BaseModel):
    database_id: int = Field(..., description="ID de la base de datos (ver irex.get_query_context o el desplegable de SQL Lab).")
    sql: str = Field(
        ...,
        description=(
            "Consulta a verificar — una única sentencia SELECT o WITH de solo "
            "lectura. Se ejecuta de verdad, acotada por 'sample_size': usar esto "
            "para chequear si columnas clave (ej. las que vienen de un LEFT JOIN) "
            "tienen valores reales o quedan todas en NULL, algo que un "
            "irex.explain_query no puede detectar."
        ),
    )
    catalog: str | None = Field(
        None, description="Catálogo, solo para bases que los usan (ej. Trino). None en la mayoría de los casos."
    )
    schema_name: str = Field(
        ...,
        alias="schema",
        validation_alias=AliasChoices("schema", "schema_name"),
        serialization_alias="schema",
        description="Nombre del schema (ej. 'default', 'public') — necesario para resolver nombres de tabla sin calificar.",
    )
    sample_size: int = Field(
        _DEFAULT_SAMPLE_SIZE,
        ge=1,
        le=_MAX_SAMPLE_SIZE,
        description=f"Cuántas filas de muestra analizar (tope {_MAX_SAMPLE_SIZE}). Más muestra = diagnóstico más confiable, pero más lento.",
    )


class ColumnNullStats(BaseModel):
    name: str
    null_count: int
    non_null_count: int
    null_ratio: float = Field(..., description="null_count / tamaño de muestra real (0.0–1.0). 1.0 = todas NULL en la muestra.")


class CheckQueryNullsResponse(BaseModel):
    success: bool
    database_id: int
    engine: str | None = None
    sample_size: int = Field(0, description="Filas realmente muestreadas — puede ser menor a lo pedido si la consulta devuelve menos.")
    columns: list[ColumnNullStats] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    error_type: str | None = None


def _error(request: "CheckQueryNullsRequest", error: str, error_type: str) -> CheckQueryNullsResponse:
    return CheckQueryNullsResponse(success=False, database_id=request.database_id, error=error, error_type=error_type)


def _wrap_with_limit(sql: str, engine: str, limit: int) -> str:
    """El LIMIT/TOP/FETCH aplica siempre al wrapper `SELECT * FROM (...) AS
    irex_sample` — nunca hace falta tocar la consulta original de adentro,
    sin importar qué tenga (su propio LIMIT, ORDER BY, lo que sea)."""
    if engine == "mssql":
        return f"SELECT TOP {limit} * FROM ({sql}) AS irex_sample"
    if engine == "oracle":
        return f"SELECT * FROM ({sql}) irex_sample FETCH FIRST {limit} ROWS ONLY"
    return f"SELECT * FROM ({sql}) AS irex_sample LIMIT {limit}"


def _fetch_sample(database: Any, request: "CheckQueryNullsRequest", wrapped_sql: str) -> tuple[list[str], list[tuple]]:
    from superset.utils import core as utils

    with database.get_raw_connection(
        catalog=request.catalog, schema=request.schema_name, source=utils.QuerySource.SQL_LAB
    ) as conn:
        cursor = conn.cursor()
        cursor.execute(wrapped_sql)
        rows = list(cursor.fetchall())
        column_names = [desc[0] for desc in (cursor.description or [])]
    return column_names, rows


@tool(
    name="irex.check_query_nulls",
    description=(
        "Ejecuta una muestra acotada (LIMIT) de una consulta SELECT real y "
        "devuelve, por columna, qué porcentaje de filas es NULL — NUNCA los "
        "valores en sí. Pensada para detectar el caso donde una consulta "
        "'funciona' (corre, devuelve filas) pero el contenido no sirve — "
        "típicamente un LEFT JOIN que no matchea nada, donde las columnas del "
        "lado derecho quedan NULL en todas las filas sin que eso se note en el "
        "conteo de filas ni en irex.explain_query (que ve estructura del plan, "
        "no valores). Usar después de armar un JOIN/lookup del que no se está "
        "100% seguro, antes de presentar la propuesta como definitiva — sobre "
        "todo si involucra LEFT JOIN u OUTER JOIN. 'sql' debe ser una única "
        "sentencia SELECT/WITH de solo lectura; se procesa con el mismo "
        "templating Jinja que una ejecución real de SQL Lab antes de validar "
        "eso. Motores: PostgreSQL y ClickHouse probados; MSSQL y Oracle "
        "best-effort sin validar contra una instancia real."
    ),
    tags=["irex", "sql", "calidad de datos", "verificación", "null"],
    class_permission_name="SQLLab",
    method_permission_name="execute_sql_query",
)
def check_query_nulls(request: CheckQueryNullsRequest) -> CheckQueryNullsResponse:
    from superset import db, security_manager
    from superset.jinja_context import get_template_processor
    from superset.models.core import Database

    database = db.session.query(Database).filter_by(id=request.database_id).first()
    if not database:
        return _error(request, f"Database with ID {request.database_id} not found", "DATABASE_NOT_FOUND_ERROR")

    if not security_manager.can_access_database(database):
        return _error(request, f"Access denied to database {database.database_name}", "DATABASE_SECURITY_ACCESS_ERROR")

    try:
        rendered_sql = get_template_processor(database).process_template(request.sql)
    except Exception as e:  # noqa: BLE001
        return _error(request, str(e), "JINJA_TEMPLATE_ERROR")

    validation_error = _validate_select_only(rendered_sql)
    if validation_error:
        return _error(request, validation_error, "INVALID_SQL_ERROR")

    engine = database.db_engine_spec.engine
    if engine not in _SUPPORTED_ENGINES:
        return _error(
            request,
            f"Motor '{engine}' no soportado por esta tool todavía (soportados: "
            f"{', '.join(sorted(_SUPPORTED_ENGINES))}).",
            "ENGINE_NOT_SUPPORTED_ERROR",
        )

    sql = rendered_sql.strip().rstrip(";").strip()
    wrapped_sql = _wrap_with_limit(sql, engine, request.sample_size)
    try:
        column_names, rows = _fetch_sample(database, request, wrapped_sql)
    except Exception as e:  # noqa: BLE001 - se reporta como error de negocio, no se re-lanza
        return _error(request, str(e), "PREVIEW_EXECUTION_ERROR")

    sample_size = len(rows)
    null_counts = [0] * len(column_names)
    for row in rows:
        for index, value in enumerate(row):
            if value is None:
                null_counts[index] += 1

    columns = [
        ColumnNullStats(
            name=name,
            null_count=null_counts[index],
            non_null_count=sample_size - null_counts[index],
            null_ratio=(null_counts[index] / sample_size) if sample_size else 0.0,
        )
        for index, name in enumerate(column_names)
    ]

    warnings: list[str] = []
    if sample_size == 0:
        warnings.append(
            "La consulta no devolvió ninguna fila en la muestra — no hay nulls "
            "que contar, pero tampoco datos: si se esperaban filas, el problema "
            "es otro (ver irex.explain_query)."
        )
    if engine in _UNVALIDATED_ENGINES:
        warnings.append(
            f"{engine}: soporte no validado contra una instancia real en este "
            "entorno — si esta respuesta falla o los conteos no tienen sentido, "
            "reportarlo."
        )

    return CheckQueryNullsResponse(
        success=True,
        database_id=request.database_id,
        engine=engine,
        sample_size=sample_size,
        columns=columns,
        warnings=warnings,
    )
