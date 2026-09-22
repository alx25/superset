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

# Tope por defecto de 'table_names' (modo batch) — configurable vía
# MCP_SQL_SCHEMA_BATCH_MAX en superset_config.py. Es un límite por LLAMADA,
# no por conversación ni por consulta: una consulta con más tablas se cubre
# con varias llamadas batch, no subiendo este número sin límite.
_DEFAULT_MAX_BATCH_TABLES = 12

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
            "luego pedir la tabla concreta. MUTUAMENTE EXCLUYENTE con 'table_names' "
            "— usar uno u otro, nunca ambos."
        ),
    )
    table_names: list[str] | None = Field(
        None,
        description=(
            "Modo batch: esquema de VARIAS tablas en una sola llamada (columnas, "
            "claves/índices, DDL cuando aplique) — usar para una consulta con "
            "varios JOIN/tablas en vez de llamar la tool una vez por tabla. Los "
            "CTE de la consulta NO son tablas físicas y no deben incluirse acá, "
            "solo las fuentes reales de FROM/JOIN. MUTUAMENTE EXCLUYENTE con "
            "'table' — usar uno u otro, nunca ambos. Lista no vacía, se "
            f"deduplica preservando el orden de aparición. Tope por llamada "
            f"configurable (default {_DEFAULT_MAX_BATCH_TABLES}) — es un límite "
            "por request, no por conversación ni por consulta: para una consulta "
            "con más tablas que el tope, enviar varias llamadas batch en vez de "
            "una sola con todo."
        ),
    )
    search: str | None = Field(
        None,
        description="Filtra los nombres de tabla por substring (case-insensitive). Solo aplica cuando ni 'table' ni 'table_names' se especifican.",
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


class SqlSchemaTableContext(BaseModel):
    """Un elemento de 'table_contexts' (modo batch) — mismo contenido por
    tabla que 'table' en modo individual, más success/error/error_type para
    que una tabla inexistente o sin permiso no tumbe el resto del batch."""

    name: str
    success: bool = True
    columns: list[SqlSchemaColumn] = Field(default_factory=list)
    comment: str | None = None
    relation_type: Literal["table", "view", "materialized_view"] | None = Field(
        None,
        description="Ver 'relation_type' en modo individual — hoy solo se completa en PostgreSQL.",
    )
    keys: list[SqlSchemaKey] = Field(
        default_factory=list,
        description="Ver 'keys' en modo individual.",
    )
    table_definition: str | None = Field(
        None,
        description="Ver 'table_definition' en modo individual.",
    )
    truncated: bool = Field(
        False, description="True si las columnas de ESTA tabla se recortaron por el límite."
    )
    warnings: list[str] = Field(default_factory=list)
    error: str | None = Field(
        None, description="Solo presente si success=false para esta tabla — el resto del batch no se ve afectado."
    )
    error_type: str | None = None


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
    table_contexts: list[SqlSchemaTableContext] | None = Field(
        None,
        description=(
            "Presente solo cuando se pidió 'table_names' (modo batch) — un "
            "elemento por tabla pedida, en el mismo orden (ya deduplicado). "
            "Ninguno de los elementos incluye filas ni valores de negocio, "
            "solo metadata de esquema."
        ),
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


def _max_batch_size() -> int:
    """Tope de 'table_names' por llamada — configurable vía
    MCP_SQL_SCHEMA_BATCH_MAX (superset_config.py), default
    _DEFAULT_MAX_BATCH_TABLES. Fuera de un contexto de aplicación Flask
    (tests unitarios sin app_context) cae al default en vez de romper."""
    try:
        from flask import current_app

        return int(
            current_app.config.get("MCP_SQL_SCHEMA_BATCH_MAX", _DEFAULT_MAX_BATCH_TABLES)
        )
    except Exception:  # noqa: BLE001
        return _DEFAULT_MAX_BATCH_TABLES


def _clickhouse_table_definitions_batch(
    database: Any, catalog: str | None, schema: str, tables: list[str]
) -> dict[str, str | None]:
    """Batching real para ClickHouse: una sola consulta a system.tables
    (columna create_table_query, mismo contenido que `SHOW CREATE TABLE`) para
    TODAS las tablas del batch en vez de una ejecución por tabla — ver
    `_clickhouse_table_definition` para el equivalente de una sola tabla
    (modo individual), que sigue usándose tal cual ahí.

    Los nombres de tabla se pasan como literales de texto en un IN (...): acá
    son VALORES, no identificadores como en `_clickhouse_table_definition`,
    así que sí corresponde escapar comillas simples (no hay soporte de
    bind params confirmado en el cursor crudo de este driver para listas).

    Best-effort: cualquier falla global (permisos, tabla distribuida con
    catálogo propio, motor viejo sin esta system table) devuelve {} — cada
    tabla del batch simplemente queda sin table_definition, igual que el
    modo individual ante una falla puntual. 'columns'/'keys' (obtenidas por
    separado, siempre por tabla) siguen siendo el dato principal.

    El llamador (`_build_batch_response`) solo pasa acá tablas ya validadas
    por `can_access_table` — una tabla sin permiso nunca debe disparar
    siquiera esta consulta best-effort, aunque su resultado se descartaría.
    """
    from superset.utils import core as utils

    if not tables:
        return {}

    def _escape(value: str) -> str:
        return value.replace("'", "''")

    names_in = ", ".join(f"'{_escape(t)}'" for t in tables)
    try:
        with database.get_raw_connection(
            catalog=catalog, schema=schema, source=utils.QuerySource.SQL_LAB
        ) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT name, create_table_query FROM system.tables "
                f"WHERE database = '{_escape(schema)}' AND name IN ({names_in})"
            )
            rows = cursor.fetchall()
            return {str(row[0]): (str(row[1]) if row[1] else None) for row in rows}
    except Exception:  # noqa: BLE001
        return {}


def _postgres_relation_info_batch(
    database: Any, catalog: str | None, schema: str, tables: list[str]
) -> dict[str, tuple[str | None, str | None]]:
    """Batching real para PostgreSQL: misma consulta que
    `_postgres_relation_info` (modo individual, que sigue usándose tal cual
    ahí) pero para TODAS las tablas del batch a la vez —
    `relname = ANY(%s)` parametrizado, una sola consulta en vez de N.

    Best-effort: cualquier falla global devuelve {} — cada tabla del batch
    simplemente queda sin relation_type/table_definition.

    El llamador (`_build_batch_response`) solo pasa acá tablas ya validadas
    por `can_access_table` — una tabla sin permiso nunca debe disparar
    siquiera esta consulta best-effort, aunque su resultado se descartaría.
    """
    from superset.utils import core as utils

    if not tables:
        return {}
    try:
        with database.get_raw_connection(
            catalog=catalog, schema=schema, source=utils.QuerySource.SQL_LAB
        ) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT c.relname, c.relkind, "
                "CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid) END "
                "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = %s AND c.relname = ANY(%s)",
                (schema, tables),
            )
            rows = cursor.fetchall()
            result: dict[str, tuple[str | None, str | None]] = {}
            for relname, relkind, viewdef in rows:
                relation_type = _PG_RELKIND_MAP.get(relkind)
                table_definition = str(viewdef) if viewdef is not None else None
                result[str(relname)] = (relation_type, table_definition)
            return result
    except Exception:  # noqa: BLE001
        return {}


