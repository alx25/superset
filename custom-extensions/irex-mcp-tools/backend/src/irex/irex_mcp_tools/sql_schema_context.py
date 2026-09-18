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

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

_MAX_TABLES = 50
_MAX_COLUMNS = 300


class SqlSchemaContextRequest(BaseModel):
    database_id: int = Field(..., description="ID de la base de datos (ver irex.get_query_context o el desplegable de SQL Lab).")
    catalog: str | None = Field(
        None, description="Catálogo, solo para bases que los usan (ej. Trino). None en la mayoría de los casos."
    )
    schema_name: str = Field(..., description="Nombre del schema (ej. 'default', 'public').")
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


class SqlSchemaTableInfo(BaseModel):
    name: str
    columns: list[SqlSchemaColumn]
    comment: str | None = None


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
        "Sin 'table': lista los nombres de tabla del schema (usar 'search' "
        "para filtrar por substring si hay muchas). "
        "Con 'table': devuelve sus columnas — nombre, tipo y comentario si "
        "existe. Flujo típico: listar tablas -> confirmar/buscar el nombre "
        "correcto -> pedir columnas de esa tabla."
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
        return SqlSchemaContextResponse(
            success=True,
            database_id=request.database_id,
            catalog=request.catalog,
            schema_name=request.schema_name,
            table=SqlSchemaTableInfo(
                name=metadata.get("name", request.table),
                columns=columns,
                comment=metadata.get("comment"),
            ),
            truncated=truncated,
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
    )
