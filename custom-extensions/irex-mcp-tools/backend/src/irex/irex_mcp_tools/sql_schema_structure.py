"""Metadatos estructurales para `irex.get_sql_schema_context`: PK, FK,
índices y definición/dependencias de vistas.

Pedido del usuario (2026-10-08): el asistente de SQL Lab necesita conocer
claves, índices (con expresiones y predicados) y de qué tablas físicas
depende una vista, SIN tener que ejecutar consultas a `pg_indexes` con
EXPLAIN ANALYZE (que devuelve el plan, no los valores). Todo sale de los
catálogos del motor y se devuelve como datos estructurados.

Cada sección trae un `status` explícito (`ok`, `not_applicable`,
`unsupported`, `permission_denied`, `error`) y un `detail` — "no pude
obtenerlo" nunca se confunde con "no existe": una tabla sin PK devuelve
`status="ok"` con `columns=[]`.

Reflexión de SQLAlchemy 1.4 en PostgreSQL pierde las columnas-expresión de
un índice y su `INCLUDE`/predicado según el caso, así que para PostgreSQL
se consulta `pg_catalog` directamente (consulta fija, solo lectura, con
parámetros enlazados — nada del usuario se concatena en el SQL). Para otros
motores se usa el inspector genérico de SQLAlchemy/Superset.
"""

from __future__ import annotations

from typing import Any, Callable

from pydantic import BaseModel

MAX_ITEMS = 200
MAX_VIEW_DEFINITION_CHARS = 20_000

CatalogRunner = Callable[[str, dict[str, Any]], list[dict[str, Any]]]
AccessCheck = Callable[[str | None, str], bool]

_KIND_BY_RELKIND = {
    "r": "table",
    "p": "table",
    "f": "table",
    "v": "view",
    "m": "materialized_view",
}


class _Section(BaseModel):
    status: str
    detail: str | None = None
    source: str | None = None


class SqlSchemaPrimaryKey(_Section):
    name: str | None = None
    columns: list[str] = []


class SqlSchemaForeignKey(BaseModel):
    name: str | None = None
    columns: list[str]
    referred_schema: str | None = None
    referred_table: str
    referred_columns: list[str]
    on_delete: str | None = None
    on_update: str | None = None
    referred_accessible: bool | None = None


class SqlSchemaForeignKeys(_Section):
    items: list[SqlSchemaForeignKey] = []


class SqlSchemaIndexKey(BaseModel):
    position: int
    column: str | None = None
    expression: str | None = None
    descending: bool = False
    nulls_first: bool = False


class SqlSchemaIndex(BaseModel):
    name: str
    unique: bool = False
    primary: bool = False
    method: str | None = None
    key_columns: list[SqlSchemaIndexKey]
    include_columns: list[str] = []
    predicate: str | None = None
    constraint: str | None = None
    constraint_type: str | None = None
    valid: bool | None = None


class SqlSchemaIndexes(_Section):
    items: list[SqlSchemaIndex] = []


class SqlSchemaRelation(BaseModel):
    schema_name: str | None = None
    name: str
    kind: str | None = None
    depth: int = 1
    accessible: bool | None = None


class SqlSchemaViewInfo(_Section):
    definition: str | None = None
    definition_truncated: bool = False
    depends_on: list[SqlSchemaRelation] = []
    base_tables: list[SqlSchemaRelation] = []
    dependencies_status: str | None = None
    dependencies_detail: str | None = None
    dependencies_source: str | None = None


def classify_error(exc: BaseException) -> tuple[str, str]:
    """(status, detail) para una excepción al leer metadatos. Solo la primera
    línea del mensaje, acotada: nunca el traceback ni parámetros del driver."""
    if isinstance(exc, NotImplementedError):
        return "unsupported", "El motor no implementa esta consulta de metadatos."
    raw = str(getattr(exc, "orig", None) or exc).strip()
    first = raw.splitlines()[0][:200] if raw else type(exc).__name__
    lowered = raw.lower()
    if (
        "permission denied" in lowered
        or "insufficient privilege" in lowered
        or "must be owner" in lowered
        or "access denied" in lowered
        or "insufficientprivilege" in type(getattr(exc, "orig", exc)).__name__.lower()
    ):
        return "permission_denied", first
    return "error", first