def _build_batch_response(
    database: Any, request: "SqlSchemaContextRequest", table_names: list[str]
) -> SqlSchemaContextResponse:
    """Arma 'table_contexts' — un elemento por tabla de 'table_names', en el
    mismo orden, reutilizando exactamente las mismas validaciones de permiso
    (`can_access_table`) y la misma fuente de columnas/claves
    (`get_table_metadata`) que el camino individual. Una tabla inexistente o
    sin permiso se marca success=false y NO aborta el resto del batch —
    'get_table_metadata' no tiene equivalente batched en Superset, así que
    ese dato se aisla por tabla; el DDL/relation_type sí se pide una única
    vez para todo el batch cuando el motor lo permite (ClickHouse/PostgreSQL),
    pero SOLO para las tablas que ya pasaron 'can_access_table' — una tabla
    sin permiso no debe disparar ninguna consulta adicional contra la base,
    ni siquiera una cuyo resultado se termine descartando (mismo criterio que
    el camino individual, donde 'can_access_table' corta antes de cualquier
    otra consulta)."""
    from superset import security_manager
    from superset.databases.utils import get_table_metadata
    from superset.sql.parse import Table

    engine = database.db_engine_spec.engine

    table_refs = {name: Table(name, request.schema_name, request.catalog) for name in table_names}
    denied = {
        name for name, ref in table_refs.items() if not security_manager.can_access_table(database, ref)
    }
    allowed = [name for name in table_names if name not in denied]

    ddl_by_table: dict[str, str | None] = {}
    relation_by_table: dict[str, tuple[str | None, str | None]] = {}
    if allowed:
        if engine in ("clickhouse", "clickhousedb"):
            ddl_by_table = _clickhouse_table_definitions_batch(
                database, request.catalog, request.schema_name, allowed
            )
        elif engine == "postgresql":
            relation_by_table = _postgres_relation_info_batch(
                database, request.catalog, request.schema_name, allowed
            )

    contexts: list[SqlSchemaTableContext] = []
    for name in table_names:
        if name in denied:
            contexts.append(
                SqlSchemaTableContext(
                    name=name,
                    success=False,
                    error=f"Access denied to table {name}",
                    error_type="TABLE_SECURITY_ACCESS_ERROR",
                )
            )
            continue

        try:
            metadata: dict[str, Any] = get_table_metadata(database, table_refs[name])
        except Exception as e:  # noqa: BLE001 - se aisla, no rompe el resto del batch
            contexts.append(
                SqlSchemaTableContext(
                    name=name,
                    success=False,
                    error=str(e),
                    error_type="SCHEMA_LOOKUP_ERROR",
                )
            )
            continue

        raw_columns = metadata.get("columns") or []
        truncated = len(raw_columns) > _MAX_COLUMNS
        columns = [
            SqlSchemaColumn(
                name=col["name"], type=col.get("type") or "unknown", comment=col.get("comment")
            )
            for col in raw_columns[:_MAX_COLUMNS]
        ]
        keys = [_map_key(k) for k in (metadata.get("indexes") or [])]

        relation_type: str | None = None
        table_definition: str | None = None
        if name in ddl_by_table:
            table_definition = ddl_by_table[name]
        elif name in relation_by_table:
            relation_type, table_definition = relation_by_table[name]

        warnings: list[str] = []
        if truncated:
            warnings.append(f"Se truncó a {_MAX_COLUMNS} columnas (la tabla tiene más).")

        contexts.append(
            SqlSchemaTableContext(
                name=metadata.get("name", name),
                success=True,
                columns=columns,
                comment=metadata.get("comment"),
                relation_type=relation_type,
                keys=keys,
                table_definition=table_definition,
                truncated=truncated,
                warnings=warnings,
            )
        )

    return SqlSchemaContextResponse(
        success=True,
        database_id=request.database_id,
        catalog=request.catalog,
        schema_name=request.schema_name,
        table_contexts=contexts,
        **_engine_metadata(database),
    )


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
        "sugerido de verdad ayuda.\n\n"
        "Con 'table_names' (lista, en vez de 'table'): mismo contenido por "
        "tabla, para varias tablas en una sola llamada — usar para una "
        "consulta con varios JOIN en vez de llamar la tool una vez por tabla. "
        "Los CTE de la consulta NO son tablas físicas: solo van las fuentes "
        "reales de FROM/JOIN. La respuesta trae 'table_contexts' (uno por "
        "tabla pedida, mismo orden, deduplicado) en vez de 'table' — cada "
        "elemento puede fallar solo, sin tumbar el resto ('success'/'error' "
        "por tabla). 'table' y 'table_names' son mutuamente excluyentes."
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

    # Validación de forma del request — no necesita la base de datos, así que
    # se resuelve antes de cualquier consulta (falla rápido con input inválido).
    if request.table and request.table_names:
        return _error(
            request,
            "'table' y 'table_names' son mutuamente excluyentes — usar uno u otro, nunca ambos.",
            "INVALID_REQUEST_ERROR",
        )

    deduped_table_names: list[str] | None = None
    if request.table_names is not None:
        if len(request.table_names) == 0:
            return _error(
                request,
                "'table_names' no puede ser una lista vacía.",
                "INVALID_REQUEST_ERROR",
            )
        deduped_table_names = list(dict.fromkeys(request.table_names))
        max_batch = _max_batch_size()
        if len(deduped_table_names) > max_batch:
            return _error(
                request,
                f"'table_names' admite un máximo de {max_batch} tablas por llamada "
                f"(se pidieron {len(deduped_table_names)} tablas distintas) — dividir "
                "en varias llamadas batch para una consulta con más tablas.",
                "INVALID_REQUEST_ERROR",
            )

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

    if deduped_table_names is not None:
        return _build_batch_response(database, request, deduped_table_names)

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
