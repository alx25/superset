"""Tests de irex.explain_query: validación de solo-lectura, permisos, y el
SQL exacto que se manda a cada motor (Postgres/ClickHouse probados en
profundidad; MSSQL/Oracle best-effort, sin instancia real disponible en
este entorno — los tests solo fijan el contrato de lo que el código
efectivamente envía, no validan contra un servidor real).

Correr con:
  cd custom-extensions/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import asyncio
import re
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

from irex.irex_mcp_tools.explain_query import (  # noqa: E402
    ExplainQueryRequest,
    explain_query as _explain_query_async,
)


class _FakeCtx:
    """Doble de `fastmcp.Context` — solo lo que usa `_progress.report_phase`
    (`await ctx.report_progress(tick, total, message)`). Guarda cada llamada
    para los tests que quieran verificar las fases/heartbeats emitidos."""

    def __init__(self):
        self.calls: list[tuple[int, float | None, str]] = []

    async def report_progress(self, progress, total=None, message=None):
        self.calls.append((progress, total, message))


def explain_query(request, ctx=None):
    """Shim sync: la tool real es `async def` (progreso MCP estándar, ver
    `_progress.py`) — esto la corre con `asyncio.run()` y un `_FakeCtx()`
    descartable si no se pasa uno, así los ~18 call-sites de este archivo no
    necesitan tocarse uno por uno."""
    return asyncio.run(_explain_query_async(request, ctx if ctx is not None else _FakeCtx()))


class _FakeCursor:
    def __init__(self, fetch_results):
        self._results = list(fetch_results)
        self.executed_statements: list[str] = []

    def execute(self, statement):
        self.executed_statements.append(statement)

    def fetchall(self):
        if not self._results:
            raise AssertionError("el test no encoló suficientes resultados")
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeDatabase:
    def __init__(
        self,
        database_name="db",
        engine="postgresql",
        fetch_results=None,
        raise_on_connect=False,
    ):
        self.database_name = database_name
        self.db_engine_spec = types.SimpleNamespace(engine=engine)
        self._fetch_results = fetch_results if fetch_results is not None else []
        self._raise_on_connect = raise_on_connect
        self.cursor = _FakeCursor(self._fetch_results)

    def get_raw_connection(self, catalog=None, schema=None, source=None):
        if self._raise_on_connect:
            raise RuntimeError("no se pudo conectar")
        return _FakeConnection(self.cursor)


def _install_superset_stubs(
    database=None,
    can_access_database=True,
    render_sql=None,
    raise_on_render=False,
):
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
    defaults = dict(database_id=1, sql="SELECT 1", catalog=None, schema_name="public", analyze=False)
    defaults.update(overrides)
    return ExplainQueryRequest(**defaults)


class TestAccessAndValidation:
    def test_database_not_found(self):
        _install_superset_stubs(database=None)
        response = explain_query(_base_request())
        assert response.success is False
        assert response.error_type == "DATABASE_NOT_FOUND_ERROR"

    def test_access_denied(self):
        _install_superset_stubs(database=FakeDatabase(), can_access_database=False)
        response = explain_query(_base_request())
        assert response.success is False
        assert response.error_type == "DATABASE_SECURITY_ACCESS_ERROR"

    def test_rejects_non_select_sql(self):
        _install_superset_stubs(database=FakeDatabase())
        response = explain_query(_base_request(sql="DELETE FROM t"))
        assert response.success is False
        assert response.error_type == "INVALID_SQL_ERROR"

    def test_rejects_multiple_statements(self):
        _install_superset_stubs(database=FakeDatabase())
        response = explain_query(_base_request(sql="SELECT 1; SELECT 2"))
        assert response.success is False
        assert response.error_type == "INVALID_SQL_ERROR"

    def test_rejects_empty_sql(self):
        _install_superset_stubs(database=FakeDatabase())
        response = explain_query(_base_request(sql="   "))
        assert response.success is False
        assert response.error_type == "INVALID_SQL_ERROR"

    def test_engine_not_supported(self):
        _install_superset_stubs(database=FakeDatabase(engine="mysql"))
        response = explain_query(_base_request())
        assert response.success is False
        assert response.error_type == "ENGINE_NOT_SUPPORTED_ERROR"

    def test_connection_failure_is_reported_not_raised(self):
        _install_superset_stubs(database=FakeDatabase(raise_on_connect=True))
        response = explain_query(_base_request())
        assert response.success is False
        assert response.error_type == "EXPLAIN_EXECUTION_ERROR"


class TestJinjaRendering:
    def test_jinja_is_rendered_before_select_only_validation(self):
        """Una consulta que en crudo NO empieza con SELECT (por un {% set %}
        antes) debe aceptarse si, una vez renderizada, sí lo es — y el motor
        debe recibir el SQL YA renderizado, no el original con Jinja."""
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {}},)]])
        _install_superset_stubs(database=db, render_sql=lambda sql: "SELECT 1")
        response = explain_query(_base_request(sql="{% set x = 1 %}SELECT {{ x }}"))
        assert response.success is True
        assert db.cursor.executed_statements == ["EXPLAIN (FORMAT JSON) SELECT 1"]

    def test_jinja_render_failure_is_reported_not_raised(self):
        _install_superset_stubs(database=FakeDatabase(), raise_on_render=True)
        response = explain_query(_base_request(sql="{{ syntax error"))
        assert response.success is False
        assert response.error_type == "JINJA_TEMPLATE_ERROR"

    def test_plain_sql_without_jinja_is_unaffected(self):
        """Sin macros, el 'render' debe ser una pasada identidad (mismo
        comportamiento que antes de este cambio para SQL sin templating)."""
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {}},)]])
        _install_superset_stubs(database=db)  # render_sql=None -> identidad
        response = explain_query(_base_request(sql="SELECT 1"))
        assert response.success is True
        assert db.cursor.executed_statements == ["EXPLAIN (FORMAT JSON) SELECT 1"]


class TestPostgres:
    def test_plan_only_does_not_execute(self):
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {"Node Type": "Seq Scan"}},)]])
        _install_superset_stubs(database=db)
        response = explain_query(_base_request(analyze=False))
        assert response.success is True
        assert response.executed is False
        assert db.cursor.executed_statements == ["EXPLAIN (FORMAT JSON) SELECT 1"]
        assert '"Node Type": "Seq Scan"' in response.plan

    def test_analyze_executes_the_query(self):
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {}},)]])
        _install_superset_stubs(database=db)
        response = explain_query(_base_request(analyze=True))
        assert response.success is True
        assert response.executed is True
        assert db.cursor.executed_statements == ["EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1"]

    def test_string_plan_passthrough(self):
        """Algunos drivers devuelven el JSON ya como texto en vez de parseado."""
        db = FakeDatabase(engine="postgresql", fetch_results=[[('[{"Plan": {}}]',)]])
        _install_superset_stubs(database=db)
        response = explain_query(_base_request())
        assert response.plan == '[{"Plan": {}}]'


class TestClickHouse:
    def test_plan_only(self):
        db = FakeDatabase(
            engine="clickhouse",
            fetch_results=[[("Expression (Projection)",), ("  ReadFromMergeTree (t)",)]],
        )
        _install_superset_stubs(database=db)
        response = explain_query(_base_request(analyze=False))
        assert response.success is True
        assert response.executed is False
        assert db.cursor.executed_statements == ["EXPLAIN PLAN indexes = 1 SELECT 1"]
        assert "ReadFromMergeTree (t)" in response.plan
        assert response.warnings == []

    def test_analyze_adds_estimate_without_executing(self):
        db = FakeDatabase(
            engine="clickhousedb",
            fetch_results=[
                [("Expression",)],
                [("default", "t", 3, 1000, 10)],
            ],
        )
        _install_superset_stubs(database=db)
        response = explain_query(_base_request(analyze=True))
        assert response.success is True
        assert response.executed is False  # ClickHouse EXPLAIN ESTIMATE tampoco ejecuta
        assert db.cursor.executed_statements == [
            "EXPLAIN PLAN indexes = 1 SELECT 1",
            "EXPLAIN ESTIMATE SELECT 1",
        ]
        assert "default\tt\t3\t1000\t10" in response.plan
        assert any("no ejecuta la consulta" in w for w in response.warnings)


class TestMssql:
    def test_wraps_query_with_showplan_toggle_and_warns(self):
        db = FakeDatabase(
            engine="mssql",
            fetch_results=[[], [("<ShowPlanXML>...</ShowPlanXML>",)], []],
        )
        _install_superset_stubs(database=db)
        response = explain_query(_base_request())
        assert response.success is True
        assert response.executed is False
        assert db.cursor.executed_statements == [
            "SET SHOWPLAN_XML ON",
            "SELECT 1",
            "SET SHOWPLAN_XML OFF",
        ]
        assert "ShowPlanXML" in response.plan
        assert any("no validado contra una instancia real" in w for w in response.warnings)

    def test_analyze_true_adds_extra_warning_but_still_plan_only(self):
        db = FakeDatabase(engine="mssql", fetch_results=[[], [("<plan/>",)], []])
        _install_superset_stubs(database=db)
        response = explain_query(_base_request(analyze=True))
        assert response.executed is False
        assert len(response.warnings) == 2


class TestOracle:
    def test_uses_explain_plan_and_dbms_xplan(self):
        db = FakeDatabase(
            engine="oracle",
            fetch_results=[[], [("PLAN_LINE_1",), ("PLAN_LINE_2",)]],
        )
        _install_superset_stubs(database=db)
        response = explain_query(_base_request())
        assert response.success is True
        assert response.executed is False
        statements = db.cursor.executed_statements
        assert len(statements) == 2
        match = re.search(r"STATEMENT_ID = '([^']+)'", statements[0])
        assert match, statements[0]
        plan_id = match.group(1)
        assert statements[0].endswith("FOR SELECT 1")
        assert f"statement_id => '{plan_id}'" in statements[1]
        assert "PLAN_LINE_1" in response.plan
        assert any("no validado contra una instancia real" in w for w in response.warnings)


class TestProgressReporting:
    def test_emits_initial_and_final_phases(self):
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {}},)]])
        _install_superset_stubs(database=db)
        ctx = _FakeCtx()
        response = explain_query(_base_request(), ctx=ctx)
        assert response.success is True
        messages = [message for (_, _, message) in ctx.calls]
        assert "Validando la sentencia" in messages
        assert any("Iniciando EXPLAIN" in m for m in messages)
        assert "Leyendo y normalizando el plan" in messages

    def test_analyze_true_mentions_analyze_in_start_phase(self):
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {}},)]])
        _install_superset_stubs(database=db)
        ctx = _FakeCtx()
        explain_query(_base_request(analyze=True), ctx=ctx)
        messages = [message for (_, _, message) in ctx.calls]
        assert "Iniciando EXPLAIN ANALYZE" in messages

    def test_progress_messages_never_include_sql_text(self):
        """Nunca deben filtrarse fragmentos del SQL real en los mensajes de progreso."""
        db = FakeDatabase(engine="postgresql", fetch_results=[[({"Plan": {}},)]])
        _install_superset_stubs(database=db)
        ctx = _FakeCtx()
        explain_query(_base_request(sql="SELECT muy_secreto_de_negocio FROM t"), ctx=ctx)
        for _, _, message in ctx.calls:
            assert "muy_secreto_de_negocio" not in message

    def test_error_path_still_reports_initial_phase_only(self):
        _install_superset_stubs(database=None)
        ctx = _FakeCtx()
        response = explain_query(_base_request(), ctx=ctx)
        assert response.success is False
        assert [message for (_, _, message) in ctx.calls] == ["Validando la sentencia"]
