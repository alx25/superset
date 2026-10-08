"""Tool de solo lectura para exponer el esquema real (tablas/columnas).

Activada por la Fase 7 de PLAN_ASISTENTE_SQL_LAB.md: un caso real mostró
que el asistente de SQL Lab no podía corregir un nombre de columna
inventado por el usuario sin conocer el esquema real de la tabla. Usa
`superset.databases.utils.get_table_metadata`, la misma función que
alimenta el árbol de tablas/columnas nativo de SQL Lab, y
`security_manager.can_access_table`, el mismo chequeo que usa el endpoint
REST equivalente (`check_table_access` en `superset/databases/decorators.py`).
"""

from typing import Any

from pydantic import AliasChoices, BaseModel, Field
from superset_core.mcp.decorators import tool

from .sql_schema_structure import (
    SqlSchemaForeignKeys,
    SqlSchemaIndexes,
    SqlSchemaPrimaryKey,
    SqlSchemaViewInfo,
    collect_foreign_keys,
    collect_indexes,
    collect_primary_key,
    collect_view_info,
)

_MAX_TABLES = 50
_MAX_COLUMNS = 300


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
    include_structure: bool = Field(
        True,
        description=(
            "Solo aplica con 'table'. Si true (por defecto) devuelve además de las columnas la "
            "estructura: clave primaria, claves foráneas, índices (con expresiones, predicados y "
            "columnas INCLUDE) y, para una vista, su definición y de qué tablas depende. Poner "
            "false para obtener solo columnas."
        ),
    )


class SqlSchemaColumn(BaseModel):
    name: str
    type: str
    comment: str | None = None


class SqlSchemaTableInfo(BaseModel):
    name: str
    kind: str | None = Field(
        None,
        description=(
            "'table' (tabla física), 'view' (vista) o 'materialized_view'. None si no se pudo "
            "determinar. Una vista se consulta igual que una tabla, pero no se puede insertar/"
            "actualizar ni tiene datos propios: refleja otra consulta."
        ),
    )
    primary_key: SqlSchemaPrimaryKey | None = Field(
        None,
        description="Clave primaria. 'status' dice si se pudo leer; una tabla sin PK da status 'ok' y columns [].",
    )
    foreign_keys: SqlSchemaForeignKeys | None = Field(
        None, description="Claves foráneas: columnas locales, tabla/columnas referidas, ON DELETE/UPDATE."
    )
    indexes: SqlSchemaIndexes | None = Field(
        None,
        description=(
            "Índices existentes: nombre, unicidad, método, columnas CLAVE en orden (cada una con "
            "'column' o 'expression' si es un índice sobre expresión, y su orden ASC/DESC), "
            "columnas INCLUDE y 'predicate' si es parcial (WHERE)."
        ),
    )
    view: SqlSchemaViewInfo | None = Field(
        None,
        description=(
            "Solo para vistas / vistas materializadas: definición SQL y relaciones. 'depends_on' son "
            "las relaciones directas; 'base_tables' las tablas físicas finales (resolviendo vistas "
            "anidadas)."
        ),
    )
    columns: list[SqlSchemaColumn]
    comment: str | None = None


class SqlSchemaContextResponse(BaseModel):
    success: bool
    database_id: int
    catalog: str | None = None
    schema_name: str = Field(..., description="Schema consultado.")
    tables: list[str] | None = Field(
        None, description="Nombres de TABLAS FÍSICAS, cuando no se pidió una tabla específica."
    )
    views: list[str] | None = Field(
        None,
        description=(
            "Nombres de VISTAS del schema (no son tablas físicas), cuando no se pidió una tabla "
            "específica. Se consultan con SELECT igual que una tabla."
        ),
    )
    materialized_views: list[str] | None = Field(
        None, description="Nombres de vistas materializadas del schema (motores que las soportan)."
    )
    table: SqlSchemaTableInfo | None = Field(
        None, description="Columnas de la tabla pedida, cuando se especificó 'table'."
    )
    truncated: bool = Field(False, description="True si el listado de tablas o columnas se recortó por el límite.")
    error: str | None = None
    error_type: str | None = None


def _relation_names(relations: Any) -> set[str]:
    """Nombres de un resultado de `get_all_*_names_in_schema`: tuplas
    `(nombre, schema, catalog)` (tablas/vistas) u objetos `Table`
    (vistas materializadas), según el método de Superset."""
    names: set[str] = set()
    for rel in relations or ():
        names.add(rel[0] if isinstance(rel, tuple) else rel.table)
    return names


def _optional_relation_names(database: Any, method: str, catalog: str | None, schema: str) -> list[str]:
    """Vistas / vistas materializadas son mejor-esfuerzo: un motor que no las
    soporta (o falla al listarlas) no debe tumbar el listado de tablas."""
    fn = getattr(database, method, None)
    if fn is None:
        return []
    try:
        return sorted(_relation_names(fn(catalog=catalog, schema=schema)))
    except Exception:  # noqa: BLE001
        return []


def _relation_kind(database: Any, catalog: str | None, schema: str, name: str) -> str | None:
    if name in _optional_relation_names(database, "get_all_view_names_in_schema", catalog, schema):
        return "view"
    if name in _optional_relation_names(database, "get_all_materialized_view_names_in_schema", catalog, schema):
        return "materialized_view"
    try:
        tables = _relation_names(database.get_all_table_names_in_schema(catalog=catalog, schema=schema))
    except Exception:  # noqa: BLE001
        return None
    return "table" if name in tables else None