def _relation_accessible(check: AccessCheck | None, schema: str | None, name: str) -> bool | None:
    if check is None:
        return None
    try:
        return bool(check(schema, name))
    except Exception:  # noqa: BLE001 - mejor-esfuerzo: desconocido, no error
        return None


# ---------------------------------------------------------------- PK / FK


def collect_primary_key(
    database: Any, *, catalog: str | None, schema: str | None, name: str
) -> SqlSchemaPrimaryKey:
    # Directo del inspector: `Database.get_pk_constraint` de Superset pasa cada
    # valor por `json.base_json_conv`, que lanza TypeError con listas/strings
    # y devuelve None — resultado real en producción: `{name: None,
    # constrained_columns: None}` aunque la PK exista.
    try:
        with database.get_inspector(catalog=catalog, schema=schema) as inspector:
            pk = inspector.get_pk_constraint(name, schema) or {}
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        return SqlSchemaPrimaryKey(status=status, detail=detail, source="sqlalchemy_inspector")
    return SqlSchemaPrimaryKey(
        status="ok",
        source="sqlalchemy_inspector",
        name=pk.get("name"),
        columns=list(pk.get("constrained_columns") or []),
    )


def collect_foreign_keys(
    database: Any, table_ref: Any, can_access: AccessCheck | None
) -> SqlSchemaForeignKeys:
    try:
        raw = database.get_foreign_keys(table_ref) or []
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        return SqlSchemaForeignKeys(status=status, detail=detail, source="sqlalchemy_inspector")
    items = []
    for fk in raw[:MAX_ITEMS]:
        options = fk.get("options") or {}
        items.append(
            SqlSchemaForeignKey(
                name=fk.get("name"),
                columns=list(fk.get("constrained_columns") or []),
                referred_schema=fk.get("referred_schema"),
                referred_table=fk["referred_table"],
                referred_columns=list(fk.get("referred_columns") or []),
                on_delete=options.get("ondelete"),
                on_update=options.get("onupdate"),
                referred_accessible=_relation_accessible(
                    can_access, fk.get("referred_schema"), fk["referred_table"]
                ),
            )
        )
    detail = f"Se devolvieron {MAX_ITEMS} de {len(raw)} claves foráneas." if len(raw) > MAX_ITEMS else None
    return SqlSchemaForeignKeys(status="ok", source="sqlalchemy_inspector", items=items, detail=detail)


# ---------------------------------------------------------------- índices

_PG_INDEXES_SQL = """
SELECT i.relname AS index_name,
       x.indisunique AS is_unique,
       x.indisprimary AS is_primary,
       x.indisvalid AS is_valid,
       am.amname AS method,
       pg_get_expr(x.indpred, x.indrelid) AS predicate,
       k.n AS position,
       (k.n <= x.indnkeyatts) AS is_key,
       x.indkey[k.n - 1] AS attnum,
       a.attname AS column_name,
       pg_get_indexdef(x.indexrelid, k.n, true) AS definition,
       CASE WHEN k.n <= x.indnkeyatts THEN (x.indoption[k.n - 1] & 1) = 1 ELSE false END AS is_desc,
       CASE WHEN k.n <= x.indnkeyatts THEN (x.indoption[k.n - 1] & 2) = 2 ELSE false END AS nulls_first,
       con.conname AS constraint_name,
       con.contype AS constraint_type
FROM pg_index x
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_am am ON am.oid = i.relam
JOIN LATERAL generate_series(1, x.indnatts) AS k(n) ON true
LEFT JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[k.n - 1] AND x.indkey[k.n - 1] <> 0
LEFT JOIN pg_constraint con ON con.conindid = x.indexrelid AND con.conrelid = x.indrelid
WHERE n.nspname = :schema AND t.relname = :table
ORDER BY i.relname, k.n
"""


def _is_postgres(database: Any) -> bool:
    return str(getattr(database, "backend", "")).lower() in {"postgresql", "postgres"}


