"""Tool de solo lectura para exponer el esquema real (tablas/columnas).

Activada por la Fase 7 de PLAN_ASISTENTE_SQL_LAB.md: un caso real mostró
que el asistente de SQL Lab no podía corregir un nombre de columna
inventado por el usuario sin conocer el esquema real de la tabla. Usa
`superset.databases.utils.get_table_metadata`, la misma función que
alimenta el árbol de tablas/columnas nativo de SQL Lab, y
`security_manager.can_access_table`, el mismo chequeo que usa el endpoint
REST equivalente (`check_table_access` en `superset/databases/decorators.py`).
"""

from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, Field
from superset_core.mcp.decorators import tool

# pg_class.relkind -> nuestro enum público. 'p' (tabla particionada) y 'f'
# (foreign table) se comportan como tabla física a los fines de esta tool;
# cualquier relkind no listado (índice, secuencia, etc. — no debería
# aparecer nunca vía esta tool, pero por las dudas) queda sin mapear.
_PG_RELKIND_MAP: dict[str, str] = {
    "r": "table",
    "p": "table",
    "f": "table",
    "v": "view",
    "m": "materialized_view",
}

_MAX_TABLES = 50
_MAX_COLUMNS = 300

# Notas curadas por motor (clave = `db_engine_spec.engine`, el nombre
# normalizado de Superset — ver superset/db_engine_specs/*.py). A propósito
# solo cubre los motores realmente conectados en esta instalación (ClickHouse):
# no hay forma de derivar esto de Superset automáticamente, así que mantener
# una matriz especulativa para motores que no existen acá es puro costo de
# mantenimiento sin beneficio. Sumar una entrada cuando se conecte una base
# con un motor nuevo.
_SQL_DIALECT_NOTES: dict[str, list[str]] = {
    "clickhouse": [
        "Usar LIMIT, no TOP.",
        "Funciones de fecha con el dialecto propio de ClickHouse "
        "(toDate, toStartOfMonth, toYear, etc.), no ANSI SQL ni el dialecto "
        "de Postgres/MySQL.",
        "UPDATE/DELETE no son transaccionales estilo OLTP: son operaciones "
        "asíncronas (ALTER TABLE ... UPDATE/DELETE) y no se reflejan de "
        "inmediato en lecturas posteriores.",
        "WITH (CTEs) soportado; WITH RECURSIVE no está disponible.",
    ],
}
# Mismo motor real, otra clase de engine_spec según el conector configurado
# (legado sqlalchemy vs. clickhouse-connect) — ver
# superset/db_engine_specs/clickhouse.py.
_SQL_DIALECT_NOTES["clickhousedb"] = _SQL_DIALECT_NOTES["clickhouse"]


class SqlSchemaContextRequest(BaseModel):
    database_id: int = Field(..., description="ID de la base de datos (ver irex.get_query_context o el desplegable de SQL Lab).")
    catalog: str | None = Field(
        None, description="Catálogo, solo para bases que los usan (ej. Trino). None en la mayoría de los casos."
    )
    schema_name: str = Field(
        ...,
        alias="schema",
        validation_alias=AliasChoices("schema", "schema_name"),
        serialization_alias="schema",
        description="Nombre del schema (ej. 'default', 'public').",
    )
    table: str | None = Field(
        None,
        description=(
            "Si se especifica, devuelve las columnas de ESTA tabla (nombre, tipo, "
            "comentario). Si se omite, lista los nombres de tabla disponibles en "
            "el schema — usar primero sin 'table' para descubrir qué existe, "
            "luego pedir la tabla concreta."
        ),
    )
    search: str | None = Field(
        None,
        description="Filtra los nombres de tabla por substring (case-insensitive). Solo aplica cuando 'table' no se especifica.",
    )
    limit: int = Field(
        50, ge=1, le=_MAX_TABLES, description=f"Máximo de tablas a listar (tope {_MAX_TABLES})."
    )


class SqlSchemaColumn(BaseModel):
    name: str
    type: str
    comment: str | None = None


class SqlSchemaKey(BaseModel):
    type: str = Field(..., description="'pk', 'fk' o 'index'.")
    name: str | None = None
    column_names: list[str] = Field(default_factory=list)
    referred_table: str | None = Field(None, description="Solo presente cuando type='fk'.")
    referred_columns: list[str] | None = Field(None, description="Solo presente cuando type='fk'.")
    unique: bool | None = Field(None, description="Solo presente cuando type='index'.")


