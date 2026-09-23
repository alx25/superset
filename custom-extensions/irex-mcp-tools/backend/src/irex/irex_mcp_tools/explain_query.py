"""Tool de solo lectura para EXPLAIN/EXPLAIN ANALYZE de una consulta SELECT.

Pensada para que el LLM pueda verificar si una optimización propuesta
realmente mejora el plan/costo antes de sugerirla como definitiva, y para
apoyar sugerencias de índices — llamando dos veces (antes/después de un
ajuste) y comparando los planes en su propio razonamiento; esta tool
deliberadamente NO arma un diff estructurado entre dos planes: los formatos
de cada motor son demasiado distintos entre sí como para normalizarlos de
forma confiable, y un LLM ya lee bien dos planes de texto/JSON puestos uno
al lado del otro.

Motores soportados: PostgreSQL y ClickHouse (los dos con uso real en esta
instalación) con soporte probado; MSSQL y Oracle con soporte best-effort
NO VALIDADO contra una instancia real (no hay ninguna disponible en este
entorno) — cualquier error ahí hay que reportarlo tal cual llega, no es
necesariamente un problema del SQL del usuario. Cualquier otro motor
responde ENGINE_NOT_SUPPORTED_ERROR en vez de arriesgar una sintaxis
adivinada.

Seguridad: a diferencia de "Ejecutar con confirmación" del asistente de
SQL Lab (que exige un click + `window.confirm()` antes de correr cualquier
SQL), esta tool puede ejecutar la consulta real de forma AUTÓNOMA cuando
`analyze=true` en PostgreSQL (EXPLAIN ANALYZE corre la consulta de verdad
para medir tiempos/filas reales) — sin que el usuario confirme nada, porque
el LLM la llama sola como parte de su razonamiento. Esto es aceptable
únicamente porque `sql` pasa por las tres capas de `_sql_safety.py`
(parser de Superset + transacción READ ONLY + rollback explícito en
PostgreSQL) — nunca puede terminar en una escritura persistida. No se relaja esta validación bajo
ninguna circunstancia — se valida DESPUÉS de renderizar Jinja (ver abajo),
nunca antes, para no dejar pasar algo que solo "parece" de lectura antes de
resolverse.

Jinja: `sql` se procesa con el mismo motor de templates que la ejecución
real de SQL Lab (`superset.jinja_context.get_template_processor`, igual que
`QueryEstimationCommand` en `superset/commands/sql_lab/estimate.py`) ANTES
de validar que sea un SELECT/WITH. Sin esto, cualquier consulta
parametrizada (`{% set %}`, `{{ from_dttm }}`, etc.) se rechazaba como "no
es una única sentencia ya resuelta" sin llegar a intentarse. Variables sin
valor no rompen el render — `DebugUndefined` las evalúa como falsy dentro
de un `{% if %}`, así que una consulta con su propio fallback
(`{% if from_dttm %}...{% else %}...{% endif %}`) cae a un valor por
defecto en vez de fallar.

Progreso (2026-09-22): la tool es `async def` con `ctx: Context` (FastMCP la
inyecta sola, no es parte del contrato público) para poder emitir
`notifications/progress` mientras el EXPLAIN corre — ver `_progress.py` para
el patrón completo (por qué, y qué pasa si el cliente cancela mientras la
consulta sigue viva). Todo el trabajo bloqueante (`_prepare_explain` y el
handler por motor) corre en threads reales, nunca directo en el event loop
compartido del servidor MCP.
"""

import json
import uuid
from typing import Any

import anyio
from fastmcp import Context
from pydantic import AliasChoices, BaseModel, Field
from superset_core.mcp.decorators import tool

from ._progress import report_phase, run_with_heartbeat
from ._sql_safety import begin_read_only, rollback_quietly, validate_read_only_query

_SUPPORTED_ENGINES = {"postgresql", "clickhouse", "clickhousedb", "mssql", "oracle"}