def _indexes_from_postgres(rows: list[dict[str, Any]]) -> list[SqlSchemaIndex]:
    by_name: dict[str, SqlSchemaIndex] = {}
    for row in rows:
        index = by_name.get(row["index_name"])
        if index is None:
            index = SqlSchemaIndex(
                name=row["index_name"],
                unique=bool(row["is_unique"]),
                primary=bool(row["is_primary"]),
                method=row.get("method"),
                key_columns=[],
                predicate=row.get("predicate"),
                constraint=row.get("constraint_name"),
                constraint_type=row.get("constraint_type"),
                valid=row.get("is_valid"),
            )
            by_name[row["index_name"]] = index
        is_expression = not row.get("attnum")
        if row["is_key"]:
            index.key_columns.append(
                SqlSchemaIndexKey(
                    position=int(row["position"]),
                    column=None if is_expression else row.get("column_name"),
                    expression=row.get("definition") if is_expression else None,
                    descending=bool(row.get("is_desc")),
                    nulls_first=bool(row.get("nulls_first")),
                )
            )
        else:
            # Columna de `INCLUDE`: una expresión no puede ir ahí en PostgreSQL.
            index.include_columns.append(row.get("column_name") or row.get("definition") or "?")
    return list(by_name.values())


def _indexes_from_inspector(raw: list[dict[str, Any]]) -> list[SqlSchemaIndex]:
    result = []
    for ix in raw:
        dialect_options = ix.get("dialect_options") or {}
        expressions = list(ix.get("expressions") or [])
        keys = []
        for position, column in enumerate(ix.get("column_names") or [], start=1):
            expression = None
            if column is None and position - 1 < len(expressions):
                expression = expressions[position - 1]
            keys.append(SqlSchemaIndexKey(position=position, column=column, expression=expression))
        result.append(
            SqlSchemaIndex(
                name=ix.get("name") or "(sin nombre)",
                unique=bool(ix.get("unique")),
                key_columns=keys,
                include_columns=list(ix.get("include_columns") or dialect_options.get("postgresql_include") or []),
                predicate=dialect_options.get("postgresql_where"),
                constraint=ix.get("duplicates_constraint"),
            )
        )
    return result


def collect_indexes(
    database: Any, table_ref: Any, *, schema: str | None, name: str, runner: CatalogRunner | None
) -> SqlSchemaIndexes:
    source = "inspector"
    try:
        if _is_postgres(database) and runner is not None:
            source = "pg_catalog"
            rows = runner(_PG_INDEXES_SQL, {"schema": schema, "table": name})
            items = _indexes_from_postgres(rows)
        else:
            source = "sqlalchemy_inspector"
            items = _indexes_from_inspector(database.get_indexes(table_ref) or [])
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        return SqlSchemaIndexes(status=status, detail=detail, source=source)
    detail = None
    if source == "sqlalchemy_inspector" and not _is_postgres(database):
        detail = "Expresiones y predicados solo se informan si el motor los expone al inspector genérico."
    if len(items) > MAX_ITEMS:
        detail = f"Se devolvieron {MAX_ITEMS} de {len(items)} índices."
    return SqlSchemaIndexes(status="ok", source=source, items=items[:MAX_ITEMS], detail=detail)


# ---------------------------------------------------------------- vistas

_PG_VIEW_DEFINITION_SQL = """
SELECT pg_get_viewdef(c.oid, true) AS definition
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = :schema AND c.relname = :table AND c.relkind IN ('v', 'm')
"""

_PG_VIEW_DEPENDENCIES_SQL = """
WITH RECURSIVE tree AS (
    SELECT c.oid AS oid, c.relkind AS relkind, 0 AS depth
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = :schema AND c.relname = :table
  UNION
    SELECT dc.oid, dc.relkind, t.depth + 1
    FROM tree t
    JOIN pg_rewrite r ON r.ev_class = t.oid
    JOIN pg_depend d ON d.objid = r.oid
         AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
    JOIN pg_class dc ON dc.oid = d.refobjid AND dc.oid <> t.oid
    WHERE t.relkind IN ('v', 'm') AND t.depth < 10
)
SELECT n.nspname AS schema_name, c.relname AS name, c.relkind AS relkind, min(t.depth) AS depth
FROM tree t
JOIN pg_class c ON c.oid = t.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE t.depth > 0 AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
GROUP BY n.nspname, c.relname, c.relkind
ORDER BY min(t.depth), n.nspname, c.relname
"""