def _fill_structure(
    table_info: "SqlSchemaTableInfo",
    database: Any,
    request: "SqlSchemaContextRequest",
    table_ref: Any,
    kind: str | None,
    security_manager: Any,
) -> None:
    """PK/FK/índices/vista como metadatos estructurados. Cada sección es
    independiente: si una falla (permisos, motor sin soporte) las otras se
    devuelven igual y esa lleva su `status` explícito."""
    from superset.sql.parse import Table

    schema = request.schema_name
    name = request.table or ""

    def can_access(rel_schema: str | None, rel_name: str) -> bool:
        return security_manager.can_access_table(database, Table(rel_name, rel_schema or schema, request.catalog))

    def runner(sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        from sqlalchemy import text

        with database.get_sqla_engine(catalog=request.catalog, schema=schema) as engine:
            with engine.connect() as connection:
                return [dict(row._mapping) for row in connection.execute(text(sql), params)]

    is_view = kind in ("view", "materialized_view")
    not_applicable = "Las vistas no tienen clave primaria ni claves foráneas."
    if is_view:
        table_info.primary_key = SqlSchemaPrimaryKey(status="not_applicable", detail=not_applicable)
        table_info.foreign_keys = SqlSchemaForeignKeys(status="not_applicable", detail=not_applicable)
    else:
        table_info.primary_key = collect_primary_key(database, catalog=request.catalog, schema=schema, name=name)
        table_info.foreign_keys = collect_foreign_keys(database, table_ref, can_access)

    if kind == "view":
        table_info.indexes = SqlSchemaIndexes(
            status="not_applicable", detail="Una vista no tiene índices propios; usa los de sus tablas base."
        )
    else:
        table_info.indexes = collect_indexes(database, table_ref, schema=schema, name=name, runner=runner)

    if is_view:
        table_info.view = collect_view_info(
            database, catalog=request.catalog, schema=schema, name=name, runner=runner, can_access=can_access
        )


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


@tool(
    name="irex.get_sql_schema_context",
    description=(
        "Devuelve el esquema REAL (tablas y columnas con su tipo) de una base "
        "de datos — usar ANTES de escribir o corregir SQL a mano cuando no se "
        "tiene certeza del nombre exacto de una tabla o columna, en vez de "
        "adivinar o asumir que un nombre mencionado por el usuario existe tal "
        "cual. Solo lectura; respeta RBAC (SQLLab) y el acceso del usuario a "
        "la base y a la tabla puntual. No expone credenciales ni la URI de "
        "conexión de la base.\n\n"
        "Sin 'table': lista los nombres del schema separados por TIPO — "
        "'tables' (tablas físicas), 'views' (vistas) y 'materialized_views' — "
        "(usar 'search' para filtrar por substring si hay muchas). Una vista "
        "NO es una tabla física: se consulta con SELECT igual, pero refleja "
        "otra consulta. "
        "Con 'table' (tabla o vista): devuelve sus columnas — nombre, tipo y "
        "comentario si existe — y 'kind' ('table'/'view'/'materialized_view') y, "
        "salvo include_structure=false, la ESTRUCTURA como datos: clave primaria, "
        "claves foráneas, índices (columnas en orden, expresiones, predicados de "
        "índices parciales, INCLUDE, unicidad) y, para una vista, su definición y las "
        "tablas físicas de las que depende. Cada sección trae 'status' (ok / "
        "not_applicable / unsupported / permission_denied / error): 'no se pudo "
        "obtener' nunca equivale a 'no existe'. Usar estos metadatos para decidir "
        "joins e índices en vez de consultar pg_indexes con EXPLAIN. "
        "Flujo típico: listar -> confirmar/buscar el nombre correcto -> pedir "
        "columnas de esa tabla o vista."
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
        kind = _relation_kind(database, request.catalog, request.schema_name, request.table)
        table_info = SqlSchemaTableInfo(
            name=metadata.get("name", request.table),
            columns=columns,
            comment=metadata.get("comment"),
            kind=kind,
        )
        if request.include_structure:
            _fill_structure(table_info, database, request, table_ref, kind, security_manager)
        return SqlSchemaContextResponse(
            success=True,
            database_id=request.database_id,
            catalog=request.catalog,
            schema_name=request.schema_name,
            table=table_info,
            truncated=truncated,
        )

    try:
        all_tables = database.get_all_table_names_in_schema(
            catalog=request.catalog, schema=request.schema_name
        )
    except Exception as e:  # noqa: BLE001
        return _error(request, str(e), "SCHEMA_LOOKUP_ERROR")

    def _filtered(names: Any) -> list[str]:
        ordered = sorted(names)
        if request.search:
            needle = request.search.lower()
            ordered = [n for n in ordered if needle in n.lower()]
        return ordered

    table_names = _filtered(_relation_names(all_tables))
    view_names = _filtered(
        _optional_relation_names(database, "get_all_view_names_in_schema", request.catalog, request.schema_name)
    )
    mview_names = _filtered(
        _optional_relation_names(
            database, "get_all_materialized_view_names_in_schema", request.catalog, request.schema_name
        )
    )

    # El límite aplica POR categoría: así una vista nunca queda fuera del
    # listado solo porque haya muchas tablas.
    truncated = any(len(n) > request.limit for n in (table_names, view_names, mview_names))
    return SqlSchemaContextResponse(
        success=True,
        database_id=request.database_id,
        catalog=request.catalog,
        schema_name=request.schema_name,
        tables=table_names[: request.limit],
        views=view_names[: request.limit],
        materialized_views=mview_names[: request.limit],
        truncated=truncated,
    )