class SqlSchemaTableInfo(BaseModel):
    name: str
    columns: list[SqlSchemaColumn]
    comment: str | None = None
    relation_type: Literal["table", "view", "materialized_view"] | None = Field(
        None,
        description=(
            "'table', 'view' o 'materialized_view', cuando se pudo determinar. "
            "Hoy solo se completa en PostgreSQL (vía pg_class.relkind) — None en "
            "otros motores o si no se pudo determinar. Útil antes de proponer un "
            "índice: no tiene sentido sugerir uno sobre una vista."
        ),
    )
    keys: list[SqlSchemaKey] = Field(
        default_factory=list,
        description=(
            "Primary key, foreign keys e índices existentes — de la reflexión "
            "estándar de SQLAlchemy. Útil para no sugerir un índice que ya "
            "existe, o para entender por qué uno existente no se está usando "
            "en un plan de irex.explain_query. Motores sin este concepto (ej. "
            "ClickHouse no tiene FKs ni índices secundarios tradicionales) "
            "devuelven lista vacía — no es un error, ver 'table_definition'."
        ),
    )
    table_definition: str | None = Field(
        None,
        description=(
            "DDL/definición real cuando el motor lo expone de forma más útil "
            "que 'keys'. En ClickHouse: el ENGINE/ORDER BY/PARTITION BY (SHOW "
            "CREATE TABLE) — el equivalente de ClickHouse a un índice. En "
            "PostgreSQL: el SELECT real detrás de una vista o vista "
            "materializada (pg_get_viewdef) cuando relation_type es 'view' o "
            "'materialized_view' — None para tablas físicas de Postgres, ahí "
            "'keys' ya es el dato relevante. None también si no se pudo "
            "obtener (best-effort, nunca rompe el resto de la respuesta)."
        ),
    )


class SqlSchemaContextResponse(BaseModel):
    success: bool
    database_id: int
    catalog: str | None = None
    schema_name: str = Field(..., description="Schema consultado.")
    tables: list[str] | None = Field(
        None, description="Nombres de tabla, cuando no se pidió una tabla específica."
    )
    table: SqlSchemaTableInfo | None = Field(
        None, description="Columnas de la tabla pedida, cuando se especificó 'table'."
    )
    truncated: bool = Field(False, description="True si el listado de tablas o columnas se recortó por el límite.")
    engine: str | None = Field(
        None,
        description=(
            "Dialecto normalizado del motor (ej. 'clickhouse', 'postgresql', 'mysql'). "
            "Solo presente cuando success=true."
        ),
    )
    engine_version: str | None = Field(
        None, description="Versión del servidor de base de datos, si se pudo determinar. Puede ser null."
    )
    supports_jinja: bool | None = Field(
        None,
        description=(
            "Si el templating Jinja de SQL Lab está habilitado. Hoy es un flag global de "
            "Superset (ENABLE_TEMPLATE_PROCESSING), no una capacidad por motor: si es true, "
            "vale igual para cualquier base conectada."
        ),
    )
    jinja_context: list[str] | None = Field(
        None,
        description=(
            "Nombres de variables/macros Jinja disponibles en SQL Lab para este motor "
            "(ej. 'filter_values', 'current_user_id') — solo nombres, nunca sus valores "
            "resueltos. None si supports_jinja=false o no se pudo determinar. Algunas "
            "(from_dttm, to_dttm) solo aplican con contexto de dashboard/filtros, no sueltas "
            "en una consulta manual de SQL Lab."
        ),
    )
    sql_dialect_notes: list[str] | None = Field(
        None,
        description=(
            "Notas curadas del motor (quoting, LIMIT/TOP, funciones de fecha, CTEs, etc.). "
            "None si todavía no hay notas cargadas para este motor."
        ),
    )
    error: str | None = None
    error_type: str | None = None


def _error(
    request: "SqlSchemaContextRequest", error: str, error_type: str
) -> SqlSchemaContextResponse:
    return SqlSchemaContextResponse(
        success=False,
        database_id=request.database_id,
        catalog=request.catalog,
        schema_name=request.schema_name,
        error=error,
        error_type=error_type,
    )