def _parsed_dependencies(definition: str, dialect_name: str | None) -> list[SqlSchemaRelation]:
    """Tablas referenciadas por la definición (mejor-esfuerzo, sin catálogo).
    Excluye CTEs definidas en la propia vista."""
    import sqlglot
    from sqlglot import exp

    tree = sqlglot.parse_one(definition, read=dialect_name)
    cte_names = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    seen: dict[tuple[str | None, str], SqlSchemaRelation] = {}
    for table in tree.find_all(exp.Table):
        if not table.name:
            continue
        schema_name = table.db or None
        if schema_name is None and table.name.lower() in cte_names:
            continue
        key = (schema_name, table.name)
        seen.setdefault(key, SqlSchemaRelation(schema_name=schema_name, name=table.name, depth=1))
    return list(seen.values())


def collect_view_info(
    database: Any,
    *,
    catalog: str | None,
    schema: str | None,
    name: str,
    runner: CatalogRunner | None,
    can_access: AccessCheck | None,
) -> SqlSchemaViewInfo:
    definition: str | None = None
    source = "sqlalchemy_inspector"
    info = SqlSchemaViewInfo(status="ok")
    try:
        if _is_postgres(database) and runner is not None:
            source = "pg_catalog"
            rows = runner(_PG_VIEW_DEFINITION_SQL, {"schema": schema, "table": name})
            definition = rows[0]["definition"] if rows else None
        else:
            with database.get_inspector(catalog=catalog, schema=schema) as inspector:
                definition = inspector.get_view_definition(name, schema)
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        info = SqlSchemaViewInfo(status=status, detail=detail, source=source)
    else:
        if definition is None:
            info = SqlSchemaViewInfo(
                status="unsupported",
                detail="El motor no devolvió la definición de esta vista.",
                source=source,
            )
        else:
            text = str(definition).strip()
            truncated = len(text) > MAX_VIEW_DEFINITION_CHARS
            info = SqlSchemaViewInfo(
                status="ok",
                source=source,
                definition=text[:MAX_VIEW_DEFINITION_CHARS],
                definition_truncated=truncated,
            )

    _fill_dependencies(info, database, definition, schema, name, runner, can_access)
    return info


def _fill_dependencies(
    info: SqlSchemaViewInfo,
    database: Any,
    definition: str | None,
    schema: str | None,
    name: str,
    runner: CatalogRunner | None,
    can_access: AccessCheck | None,
) -> None:
    try:
        if _is_postgres(database) and runner is not None:
            rows = runner(_PG_VIEW_DEPENDENCIES_SQL, {"schema": schema, "table": name})
            relations = [
                SqlSchemaRelation(
                    schema_name=row["schema_name"],
                    name=row["name"],
                    kind=_KIND_BY_RELKIND.get(row["relkind"]),
                    depth=int(row["depth"]),
                )
                for row in rows
            ]
            info.dependencies_source = "pg_catalog"
        else:
            if not definition:
                info.dependencies_status = "unsupported"
                info.dependencies_detail = "Sin definición de la vista no se pueden inferir sus relaciones."
                return
            from superset.sql.parse import SQLGLOT_DIALECTS

            dialect = SQLGLOT_DIALECTS.get(database.db_engine_spec.engine)
            dialect_name = getattr(dialect, "value", None) or None
            relations = _parsed_dependencies(str(definition), dialect_name)
            info.dependencies_source = "parsed_definition"
            info.dependencies_detail = (
                "Inferidas leyendo la definición (mejor-esfuerzo): no incluye dependencias que el motor "
                "resuelve por su cuenta, como vistas anidadas ni tablas dentro de funciones."
            )
    except Exception as exc:  # noqa: BLE001
        status, detail = classify_error(exc)
        info.dependencies_status = status
        info.dependencies_detail = detail
        return

    for relation in relations:
        relation.accessible = _relation_accessible(can_access, relation.schema_name or schema, relation.name)
    info.dependencies_status = "ok"
    info.depends_on = [r for r in relations if r.depth == 1][:MAX_ITEMS]
    # `base_tables` (tablas físicas, resolviendo vistas anidadas) solo con el
    # catálogo, que conoce el tipo de cada relación; con la definición
    # parseada no se sabe si un nombre es tabla o vista, así que queda vacío.
    info.base_tables = [r for r in relations if r.kind == "table"][:MAX_ITEMS]
