"""Tests de irex.check_query_nulls: validación de solo-lectura, wrapping de
LIMIT/TOP/FETCH por motor, conteo de nulls, y — el más importante — que la
respuesta NUNCA transporta valores reales de ninguna fila.

Correr con:
  cd custom-extensions/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import asyncio
import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


def _stub_tool(func_or_name=None, **kwargs):
    if callable(func_or_name):
        return func_or_name

    def deco(f):
        return f

    return deco


_decorators = types.ModuleType("superset_core.mcp.decorators")
_decorators.tool = _stub_tool
_mcp = types.ModuleType("superset_core.mcp")
_mcp.decorators = _decorators
_core = types.ModuleType("superset_core")
_core.mcp = _mcp
sys.modules.setdefault("superset_core", _core)
sys.modules.setdefault("superset_core.mcp", _mcp)
sys.modules.setdefault("superset_core.mcp.decorators", _decorators)

from irex.irex_mcp_tools.check_query_nulls import (  # noqa: E402
    CheckQueryNullsRequest,
    check_query_nulls as _check_query_nulls_async,
)


class _FakeCtx:
    """Doble de `fastmcp.Context` — ver el mismo patrón en test_explain_query.py."""

    def __init__(self):
        self.calls: list[tuple[int, float | None, str]] = []

    async def report_progress(self, progress, total=None, message=None):
        self.calls.append((progress, total, message))


def check_query_nulls(request, ctx=None):
    """Shim sync — ver el mismo patrón en test_explain_query.py."""
    return asyncio.run(_check_query_nulls_async(request, ctx if ctx is not None else _FakeCtx()))


class _FakeCursor:
    def __init__(self, description, rows, raise_on_execute=False):
        self.description = description
        self._rows = rows
        self._raise_on_execute = raise_on_execute
        self.executed_statements: list[str] = []

    def execute(self, statement):
        self.executed_statements.append(statement)
        if self._raise_on_execute:
            raise RuntimeError("no se pudo ejecutar la consulta")

    def fetchall(self):
        return self._rows


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.rollbacks = 0

    def cursor(self):
        return self._cursor

    def rollback(self):
        self.rollbacks += 1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeDatabase:
    def __init__(
        self,
        database_name="db",
        engine="postgresql",
        columns=None,
        rows=None,
        raise_on_connect=False,
        raise_on_execute=False,
    ):
        self.database_name = database_name
        self.db_engine_spec = types.SimpleNamespace(engine=engine)
        description = [(name,) for name in (columns or [])]
        self.cursor = _FakeCursor(description, rows if rows is not None else [], raise_on_execute=raise_on_execute)
        self._raise_on_connect = raise_on_connect

    def get_raw_connection(self, catalog=None, schema=None, source=None):
        if self._raise_on_connect:
            raise RuntimeError("no se pudo conectar")
        self.connection = _FakeConnection(self.cursor)
        return self.connection


def _install_superset_stubs(database=None, can_access_database=True, render_sql=None, raise_on_render=False):
    superset_module = types.ModuleType("superset")
    session_mock = MagicMock()
    session_mock.query.return_value.filter_by.return_value.first.return_value = database
    superset_module.db = MagicMock(session=session_mock)
    sm = MagicMock()
    sm.can_access_database.return_value = can_access_database
    superset_module.security_manager = sm
    sys.modules["superset"] = superset_module

    models_core = types.ModuleType("superset.models.core")
    models_core.Database = MagicMock()
    sys.modules["superset.models.core"] = models_core

    utils_pkg = types.ModuleType("superset.utils")
    utils_core = types.ModuleType("superset.utils.core")
    utils_core.QuerySource = types.SimpleNamespace(SQL_LAB="sql_lab")
    utils_pkg.core = utils_core
    sys.modules["superset.utils"] = utils_pkg
    sys.modules["superset.utils.core"] = utils_core

    jinja_context_module = types.ModuleType("superset.jinja_context")

    def _get_template_processor(database, **kwargs):
        if raise_on_render:
            raise RuntimeError("no se pudo renderizar el template")
        processor = MagicMock()
        processor.process_template.side_effect = lambda sql, **kw: (render_sql(sql) if render_sql else sql)
        return processor

    jinja_context_module.get_template_processor = _get_template_processor
    sys.modules["superset.jinja_context"] = jinja_context_module

    return sm


def _base_request(**overrides):
    defaults = dict(database_id=1, sql="SELECT 1", catalog=None, schema_name="public", sample_size=100)
    defaults.update(overrides)
    return CheckQueryNullsRequest(**defaults)


class TestAccessAndValidation:
    def test_database_not_found(self):
        _install_superset_stubs(database=None)
        response = check_query_nulls(_base_request())
        assert response.success is False
        assert response.error_type == "DATABASE_NOT_FOUND_ERROR"

    def test_access_denied(self):
        _install_superset_stubs(database=FakeDatabase(), can_access_database=False)
        response = check_query_nulls(_base_request())
        assert response.success is False
        assert response.error_type == "DATABASE_SECURITY_ACCESS_ERROR"

    def test_rejects_non_select_sql(self):
        _install_superset_stubs(database=FakeDatabase())
        response = check_query_nulls(_base_request(sql="DELETE FROM t"))
        assert response.success is False
        assert response.error_type == "INVALID_SQL_ERROR"

    def test_engine_not_supported(self):
        _install_superset_stubs(database=FakeDatabase(engine="mysql"))
        response = check_query_nulls(_base_request())
        assert response.success is False
        assert response.error_type == "ENGINE_NOT_SUPPORTED_ERROR"

    def test_connection_failure_is_reported_not_raised(self):
        _install_superset_stubs(database=FakeDatabase(raise_on_connect=True))
        response = check_query_nulls(_base_request())
        assert response.success is False
        assert response.error_type == "PREVIEW_EXECUTION_ERROR"

    def test_jinja_is_rendered_before_validation(self):
        db = FakeDatabase(columns=["a"], rows=[(1,)])
        _install_superset_stubs(database=db, render_sql=lambda sql: "SELECT 1 AS a")
        response = check_query_nulls(_base_request(sql="{% set x = 1 %}SELECT {{ x }} AS a"))
        assert response.success is True

    def test_jinja_render_failure_is_reported(self):
        _install_superset_stubs(database=FakeDatabase(), raise_on_render=True)
        response = check_query_nulls(_base_request(sql="{{ broken"))
        assert response.success is False
        assert response.error_type == "JINJA_TEMPLATE_ERROR"


class TestLimitWrapping:
    def test_postgres_uses_trailing_limit(self):
        db = FakeDatabase(engine="postgresql", columns=["a"], rows=[])
        _install_superset_stubs(database=db)
        check_query_nulls(_base_request(sample_size=25))
        assert db.cursor.executed_statements == [
            "SET TRANSACTION READ ONLY",
            "SELECT * FROM (SELECT 1) AS irex_sample LIMIT 25",
        ]

    def test_clickhouse_uses_trailing_limit(self):
        db = FakeDatabase(engine="clickhousedb", columns=["a"], rows=[])
        _install_superset_stubs(database=db)
        check_query_nulls(_base_request(sample_size=10))
        assert db.cursor.executed_statements == ["SELECT * FROM (SELECT 1) AS irex_sample LIMIT 10"]

    def test_mssql_uses_top(self):
        db = FakeDatabase(engine="mssql", columns=["a"], rows=[])
        _install_superset_stubs(database=db)
        check_query_nulls(_base_request(sample_size=10))
        assert db.cursor.executed_statements == ["SELECT TOP 10 * FROM (SELECT 1) AS irex_sample"]

    def test_oracle_uses_fetch_first(self):
        db = FakeDatabase(engine="oracle", columns=["a"], rows=[])
        _install_superset_stubs(database=db)
        check_query_nulls(_base_request(sample_size=10))
        assert db.cursor.executed_statements == ["SELECT * FROM (SELECT 1) irex_sample FETCH FIRST 10 ROWS ONLY"]


class TestNullCounting:
    def test_counts_nulls_per_column(self):
        db = FakeDatabase(
            columns=["id", "area_comercial"],
            rows=[(1, None), (2, None), (3, "algo")],
        )
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request())
        assert response.success is True
        assert response.sample_size == 3
        by_name = {c.name: c for c in response.columns}
        assert by_name["id"].null_count == 0
        assert by_name["id"].non_null_count == 3
        assert by_name["id"].null_ratio == 0.0
        assert by_name["area_comercial"].null_count == 2
        assert by_name["area_comercial"].non_null_count == 1
        assert abs(by_name["area_comercial"].null_ratio - (2 / 3)) < 1e-9

    def test_all_null_column_has_ratio_one(self):
        db = FakeDatabase(columns=["x"], rows=[(None,), (None,)])
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request())
        assert response.columns[0].null_ratio == 1.0

    def test_zero_rows_warns_instead_of_dividing_by_zero(self):
        db = FakeDatabase(columns=["x"], rows=[])
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request())
        assert response.success is True
        assert response.sample_size == 0
        assert response.columns[0].null_ratio == 0.0
        assert any("no devolvió ninguna fila" in w for w in response.warnings)

    def test_unvalidated_engine_adds_warning(self):
        db = FakeDatabase(engine="oracle", columns=["x"], rows=[(1,)])
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request())
        assert any("no validado contra una instancia real" in w for w in response.warnings)


class TestNeverExposesValues:
    def test_response_never_contains_actual_row_values(self):
        """La propiedad de seguridad central de esta tool: pase lo que pase,
        el JSON de respuesta no puede contener el valor real de ninguna celda."""
        secret_value = "NUNCA_DEBERIA_APARECER_EN_LA_RESPUESTA"
        db = FakeDatabase(
            columns=["id", "nombre"],
            rows=[(1, secret_value), (2, None)],
        )
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request())
        dumped = json.dumps(response.model_dump(), ensure_ascii=False)
        assert secret_value not in dumped


class TestProgressReporting:
    def test_emits_initial_and_final_phases(self):
        db = FakeDatabase(columns=["a"], rows=[(1,)])
        _install_superset_stubs(database=db)
        ctx = _FakeCtx()
        response = check_query_nulls(_base_request(), ctx=ctx)
        assert response.success is True
        messages = [message for (_, _, message) in ctx.calls]
        assert "Validando la sentencia" in messages
        assert "Iniciando muestreo de filas" in messages
        assert "Midiendo perfil de nulos" in messages

    def test_progress_messages_never_include_sql_or_values(self):
        secret_value = "VALOR_SECRETO_DE_NEGOCIO"
        db = FakeDatabase(columns=["a"], rows=[(secret_value,)])
        _install_superset_stubs(database=db)
        ctx = _FakeCtx()
        check_query_nulls(_base_request(sql="SELECT secreto_de_negocio FROM t"), ctx=ctx)
        for _, _, message in ctx.calls:
            assert "secreto_de_negocio" not in message
            assert secret_value not in message

    def test_error_path_still_reports_initial_phase_only(self):
        _install_superset_stubs(database=None)
        ctx = _FakeCtx()
        response = check_query_nulls(_base_request(), ctx=ctx)
        assert response.success is False
        assert [message for (_, _, message) in ctx.calls] == ["Validando la sentencia"]


class TestReadOnlyEnforcement:
    """Capas de `_sql_safety` aplicadas a la muestra real (2026-09-23)."""

    def test_rejects_delete_hidden_in_cte_without_executing(self):
        db = FakeDatabase(engine="postgresql", columns=["a"], rows=[])
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request(sql="WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"))
        assert response.success is False
        assert response.error_type == "INVALID_SQL_ERROR"
        assert db.cursor.executed_statements == []

    def test_postgres_always_rolls_back(self):
        db = FakeDatabase(engine="postgresql", columns=["a"], rows=[(1,)])
        _install_superset_stubs(database=db)
        check_query_nulls(_base_request())
        assert db.connection.rollbacks == 1

    def test_postgres_rolls_back_even_when_execute_fails(self):
        db = FakeDatabase(engine="postgresql", columns=["a"], raise_on_execute=True)
        _install_superset_stubs(database=db)
        response = check_query_nulls(_base_request())
        assert response.success is False
        assert db.connection.rollbacks == 1

    def test_clickhouse_has_no_transaction_statements(self):
        db = FakeDatabase(engine="clickhousedb", columns=["a"], rows=[])
        _install_superset_stubs(database=db)
        check_query_nulls(_base_request())
        assert "SET TRANSACTION READ ONLY" not in db.cursor.executed_statements
        assert db.connection.rollbacks == 0
