"""Tests de irex.get_sql_schema_context: permiso, acceso por base/tabla y serialización.

Ver PLAN_ASISTENTE_SQL_LAB.md Fase 7. Los módulos de Superset que la tool
importa (`superset`, `superset.databases.utils`, `superset.models.core`,
`superset.sql.parse`) se mockean completos en `sys.modules` — la tool los
importa DENTRO de la función (mismo patrón que el resto de las tools
irex), así que no hace falta Superset real para correr estos tests.

Correr con:
  cd superset_v6_1_0/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

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

from irex.irex_mcp_tools.sql_schema_context import (  # noqa: E402
    SqlSchemaContextRequest,
    get_sql_schema_context,
)


class _FakeConnection:
    def __init__(self, version_info):
        self.dialect = types.SimpleNamespace(server_version_info=version_info)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeSqlaEngine:
    def __init__(self, version_info, raise_on_connect=False):
        self._version_info = version_info
        self._raise_on_connect = raise_on_connect

    def connect(self):
        if self._raise_on_connect:
            raise RuntimeError("no se pudo conectar")
        return _FakeConnection(self._version_info)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeRawCursor:
    def __init__(self, result, raise_on_execute=False):
        self._result = result
        self._raise_on_execute = raise_on_execute
        self.executed_statements: list[str] = []

    def execute(self, statement):
        self.executed_statements.append(statement)
        if self._raise_on_execute:
            raise RuntimeError("no se pudo ejecutar SHOW CREATE TABLE")

    def fetchall(self):
        return self._result if self._result is not None else []


class _FakeRawConnection:
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
        database_name="clickhousedb",
        tables=None,
        engine="clickhouse",
        engine_version_info=(24, 10),
        raise_on_get_sqla_engine=False,
        show_create_table_result=None,
        raise_on_get_raw_connection=False,
        raise_on_show_create_execute=False,
    ):
        self.database_name = database_name
        self._tables = tables if tables is not None else set()
        self.db_engine_spec = types.SimpleNamespace(engine=engine)
        self._engine_version_info = engine_version_info
        self._raise_on_get_sqla_engine = raise_on_get_sqla_engine
        self.raw_cursor = _FakeRawCursor(show_create_table_result, raise_on_execute=raise_on_show_create_execute)
        self._raise_on_get_raw_connection = raise_on_get_raw_connection

    def get_all_table_names_in_schema(self, catalog, schema):
        return self._tables

    def get_sqla_engine(self):
        if self._raise_on_get_sqla_engine:
            raise RuntimeError("no se pudo abrir el engine")
        return _FakeSqlaEngine(self._engine_version_info)

    def get_raw_connection(self, catalog=None, schema=None, source=None):
        if self._raise_on_get_raw_connection:
            raise RuntimeError("no se pudo conectar")
        return _FakeRawConnection(self.raw_cursor)


def _install_superset_stubs(
    database=None,
    can_access_database=True,
    can_access_table=True,
    table_metadata=None,
    supports_jinja=True,
    jinja_context_keys=None,
    raise_on_get_template_processor=False,
):
    """Reemplaza los módulos de Superset que la tool importa dentro de la
    función. Se reinstala completo en cada test para no filtrar estado."""
    superset_module = types.ModuleType("superset")
    session_mock = MagicMock()
    session_mock.query.return_value.filter_by.return_value.first.return_value = database
    superset_module.db = MagicMock(session=session_mock)
    sm = MagicMock()
    sm.can_access_database.return_value = can_access_database
    sm.can_access_table.return_value = can_access_table
    superset_module.security_manager = sm
    sys.modules["superset"] = superset_module

    models_core = types.ModuleType("superset.models.core")
    models_core.Database = MagicMock()
    sys.modules["superset.models.core"] = models_core

    sql_parse = types.ModuleType("superset.sql.parse")
    sql_parse.Table = lambda table, schema, catalog=None: (table, schema, catalog)
    sys.modules["superset.sql.parse"] = sql_parse

    databases_utils = types.ModuleType("superset.databases.utils")

    def _get_table_metadata(database, table):
        return table_metadata

    databases_utils.get_table_metadata = _get_table_metadata
    sys.modules["superset.databases.utils"] = databases_utils

    extensions_module = types.ModuleType("superset.extensions")
    ffm = MagicMock()
    ffm.is_feature_enabled.return_value = supports_jinja
    extensions_module.feature_flag_manager = ffm
    sys.modules["superset.extensions"] = extensions_module

    jinja_context_module = types.ModuleType("superset.jinja_context")

    def _get_template_processor(database, **kwargs):
        if raise_on_get_template_processor:
            raise RuntimeError("no se pudo construir el template processor")
        processor = MagicMock()
        processor.get_context.return_value = dict.fromkeys(
            jinja_context_keys if jinja_context_keys is not None else ["filter_values", "current_user_id"]
        )
        return processor

    jinja_context_module.get_template_processor = _get_template_processor
    sys.modules["superset.jinja_context"] = jinja_context_module

    utils_pkg = types.ModuleType("superset.utils")
    utils_core = types.ModuleType("superset.utils.core")
    utils_core.QuerySource = types.SimpleNamespace(SQL_LAB="sql_lab")
    utils_pkg.core = utils_core
    sys.modules["superset.utils"] = utils_pkg
    sys.modules["superset.utils.core"] = utils_core

    return sm


def _base_request(**overrides):
    defaults = dict(
        database_id=1, catalog=None, schema_name="public", table=None, search=None, limit=50
    )
    defaults.update(overrides)
    return SqlSchemaContextRequest(**defaults)


class TestDatabaseNotFound:
    def test_database_not_found(self):
        _install_superset_stubs(database=None)
        response = get_sql_schema_context(_base_request())
        assert response.success is False
        assert response.error_type == "DATABASE_NOT_FOUND_ERROR"


class TestPermissionChecks:
    def test_no_access_to_database(self):
        _install_superset_stubs(database=FakeDatabase(), can_access_database=False)
        response = get_sql_schema_context(_base_request())
        assert response.success is False
        assert response.error_type == "DATABASE_SECURITY_ACCESS_ERROR"

    def test_no_access_to_table(self):
        _install_superset_stubs(
            database=FakeDatabase(),
            can_access_database=True,
            can_access_table=False,
            table_metadata={"name": "ventas", "columns": []},
        )
        response = get_sql_schema_context(_base_request(table="ventas"))
        assert response.success is False
        assert response.error_type == "TABLE_SECURITY_ACCESS_ERROR"

    def test_listing_does_not_check_table_access(self):
        """Listar tablas no consulta can_access_table — mismo nivel de
        exposición que el árbol nativo de SQL Lab, que tampoco filtra
        tabla por tabla al listar (solo al pedir columnas de una en concreto)."""
        sm = _install_superset_stubs(
            database=FakeDatabase(tables={("ventas", "public", None)}),
            can_access_database=True,
        )
        response = get_sql_schema_context(_base_request())
        assert response.success is True
        sm.can_access_table.assert_not_called()


class TestListTables:
    def test_lists_table_names_sorted(self):
        _install_superset_stubs(
            database=FakeDatabase(tables={("zeta", "public", None), ("alpha", "public", None)}),
        )
        response = get_sql_schema_context(_base_request())
        assert response.tables == ["alpha", "zeta"]
        assert response.table is None
        assert response.truncated is False

    def test_search_filters_by_substring_case_insensitive(self):
        _install_superset_stubs(
            database=FakeDatabase(
                tables={
                    ("ch_corte_ventas_vm", "public", None),
                    ("ch_pns", "public", None),
                }
            ),
        )
        response = get_sql_schema_context(_base_request(search="VENTAS"))
        assert response.tables == ["ch_corte_ventas_vm"]

    def test_limit_truncates_and_flags_truncated(self):
        tables = {(f"tabla_{i}", "public", None) for i in range(5)}
        _install_superset_stubs(database=FakeDatabase(tables=tables))
        response = get_sql_schema_context(_base_request(limit=2))
        assert len(response.tables) == 2
        assert response.truncated is True

    def test_schema_lookup_error_is_reported_not_raised(self):
        class BrokenDatabase(FakeDatabase):
            def get_all_table_names_in_schema(self, catalog, schema):
                raise RuntimeError("schema not found")

        _install_superset_stubs(database=BrokenDatabase())
        response = get_sql_schema_context(_base_request())
        assert response.success is False
        assert response.error_type == "SCHEMA_LOOKUP_ERROR"
        assert "schema not found" in response.error


class TestTableColumns:
    def test_accepts_public_schema_alias(self):
        request = SqlSchemaContextRequest(
            database_id=3,
            schema="default",
            table="ch_corte_ventas_vm",
        )
        assert request.schema_name == "default"

    def test_returns_columns_with_type_and_comment(self):
        _install_superset_stubs(
            database=FakeDatabase(),
            table_metadata={
                "name": "ch_corte_ventas_vm",
                "comment": "Vista de corte de ventas",
                "columns": [
                    {"name": "anio", "type": "Int32", "comment": None},
                    {"name": "mes_id", "type": "Int8", "comment": "Mes numérico 1-12"},
                ],
            },
        )
        response = get_sql_schema_context(_base_request(table="ch_corte_ventas_vm"))
        assert response.success is True
        assert response.table.name == "ch_corte_ventas_vm"
        assert response.table.comment == "Vista de corte de ventas"
        assert [c.name for c in response.table.columns] == ["anio", "mes_id"]
        assert response.table.columns[1].comment == "Mes numérico 1-12"

    def test_truncates_columns_over_max(self):
        many_columns = [
            {"name": f"col_{i}", "type": "String", "comment": None} for i in range(310)
        ]
        _install_superset_stubs(
            database=FakeDatabase(),
            table_metadata={"name": "wide_table", "columns": many_columns},
        )
        response = get_sql_schema_context(_base_request(table="wide_table"))
        assert len(response.table.columns) == 300
        assert response.truncated is True

    def test_response_never_includes_connection_credentials(self):
        """El modelo de respuesta ni siquiera tiene campos para secretos —
        no hay forma de que la serialización filtre sqlalchemy_uri/password."""
        _install_superset_stubs(
            database=FakeDatabase(),
            table_metadata={
                "name": "t",
                "columns": [{"name": "c", "type": "Int32", "comment": None}],
            },
        )
        response = get_sql_schema_context(_base_request(table="t"))
        dumped = response.model_dump()
        assert "sqlalchemy_uri" not in dumped
        assert "password" not in str(dumped).lower()


class TestEngineMetadata:
    def test_engine_and_version_are_reported(self):
        _install_superset_stubs(
            database=FakeDatabase(engine="clickhouse", engine_version_info=(24, 10, 1)),
        )
        response = get_sql_schema_context(_base_request())
        assert response.engine == "clickhouse"
        assert response.engine_version == "24.10.1"

    def test_engine_version_is_none_when_connection_fails(self):
        """La versión es 'si está disponible' — un motor caído no debe
        romper el listado de tablas, que es el propósito principal de la tool."""
        _install_superset_stubs(
            database=FakeDatabase(raise_on_get_sqla_engine=True),
        )
        response = get_sql_schema_context(_base_request())
        assert response.success is True
        assert response.engine_version is None

    def test_jinja_context_lists_only_names_when_supported(self):
        _install_superset_stubs(
            database=FakeDatabase(),
            supports_jinja=True,
            jinja_context_keys=["filter_values", "current_user_id", "url_param"],
        )
        response = get_sql_schema_context(_base_request())
        assert response.supports_jinja is True
        assert response.jinja_context == ["current_user_id", "filter_values", "url_param"]

    def test_jinja_context_is_none_when_not_supported(self):
        _install_superset_stubs(database=FakeDatabase(), supports_jinja=False)
        response = get_sql_schema_context(_base_request())
        assert response.supports_jinja is False
        assert response.jinja_context is None

    def test_jinja_context_is_none_when_template_processor_fails(self):
        _install_superset_stubs(
            database=FakeDatabase(),
            supports_jinja=True,
            raise_on_get_template_processor=True,
        )
        response = get_sql_schema_context(_base_request())
        assert response.success is True
        assert response.jinja_context is None

    def test_sql_dialect_notes_present_for_clickhouse_none_for_unknown_engine(self):
        _install_superset_stubs(database=FakeDatabase(engine="clickhouse"))
        response = get_sql_schema_context(_base_request())
        assert response.sql_dialect_notes
        assert any("LIMIT" in note for note in response.sql_dialect_notes)

        _install_superset_stubs(database=FakeDatabase(engine="some_future_engine"))
        response = get_sql_schema_context(_base_request())
        assert response.sql_dialect_notes is None

    def test_engine_metadata_absent_on_error_responses(self):
        _install_superset_stubs(database=None)
        response = get_sql_schema_context(_base_request())
        assert response.success is False
        assert response.engine is None
        assert response.engine_version is None
        assert response.supports_jinja is None
        assert response.jinja_context is None
        assert response.sql_dialect_notes is None


class TestKeysAndTableDefinition:
    def test_keys_are_mapped_from_table_metadata(self):
        _install_superset_stubs(
            database=FakeDatabase(engine="postgresql"),
            table_metadata={
                "name": "ventas",
                "columns": [{"name": "id", "type": "Integer", "comment": None}],
                "indexes": [
                    {"type": "pk", "name": None, "column_names": ["id"]},
                    {
                        "type": "fk",
                        "name": "fk_cliente",
                        "column_names": ["cliente_id"],
                        "referred_table": "clientes",
                        "referred_columns": ["id"],
                    },
                    {"type": "index", "name": "idx_fecha", "column_names": ["fecha"], "unique": False},
                ],
            },
        )
        response = get_sql_schema_context(_base_request(table="ventas"))
        assert response.success is True
        keys = response.table.keys
        assert [k.type for k in keys] == ["pk", "fk", "index"]
        assert keys[1].referred_table == "clientes"
        assert keys[1].referred_columns == ["id"]
        assert keys[2].unique is False

    def test_keys_empty_when_metadata_has_none(self):
        _install_superset_stubs(
            database=FakeDatabase(engine="postgresql"),
            table_metadata={"name": "t", "columns": []},
        )
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.table.keys == []

    def test_clickhouse_table_definition_is_fetched(self):
        db = FakeDatabase(
            engine="clickhouse",
            show_create_table_result=[("CREATE TABLE default.t (...) ENGINE = MergeTree() ORDER BY (id)",)],
        )
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.table.table_definition is not None
        assert "ORDER BY (id)" in response.table.table_definition
        assert db.raw_cursor.executed_statements == ["SHOW CREATE TABLE `public`.`t`"]

    def test_clickhouse_table_definition_none_on_failure_does_not_break_response(self):
        db = FakeDatabase(engine="clickhouse", raise_on_get_raw_connection=True)
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.success is True
        assert response.table.table_definition is None

    def test_postgres_has_no_table_definition(self):
        _install_superset_stubs(
            database=FakeDatabase(engine="postgresql"),
            table_metadata={"name": "t", "columns": []},
        )
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.table.table_definition is None
