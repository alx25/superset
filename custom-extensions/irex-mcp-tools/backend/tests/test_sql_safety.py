"""Validación de solo-lectura contra el parser REAL de Superset (cargado en
`conftest.py`), no contra un doble — el punto es justamente que el parser
entienda cada dialecto mejor que una regex."""

import pytest

from irex.irex_mcp_tools._sql_safety import validate_read_only_query

ALLOWED = [
    ("postgresql", "SELECT 1"),
    ("postgresql", "SELECT 1;"),
    ("postgresql", "WITH a AS (SELECT 1 AS x) SELECT * FROM a"),
    ("postgresql", "SELECT 1 UNION ALL SELECT 2"),
    ("postgresql", "(SELECT 1)"),
    ("postgresql", "SELECT ';' AS x"),  # la regex anterior lo rechazaba por el ';'
    ("postgresql", "SELECT a FROM t -- comentario ; con punto y coma"),
    ("clickhousedb", "SELECT count() FROM t FINAL SETTINGS max_threads = 2"),
    ("clickhousedb", "WITH 1 AS x SELECT x"),
    ("mssql", "SELECT TOP 5 * FROM t"),
    ("oracle", "SELECT * FROM t FETCH FIRST 5 ROWS ONLY"),
]

REJECTED = [
    ("postgresql", ""),
    ("postgresql", "   ;  "),
    ("postgresql", "DELETE FROM t"),
    ("postgresql", "DROP TABLE t"),
    ("postgresql", "SELECT 1; DELETE FROM t"),
    ("postgresql", "SELECT 1; SELECT 2"),
    ("postgresql", "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"),
    ("postgresql", "WITH u AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM u"),
    ("postgresql", "WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i"),
    ("postgresql", "SELECT * INTO nueva FROM t"),
    ("postgresql", "SELECT * FROM t FOR UPDATE"),
    ("postgresql", "EXPLAIN ANALYZE DELETE FROM t"),
    ("postgresql", "DO $$ BEGIN DELETE FROM t; END $$"),
    ("postgresql", "VALUES (1)"),
    ("clickhousedb", "INSERT INTO t SELECT 1"),
    ("clickhousedb", "ALTER TABLE t DELETE WHERE 1"),
    ("mssql", "SELECT * INTO nueva FROM t"),
]


@pytest.mark.parametrize("engine,sql", ALLOWED)
def test_allows_read_only_queries(engine, sql):
    assert validate_read_only_query(sql, engine) is None


@pytest.mark.parametrize("engine,sql", REJECTED)
def test_rejects_writes_and_non_queries(engine, sql):
    assert validate_read_only_query(sql, engine) is not None
