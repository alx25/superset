"""Validación de solo-lectura compartida por las tools que ejecutan SQL
arbitrario del LLM contra la base real (`explain_query`, `check_query_nulls`).

Tres capas, ninguna alcanza sola (verificado contra PostgreSQL real,
2026-09-23):

1. Parser de Superset (`superset.sql.parse.SQLScript`, el mismo que usa SQL
   Lab para `allow_dml`), no regex. Una regex de prefijo `^(SELECT|WITH)`
   dejaba pasar `WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d` —
   con `EXPLAIN ANALYZE` Postgres EJECUTA ese DELETE. `has_mutation()`
   recorre el AST completo (CTEs incluidos). Además se rechaza aparte:
   - `SELECT ... INTO tabla` (crea una tabla; `is_mutating()` no lo marca, y
     Postgres lo permite bajo EXPLAIN ANALYZE incluso en una transacción
     READ ONLY — la capa 2 NO lo frena, solo esta);
   - `FOR UPDATE`/`FOR SHARE` (toma locks de filas);
   - cualquier cosa que no sea una consulta (`exp.Query`: SELECT, WITH,
     UNION, subconsulta entre paréntesis).
2. PostgreSQL: `SET TRANSACTION READ ONLY` antes de ejecutar — frena lo que
   el parser no puede ver (DML escondido en funciones, `nextval()`, etc.).
3. PostgreSQL: `rollback()` explícito siempre al terminar, no depender de
   que cerrar la conexión descarte la transacción (dejaría de ser cierto si
   alguien configura `isolation_level: AUTOCOMMIT` en `engine_params`).

Límite conocido: nada de esto frena efectos que salen de la transacción
(`dblink_exec` a otra conexión, funciones que escriben archivos). Depende
de los permisos del usuario de conexión de cada base.
"""

from contextlib import suppress
from typing import Any

POSTGRES_READ_ONLY_STATEMENT = "SET TRANSACTION READ ONLY"


def validate_read_only_query(sql: str, engine: str) -> str | None:
    """Devuelve un mensaje de error si `sql` no es una única consulta de solo
    lectura según el parser de Superset para `engine`, o None si es válida.
    `sql` debe venir ya con Jinja renderizado."""
    from sqlglot import exp
    from superset.sql.parse import SQLScript

    if not sql.strip().rstrip(";").strip():
        return "sql no puede estar vacío."

    try:
        script = SQLScript(sql, engine)
    except Exception as e:  # noqa: BLE001 - SupersetParseError u otro: se rechaza, nunca se ejecuta
        return (
            f"No se pudo analizar el SQL con el parser de Superset (dialecto '{engine}'): {e}. "
            "Solo se aceptan consultas que el parser pueda verificar como de solo lectura."
        )

    if len(script.statements) != 1:
        return "sql no puede contener múltiples sentencias separadas por ';'."

    if script.has_mutation():
        return (
            "sql contiene una operación de escritura o DDL (INSERT/UPDATE/DELETE/"
            "MERGE/CREATE/DROP/ALTER/TRUNCATE), también dentro de un CTE — solo se "
            "permiten consultas de solo lectura."
        )

    parsed = script.statements[0]._parsed
    if not isinstance(parsed, exp.Query):
        return "sql debe ser una consulta de solo lectura (SELECT, WITH o UNION)."
    if parsed.find(exp.Into):
        return "sql no puede usar SELECT ... INTO (crea una tabla nueva)."
    if parsed.find(exp.Lock):
        return "sql no puede usar FOR UPDATE/FOR SHARE (toma locks de filas)."
    return None


def begin_read_only(cursor: Any, engine: str) -> None:
    """Capa 2: marca la transacción actual como READ ONLY (solo PostgreSQL).
    Válido aunque ya haya corrido el prequery `set search_path` de Superset:
    Postgres solo impide pasar a read-write después de la primera consulta,
    no a read-only."""
    if engine == "postgresql":
        cursor.execute(POSTGRES_READ_ONLY_STATEMENT)


def rollback_quietly(conn: Any, engine: str) -> None:
    """Capa 3: descarta la transacción siempre (solo PostgreSQL). Un fallo
    del rollback (conexión ya caída) no debe tapar el error original."""
    if engine == "postgresql":
        with suppress(Exception):
            conn.rollback()