class ExplainQueryRequest(BaseModel):
    database_id: int = Field(..., description="ID de la base de datos (ver irex.get_query_context o el desplegable de SQL Lab).")
    sql: str = Field(
        ...,
        description=(
            "Consulta a analizar — una única sentencia SELECT o WITH de solo "
            "lectura. Cualquier otra cosa (INSERT/UPDATE/DELETE/DDL, múltiples "
            "sentencias separadas por ';') se rechaza sin ejecutar nada."
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
    analyze: bool = Field(
        False,
        description=(
            "Si true, además del plan estimado pide métricas más reales cuando el "
            "motor lo permite. En PostgreSQL ejecuta EXPLAIN ANALYZE — la consulta "
            "CORRE DE VERDAD para medir tiempos/filas reales (seguro solo porque "
            "'sql' ya está restringido a SELECT/WITH). En ClickHouse no hace falta "
            "ejecutar nada adicional: EXPLAIN ESTIMATE ya da estimaciones reales de "
            "filas/marks a leer sin correr la consulta. En MSSQL/Oracle todavía no "
            "hay un modo 'analyze' real (ver limitaciones) — se devuelve el plan "
            "estimado igual, con un aviso en 'warnings'."
        ),
    )


class ExplainQueryResponse(BaseModel):
    success: bool
    database_id: int
    engine: str | None = None
    analyze: bool = False
    executed: bool = Field(
        False,
        description=(
            "True si esta llamada corrió la consulta real contra la base (no solo "
            "generó un plan estimado). Hoy solo puede pasar con analyze=true en "
            "PostgreSQL."
        ),
    )
    plan: str | None = Field(
        None, description="Plan/estimación devuelto por el motor, como texto (JSON serializado cuando el motor da formato JSON)."
    )
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    error_type: str | None = None


def _error(request: "ExplainQueryRequest", error: str, error_type: str) -> ExplainQueryResponse:
    return ExplainQueryResponse(
        success=False,
        database_id=request.database_id,
        error=error,
        error_type=error_type,
    )


def _run_statements(database: Any, request: "ExplainQueryRequest", statements: list[str]) -> list[list[tuple]]:
    """Corre una o más sentencias sobre UNA conexión cruda nueva (se abre y
    cierra en esta misma llamada, no se reutiliza entre llamados a la tool)
    y devuelve las filas de cada una en orden. Sentencias que no producen
    result set (ej. `SET SHOWPLAN_XML ON`) devuelven lista vacía en vez de
    levantar.
    """
    from superset.utils import core as utils

    engine = database.db_engine_spec.engine
    results: list[list[tuple]] = []
    with database.get_raw_connection(
        catalog=request.catalog,
        schema=request.schema_name,
        source=utils.QuerySource.SQL_LAB,
    ) as conn:
        try:
            cursor = conn.cursor()
            # Capas 2 y 3 de `_sql_safety` (Postgres): transacción READ ONLY y
            # rollback siempre — EXPLAIN ANALYZE ejecuta la consulta de verdad.
            begin_read_only(cursor, engine)
            for statement in statements:
                cursor.execute(statement)
                try:
                    results.append(list(cursor.fetchall()))
                except Exception:  # noqa: BLE001 - p. ej. SET ... no devuelve filas
                    results.append([])
        finally:
            rollback_quietly(conn, engine)
    return results


def _explain_postgres(database: Any, request: "ExplainQueryRequest", sql: str) -> tuple[str | None, bool, list[str]]:
    if request.analyze:
        statement = f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}"
        executed = True
    else:
        statement = f"EXPLAIN (FORMAT JSON) {sql}"
        executed = False
    [rows] = _run_statements(database, request, [statement])
    raw = rows[0][0] if rows and rows[0] else None
    # El driver puede devolver el JSON ya parseado (list/dict) o como texto
    # crudo, según cómo maneje FORMAT JSON — se normaliza a texto en ambos casos.
    plan_text = raw if isinstance(raw, str) else (json.dumps(raw, default=str) if raw is not None else None)
    return plan_text, executed, []


def _explain_clickhouse(database: Any, request: "ExplainQueryRequest", sql: str) -> tuple[str | None, bool, list[str]]:
    statements = [f"EXPLAIN PLAN indexes = 1 {sql}"]
    if request.analyze:
        statements.append(f"EXPLAIN ESTIMATE {sql}")
    results = _run_statements(database, request, statements)

    sections = ["-- EXPLAIN PLAN (indexes = 1) --"]
    sections.extend(str(row[0]) for row in results[0])

    warnings: list[str] = []
    if request.analyze:
        sections.append("")
        sections.append("-- EXPLAIN ESTIMATE --")
        sections.append("database\ttable\tparts\trows\tmarks")
        sections.extend("\t".join(str(value) for value in row) for row in results[1])
        warnings.append(
            "ClickHouse: 'analyze' no ejecuta la consulta — EXPLAIN ESTIMATE ya da "
            "estimaciones reales de filas/marks a leer sin correrla."
        )
    return "\n".join(sections), False, warnings


def _explain_mssql(database: Any, request: "ExplainQueryRequest", sql: str) -> tuple[str | None, bool, list[str]]:
    # SET SHOWPLAN_XML ON hace que la sentencia siguiente NO se ejecute: el
    # driver devuelve el XML del plan en vez de correr la consulta.
    statements = ["SET SHOWPLAN_XML ON", sql, "SET SHOWPLAN_XML OFF"]
    results = _run_statements(database, request, statements)
    plan_rows = results[1]
    plan_text = "\n".join(str(row[0]) for row in plan_rows) if plan_rows else None

    warnings = [
        "MSSQL: soporte de EXPLAIN no validado contra una instancia real en este "
        "entorno — si esta respuesta falla o el XML no parece un plan, reportarlo "
        "en vez de asumir que el SQL de entrada está mal.",
    ]
    if request.analyze:
        warnings.append(
            "MSSQL: 'analyze' real (STATISTICS XML, que sí ejecuta la consulta) "
            "todavía no está implementado — se devuelve el plan estimado."
        )
    return plan_text, False, warnings


def _explain_oracle(database: Any, request: "ExplainQueryRequest", sql: str) -> tuple[str | None, bool, list[str]]:
    # EXPLAIN PLAN FOR nunca ejecuta la consulta — solo puebla PLAN_TABLE.
    plan_id = f"irex_{uuid.uuid4().hex[:12]}"
    statements = [
        f"EXPLAIN PLAN SET STATEMENT_ID = '{plan_id}' FOR {sql}",
        f"SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(statement_id => '{plan_id}'))",
    ]
    results = _run_statements(database, request, statements)
    plan_rows = results[1]
    plan_text = "\n".join(str(row[0]) for row in plan_rows) if plan_rows else None

    warnings = [
        "Oracle: soporte de EXPLAIN no validado contra una instancia real en este "
        "entorno — si esta respuesta falla o el plan viene vacío, reportarlo en "
        "vez de asumir que el SQL de entrada está mal.",
    ]
    if request.analyze:
        warnings.append(
            "Oracle: 'analyze' real (ejecutar con gather_plan_statistics + "
            "DBMS_XPLAN.DISPLAY_CURSOR) todavía no está implementado — se "
            "devuelve el plan estimado."
        )
    return plan_text, False, warnings


_ENGINE_HANDLERS = {
    "postgresql": _explain_postgres,
    "clickhouse": _explain_clickhouse,
    "clickhousedb": _explain_clickhouse,
    "mssql": _explain_mssql,
    "oracle": _explain_oracle,
}


def _prepare_explain(
    request: "ExplainQueryRequest",
) -> tuple[Any, str, Any, str] | ExplainQueryResponse:
    """Todo lo previo al handler pesado: lookup de la base, RBAC, render de
    Jinja, validación de solo-lectura y resolución del handler por motor —
    nunca toca la conexión externa lenta. Devuelve el `ExplainQueryResponse`
    de error ya armado si algo falla acá, o `(database, engine, handler,
    sql)` listo para el paso pesado. Función sync a propósito: se corre en
    un thread real desde `explain_query`, nunca directo en el event loop.
    """
    from superset import db, security_manager
    from superset.jinja_context import get_template_processor
    from superset.models.core import Database

    database = db.session.query(Database).filter_by(id=request.database_id).first()
    if not database:
        return _error(
            request,
            f"Database with ID {request.database_id} not found",
            "DATABASE_NOT_FOUND_ERROR",
        )

    if not security_manager.can_access_database(database):
        return _error(
            request,
            f"Access denied to database {database.database_name}",
            "DATABASE_SECURITY_ACCESS_ERROR",
        )

    # Mismo orden que `QueryEstimationCommand` (superset/commands/sql_lab/
    # estimate.py, el "estimar costo" nativo de SQL Lab): renderizar Jinja
    # ANTES de validar que sea un SELECT/WITH. Sin esto, cualquier consulta
    # parametrizada (`{% set %}`, `{{ from_dttm }}`, etc. — común en SQL Lab)
    # se rechazaba como "no es SELECT/WITH" sin llegar a resolverse.
    # Variables sin valor no rompen el render: `DebugUndefined` (el motor de
    # Jinja de Superset) las evalúa como falsy dentro de un `{% if %}`, así
    # que una consulta bien escrita con su propio fallback
    # (`{% if from_dttm %}...{% else %}...{% endif %}`) cae a un valor por
    # defecto en vez de fallar.
    try:
        sql = get_template_processor(database).process_template(request.sql)
    except Exception as e:  # noqa: BLE001 - error real de templating, no de conexión
        return _error(request, str(e), "JINJA_TEMPLATE_ERROR")

    engine = database.db_engine_spec.engine
    handler = _ENGINE_HANDLERS.get(engine)
    if handler is None:
        return _error(
            request,
            f"Motor '{engine}' no soportado por esta tool todavía (soportados: "
            f"{', '.join(sorted(_SUPPORTED_ENGINES))}).",
            "ENGINE_NOT_SUPPORTED_ERROR",
        )

    # Parser de Superset con el dialecto real del motor (ver `_sql_safety`),
    # no regex: detecta DML dentro de CTEs, SELECT ... INTO, FOR UPDATE.
    validation_error = validate_read_only_query(sql, engine)
    if validation_error:
        return _error(request, validation_error, "INVALID_SQL_ERROR")

    sql = sql.strip().rstrip(";").strip()
    return database, engine, handler, sql


@tool(
    name="irex.explain_query",
    description=(
        "Devuelve el plan de ejecución (EXPLAIN) de una consulta SELECT, para "
        "verificar si una optimización propuesta realmente mejora algo antes de "
        "sugerirla como definitiva, o para fundamentar una sugerencia de índice "
        "con datos reales del planner en vez de intuición (ver también "
        "irex.get_sql_schema_context para ver qué índices/claves ya existen antes "
        "de sugerir uno nuevo). Para comparar 'antes' y 'después' de un ajuste: "
        "llamar dos veces (una por versión de la consulta) y comparar los dos "
        "planes devueltos directamente — esta tool no arma un diff automático "
        "entre motores tan distintos entre sí. Si 'sql' tiene templating Jinja "
        "(ej. de una pestaña real de SQL Lab), no hace falta resolverlo a mano "
        "antes de llamar la tool: se renderiza igual que en una ejecución real "
        "de SQL Lab antes de validar que sea un SELECT/WITH.\n\n"
        "Con analyze=true en PostgreSQL, LA CONSULTA SE EJECUTA DE VERDAD (EXPLAIN "
        "ANALYZE) para medir tiempos/filas reales — sin pedir confirmación al "
        "usuario, a diferencia de 'Ejecutar con confirmación' del asistente de SQL "
        "Lab. Por eso 'sql' debe ser siempre una única sentencia SELECT/WITH de "
        "solo lectura; cualquier otra cosa se rechaza sin ejecutar nada. En "
        "ClickHouse, analyze=true no ejecuta nada adicional (EXPLAIN ESTIMATE ya "
        "es sin ejecución). Motores soportados: PostgreSQL y ClickHouse "
        "(probados); MSSQL y Oracle (best-effort, sin validar contra una "
        "instancia real — reportar cualquier error ahí). Otros motores devuelven "
        "un error explícito en vez de una sintaxis adivinada."
    ),
    tags=["irex", "sql", "rendimiento", "optimización", "explain", "índices"],
    class_permission_name="SQLLab",
    method_permission_name="execute_sql_query",
)
async def explain_query(request: ExplainQueryRequest, ctx: Context) -> ExplainQueryResponse:
    await report_phase(ctx, 0, "Validando la sentencia")
    prepared = await anyio.to_thread.run_sync(_prepare_explain, request)
    if isinstance(prepared, ExplainQueryResponse):
        return prepared
    database, engine, handler, sql = prepared

    await report_phase(ctx, 0, f"Iniciando EXPLAIN{' ANALYZE' if request.analyze else ''}")
    try:
        plan, executed, warnings = await run_with_heartbeat(
            ctx,
            lambda: handler(database, request, sql),
            heartbeat_message=lambda elapsed: f"La consulta sigue en ejecución; {elapsed}s transcurridos",
        )
    except Exception as e:  # noqa: BLE001 - se reporta como error de negocio, no se re-lanza
        return _error(request, str(e), "EXPLAIN_EXECUTION_ERROR")

    await report_phase(ctx, 1, "Leyendo y normalizando el plan")
    return ExplainQueryResponse(
        success=True,
        database_id=request.database_id,
        engine=engine,
        analyze=request.analyze,
        executed=executed,
        plan=plan,
        warnings=warnings,
    )