def _engine_metadata(database: Any) -> dict[str, Any]:
    """Metadata del motor para acompañar cualquier respuesta exitosa.

    Nunca levanta: cada pieza (versión, soporte de Jinja, macros) se calcula
    por separado y cae a None/False ante cualquier falla, para que un motor
    exótico o una conexión momentáneamente inestable no rompan la consulta de
    esquema (que es el propósito principal de la tool).
    """
    from superset.extensions import feature_flag_manager
    from superset.jinja_context import get_template_processor

    engine = database.db_engine_spec.engine

    engine_version: str | None = None
    try:
        with database.get_sqla_engine() as sqla_engine:
            with sqla_engine.connect() as connection:
                version_info = connection.dialect.server_version_info
                if version_info:
                    engine_version = ".".join(str(part) for part in version_info)
    except Exception:  # noqa: BLE001 - dato "si está disponible", no crítico
        engine_version = None

    supports_jinja = feature_flag_manager.is_feature_enabled(
        "ENABLE_TEMPLATE_PROCESSING"
    )
    jinja_context: list[str] | None = None
    if supports_jinja:
        try:
            # Solo los NOMBRES de las variables/macros — nunca se invocan.
            # Varias (current_user_rls_rules, current_user_email,
            # current_user_roles, current_username, filter_values) devuelven
            # datos del usuario o de sus reglas de RLS si se ejecutan; listar
            # la key es seguro, resolverla no lo es. No cambiar esto a menos
            # que se audite cada macro nueva que Superset agregue.
            jinja_context = sorted(
                get_template_processor(database=database).get_context().keys()
            )
        except Exception:  # noqa: BLE001
            jinja_context = None

    return {
        "engine": engine,
        "engine_version": engine_version,
        "supports_jinja": supports_jinja,
        "jinja_context": jinja_context,
        "sql_dialect_notes": _SQL_DIALECT_NOTES.get(engine),
    }


def _map_key(raw: dict[str, Any]) -> SqlSchemaKey:
    """Convierte una entrada cruda de `get_table_metadata`['indexes'] (pk +
    fks + índices reales, cada una con su 'type' ya seteado por
    `superset.databases.utils`) a nuestro modelo público."""
    referred_columns = raw.get("referred_columns")
    return SqlSchemaKey(
        type=raw.get("type", "index"),
        name=raw.get("name"),
        column_names=list(raw.get("column_names") or []),
        referred_table=raw.get("referred_table"),
        referred_columns=list(referred_columns) if referred_columns else None,
        unique=raw.get("unique"),
    )


def _clickhouse_table_definition(
    database: Any, catalog: str | None, schema: str, table: str
) -> str | None:
    """`SHOW CREATE TABLE` es la única forma directa de ver el ORDER BY/
    PARTITION BY/ENGINE real de una tabla ClickHouse — la reflexión genérica
    de SQLAlchemy (get_pk_constraint/get_indexes, usada por `_map_key`) no
    tiene un equivalente de "primary key" aplicable a MergeTree: en
    ClickHouse el "índice" es el ORDER BY de la tabla, no algo separado.

    Best-effort: cualquier falla (permisos, tabla distribuida con sintaxis
    propia, motor viejo) devuelve None en vez de romper el resto de la
    respuesta — 'columns'/'keys' siguen siendo el dato principal de esta tool.
    """
    from superset.utils import core as utils

    qualified = f"`{schema}`.`{table}`" if schema else f"`{table}`"
    try:
        with database.get_raw_connection(
            catalog=catalog, schema=schema, source=utils.QuerySource.SQL_LAB
        ) as conn:
            cursor = conn.cursor()
            cursor.execute(f"SHOW CREATE TABLE {qualified}")
            rows = cursor.fetchall()
            return str(rows[0][0]) if rows and rows[0] else None
    except Exception:  # noqa: BLE001
        return None


def _postgres_relation_info(
    database: Any, catalog: str | None, schema: str, table: str
) -> tuple[str | None, str | None]:
    """(relation_type, table_definition) para una tabla/vista/vista
    materializada de PostgreSQL, vía los catálogos del sistema —
    `pg_class.relkind` para el tipo, `pg_get_viewdef` para la definición real
    de vistas/vistas materializadas (nunca de tablas físicas: no tiene
    sentido y `pg_get_viewdef` no aplica). Todo en una sola consulta,
    parametrizada (nunca interpolamos schema/table en el SQL acá).

    Best-effort y de solo lectura: nunca ejecuta DDL, nunca expone
    credenciales (no toca sqlalchemy_uri/encrypted_extra), y cualquier falla
    (permisos, catálogo no accesible) devuelve (None, None) sin romper el
    resto de la respuesta — 'columns'/'keys' siguen siendo el dato principal.
    """
    from superset.utils import core as utils

    try:
        with database.get_raw_connection(
            catalog=catalog, schema=schema, source=utils.QuerySource.SQL_LAB
        ) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT c.relkind, "
                "CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid) END "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = %s AND c.relname = %s",
                (schema, table),
            )
            row = cursor.fetchone()
            if not row:
                return None, None
            relkind, viewdef = row[0], row[1]
            relation_type = _PG_RELKIND_MAP.get(relkind)
            table_definition = str(viewdef) if viewdef is not None else None
            return relation_type, table_definition
    except Exception:  # noqa: BLE001
        return None, None


@tool(
    name="irex.get_sql_schema_context",
    description=(
        "Devuelve el esquema REAL (tablas y columnas con su tipo) de una base "
        "de datos, además de metadata del motor (dialecto, versión, soporte "
        "y macros de Jinja, notas del dialecto) — usar ANTES de escribir o "
        "corregir SQL a mano cuando no se tiene certeza del nombre exacto de "
        "una tabla/columna o de una particularidad del motor (LIMIT vs TOP, "
        "funciones de fecha, CTEs, etc.), en vez de adivinar o asumir que un "
        "nombre o sintaxis mencionados por el usuario son válidos tal cual. "
        "Solo lectura; respeta RBAC (SQLLab) y el acceso del usuario a "
        "la base y a la tabla puntual. No expone credenciales ni la URI de "
        "conexión de la base.\n\n"
        "Sin 'table': lista los nombres de tabla del schema (usar 'search' "
        "para filtrar por substring si hay muchas). "
        "Con 'table': devuelve sus columnas (nombre, tipo, comentario), sus "
        "claves/índices existentes ('keys': pk/fk/index — para no sugerir un "
        "índice duplicado o para explicar por qué uno no se usa), si es tabla "
        "física/vista/vista materializada cuando se puede determinar "
        "('relation_type', hoy solo en PostgreSQL — no tiene sentido sugerir "
        "un índice sobre una vista) y la definición real cuando aplica "
        "('table_definition': en ClickHouse el DDL de ENGINE/ORDER BY/"
        "PARTITION BY; en PostgreSQL el SELECT real detrás de una vista o "
        "vista materializada). Flujo típico: listar tablas -> confirmar/"
        "buscar el nombre correcto -> pedir columnas+claves de esa tabla -> "
        "usar irex.explain_query para verificar si una optimización o índice "
        "sugerido de verdad ayuda."
    ),
    tags=["irex", "negocio", "esquema", "sql", "consulta"],
    class_permission_name="SQLLab",
    method_permission_name="execute_sql_query",
)
def get_sql_schema_context(request: SqlSchemaContextRequest) -> SqlSchemaContextResponse:
    from superset import db, security_manager
    from superset.databases.utils import get_table_metadata
    from superset.models.core import Database
    from superset.sql.parse import Table

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

    if request.table:
        table_ref = Table(request.table, request.schema_name, request.catalog)
        if not security_manager.can_access_table(database, table_ref):
            return _error(
                request,
                f"Access denied to table {request.table}",
                "TABLE_SECURITY_ACCESS_ERROR",
            )
        try:
            metadata: dict[str, Any] = get_table_metadata(database, table_ref)
        except Exception as e:  # noqa: BLE001 - se reporta como error de negocio, no se re-lanza
            return _error(request, str(e), "SCHEMA_LOOKUP_ERROR")

        raw_columns = metadata.get("columns") or []
        truncated = len(raw_columns) > _MAX_COLUMNS
        columns = [
            SqlSchemaColumn(
                name=col["name"],
                type=col.get("type") or "unknown",
                comment=col.get("comment"),
            )
            for col in raw_columns[:_MAX_COLUMNS]
        ]
        keys = [_map_key(k) for k in (metadata.get("indexes") or [])]

        engine = database.db_engine_spec.engine
        relation_type: str | None = None
        table_definition: str | None = None
        if engine in ("clickhouse", "clickhousedb"):
            table_definition = _clickhouse_table_definition(
                database, request.catalog, request.schema_name, request.table
            )
        elif engine == "postgresql":
            relation_type, table_definition = _postgres_relation_info(
                database, request.catalog, request.schema_name, request.table
            )

        return SqlSchemaContextResponse(
            success=True,
            database_id=request.database_id,
            catalog=request.catalog,
            schema_name=request.schema_name,
            table=SqlSchemaTableInfo(
                name=metadata.get("name", request.table),
                columns=columns,
                comment=metadata.get("comment"),
                relation_type=relation_type,
                keys=keys,
                table_definition=table_definition,
            ),
            truncated=truncated,
            **_engine_metadata(database),
        )

    try:
        all_tables = database.get_all_table_names_in_schema(
            catalog=request.catalog, schema=request.schema_name
        )
    except Exception as e:  # noqa: BLE001
        return _error(request, str(e), "SCHEMA_LOOKUP_ERROR")

    names = sorted({t[0] for t in all_tables})
    if request.search:
        needle = request.search.lower()
        names = [n for n in names if needle in n.lower()]

    truncated = len(names) > request.limit
    return SqlSchemaContextResponse(
        success=True,
        database_id=request.database_id,
        catalog=request.catalog,
        schema_name=request.schema_name,
        tables=names[: request.limit],
        truncated=truncated,
        **_engine_metadata(database),
    )
