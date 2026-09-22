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
from typing import Any
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
        self.executed_params: list[Any] = []

    def execute(self, statement, params=None):
        self.executed_statements.append(statement)
        self.executed_params.append(params)
        if self._raise_on_execute:
            raise RuntimeError("no se pudo ejecutar la consulta")

    def fetchall(self):
        return self._result if self._result is not None else []

    def fetchone(self):
        return self._result[0] if self._result else None


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
        raw_query_result=None,
        raise_on_get_raw_connection=False,
        raise_on_raw_query_execute=False,
    ):
        self.database_name = database_name
        self._tables = tables if tables is not None else set()
        self.db_engine_spec = types.SimpleNamespace(engine=engine)
        self._engine_version_info = engine_version_info
        self._raise_on_get_sqla_engine = raise_on_get_sqla_engine
        self.raw_cursor = _FakeRawCursor(raw_query_result, raise_on_execute=raise_on_raw_query_execute)
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
    table_metadata_by_name=None,
    can_access_table_names=None,
):
    """Reemplaza los módulos de Superset que la tool importa dentro de la
    función. Se reinstala completo en cada test para no filtrar estado.

    table_metadata_by_name / can_access_table_names: variantes por-tabla de
    table_metadata / can_access_table, para tests de modo batch (table_names)
    donde cada tabla del batch necesita su propio resultado. Si no se pasan,
    el comportamiento es idéntico al de antes (un único table_metadata/
    can_access_table para toda la llamada)."""
    superset_module = types.ModuleType("superset")
    session_mock = MagicMock()
    session_mock.query.return_value.filter_by.return_value.first.return_value = database
    superset_module.db = MagicMock(session=session_mock)
    sm = MagicMock()
    sm.can_access_database.return_value = can_access_database
    if can_access_table_names is not None:
        sm.can_access_table.side_effect = lambda db, table_ref: table_ref[0] in can_access_table_names
    else:
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
        if table_metadata_by_name is not None:
            name = table[0]
            if name not in table_metadata_by_name:
                raise RuntimeError(f"Table {name} not found")
            return table_metadata_by_name[name]
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
            raw_query_result=[("CREATE TABLE default.t (...) ENGINE = MergeTree() ORDER BY (id)",)],
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


class TestPostgresRelationInfo:
    def test_physical_table_has_relation_type_but_no_definition(self):
        db = FakeDatabase(engine="postgresql", raw_query_result=[("r", None)])
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.table.relation_type == "table"
        assert response.table.table_definition is None
        assert db.raw_cursor.executed_params == [("public", "t")]

    def test_view_has_relation_type_and_real_definition(self):
        db = FakeDatabase(engine="postgresql", raw_query_result=[("v", "SELECT a, b FROM t")])
        _install_superset_stubs(database=db, table_metadata={"name": "v", "columns": []})
        response = get_sql_schema_context(_base_request(table="v"))
        assert response.table.relation_type == "view"
        assert response.table.table_definition == "SELECT a, b FROM t"

    def test_materialized_view_has_relation_type_and_real_definition(self):
        db = FakeDatabase(engine="postgresql", raw_query_result=[("m", "SELECT sum(x) FROM t GROUP BY y")])
        _install_superset_stubs(database=db, table_metadata={"name": "mv", "columns": []})
        response = get_sql_schema_context(_base_request(table="mv"))
        assert response.table.relation_type == "materialized_view"
        assert response.table.table_definition == "SELECT sum(x) FROM t GROUP BY y"

    def test_relation_not_found_in_catalog_is_none_not_error(self):
        db = FakeDatabase(engine="postgresql", raw_query_result=[])
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.success is True
        assert response.table.relation_type is None
        assert response.table.table_definition is None

    def test_failure_is_best_effort_does_not_break_response(self):
        db = FakeDatabase(engine="postgresql", raise_on_get_raw_connection=True)
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.success is True
        assert response.table.relation_type is None
        assert response.table.table_definition is None

    def test_execute_failure_is_also_best_effort(self):
        db = FakeDatabase(engine="postgresql", raise_on_raw_query_execute=True)
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.success is True
        assert response.table.relation_type is None
        assert response.table.table_definition is None

    def test_clickhouse_does_not_get_relation_type(self):
        """relation_type es un campo hoy exclusivo de PostgreSQL — ClickHouse
        no participa de _postgres_relation_info en absoluto."""
        db = FakeDatabase(
            engine="clickhouse",
            raw_query_result=[("CREATE TABLE default.t (...) ENGINE = MergeTree() ORDER BY (id)",)],
        )
        _install_superset_stubs(database=db, table_metadata={"name": "t", "columns": []})
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.table.relation_type is None
        assert response.table.table_definition is not None


class TestBackwardCompatibility:
    """El contrato original (sin table_names) debe seguir funcionando tal
    cual — ver también TestListTables/TestTableColumns, que ya lo cubren
    exhaustivamente. Acá solo se deja explícito el contrato mínimo del
    prompt: database_id/schema/catalog/table, y su variante de inventario."""

    def test_individual_table_contract_unchanged(self):
        _install_superset_stubs(
            database=FakeDatabase(),
            table_metadata={
                "name": "LDBI_HechosVentas",
                "columns": [{"name": "id", "type": "Int32", "comment": None}],
            },
        )
        response = get_sql_schema_context(
            SqlSchemaContextRequest(database_id=1, schema="dbo", catalog=None, table="LDBI_HechosVentas")
        )
        assert response.success is True
        assert response.table.name == "LDBI_HechosVentas"
        assert response.table_contexts is None

    def test_inventory_contract_unchanged(self):
        _install_superset_stubs(
            database=FakeDatabase(tables={("LDBI_HechosVentas", "dbo", None)}),
        )
        response = get_sql_schema_context(
            SqlSchemaContextRequest(database_id=1, schema="dbo", catalog=None)
        )
        assert response.success is True
        assert response.tables == ["LDBI_HechosVentas"]
        assert response.table is None
        assert response.table_contexts is None


class TestBatchRequestValidation:
    def test_table_and_table_names_are_mutually_exclusive(self):
        _install_superset_stubs(database=FakeDatabase())
        response = get_sql_schema_context(
            _base_request(table="ventas", table_names=["ventas", "clientes"])
        )
        assert response.success is False
        assert response.error_type == "INVALID_REQUEST_ERROR"

    def test_empty_table_names_is_rejected(self):
        _install_superset_stubs(database=FakeDatabase())
        response = get_sql_schema_context(_base_request(table_names=[]))
        assert response.success is False
        assert response.error_type == "INVALID_REQUEST_ERROR"

    def test_duplicates_are_deduped_preserving_order(self):
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "a": {"name": "a", "columns": [{"name": "id", "type": "Int32", "comment": None}]},
                "b": {"name": "b", "columns": [{"name": "id", "type": "Int32", "comment": None}]},
            },
        )
        response = get_sql_schema_context(_base_request(table_names=["a", "b", "a", "b", "a"]))
        assert response.success is True
        assert [c.name for c in response.table_contexts] == ["a", "b"]

    def test_batch_over_configured_max_is_rejected(self):
        from flask import Flask

        app = Flask(__name__)
        app.config["MCP_SQL_SCHEMA_BATCH_MAX"] = 2
        _install_superset_stubs(database=FakeDatabase())
        with app.app_context():
            response = get_sql_schema_context(_base_request(table_names=["a", "b", "c"]))
        assert response.success is False
        assert response.error_type == "INVALID_REQUEST_ERROR"
        assert "2" in response.error

    def test_batch_within_default_max_is_accepted(self):
        names = [f"t{i}" for i in range(12)]
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={n: {"name": n, "columns": []} for n in names},
        )
        response = get_sql_schema_context(_base_request(table_names=names))
        assert response.success is True
        assert len(response.table_contexts) == 12

    def test_batch_max_is_evaluated_after_dedup(self):
        """15 nombres con muchos duplicados que deduplican a 3 no deben
        chocar contra un tope configurado en 3 — el límite aplica sobre la
        lista YA deduplicada, no sobre lo que mandó el cliente."""
        from flask import Flask

        app = Flask(__name__)
        app.config["MCP_SQL_SCHEMA_BATCH_MAX"] = 3
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={n: {"name": n, "columns": []} for n in ("a", "b", "c")},
        )
        with app.app_context():
            response = get_sql_schema_context(
                _base_request(table_names=["a", "b", "c", "a", "b", "c", "a"])
            )
        assert response.success is True
        assert len(response.table_contexts) == 3


class TestBatchTableContexts:
    def test_returns_columns_and_types_in_requested_order(self):
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "ventas": {"name": "ventas", "columns": [{"name": "id", "type": "Int32", "comment": None}]},
                "clientes": {"name": "clientes", "columns": [{"name": "nombre", "type": "String", "comment": None}]},
                "productos": {"name": "productos", "columns": [{"name": "sku", "type": "String", "comment": None}]},
            },
        )
        response = get_sql_schema_context(
            _base_request(table_names=["ventas", "clientes", "productos"])
        )
        assert response.success is True
        assert [t.name for t in response.table_contexts] == ["ventas", "clientes", "productos"]
        assert response.table_contexts[0].columns[0].type == "Int32"
        assert response.table_contexts[1].columns[0].type == "String"
        assert all(t.success for t in response.table_contexts)
        # Modo batch: engine/engine_version/supports_jinja a nivel de
        # respuesta, no repetidos por tabla.
        assert response.engine == "clickhouse"

    def test_nonexistent_table_does_not_affect_other_batch_results(self):
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "ventas": {"name": "ventas", "columns": [{"name": "id", "type": "Int32", "comment": None}]},
                "productos": {"name": "productos", "columns": [{"name": "sku", "type": "String", "comment": None}]},
            },
        )
        response = get_sql_schema_context(
            _base_request(table_names=["ventas", "tabla_inexistente", "productos"])
        )
        assert response.success is True
        by_name = {t.name: t for t in response.table_contexts}
        assert by_name["ventas"].success is True
        assert by_name["productos"].success is True
        assert by_name["tabla_inexistente"].success is False
        assert by_name["tabla_inexistente"].error_type == "SCHEMA_LOOKUP_ERROR"

    def test_permission_denied_is_isolated_per_table(self):
        """Mismo chequeo (can_access_table) que el camino individual, pero
        aplicado tabla por tabla: una denegada no tumba el resto del batch."""
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "ventas": {"name": "ventas", "columns": []},
                "secreta": {"name": "secreta", "columns": []},
            },
            can_access_table_names={"ventas"},
        )
        response = get_sql_schema_context(_base_request(table_names=["ventas", "secreta"]))
        assert response.success is True
        by_name = {t.name: t for t in response.table_contexts}
        assert by_name["ventas"].success is True
        assert by_name["secreta"].success is False
        assert by_name["secreta"].error_type == "TABLE_SECURITY_ACCESS_ERROR"

    def test_denied_table_never_triggers_ddl_lookup(self):
        """Una tabla sin permiso no debe disparar ni siquiera la consulta
        best-effort de DDL/relation_type — mismo criterio que el camino
        individual, donde can_access_table corta antes de cualquier otra
        consulta contra la base."""
        db = FakeDatabase(
            engine="clickhouse",
            raw_query_result=[("ventas", "CREATE TABLE ... ventas ... ORDER BY (id)")],
        )
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={"ventas": {"name": "ventas", "columns": []}},
            can_access_table_names={"ventas"},
        )
        response = get_sql_schema_context(_base_request(table_names=["ventas", "secreta"]))
        assert response.success is True
        # Solo 'ventas' entra al IN (...) del batch de DDL — verificable
        # porque la única fila que devuelve el fake cursor es la de 'ventas'
        # y la query ejecutada no debe mencionar 'secreta'.
        assert len(db.raw_cursor.executed_statements) == 1
        assert "secreta" not in db.raw_cursor.executed_statements[0]

    def test_batch_response_never_includes_business_values(self):
        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "t": {"name": "t", "columns": [{"name": "c", "type": "Int32", "comment": None}]},
            },
        )
        response = get_sql_schema_context(_base_request(table_names=["t"]))
        dumped = response.model_dump()
        assert "sqlalchemy_uri" not in dumped
        assert "password" not in str(dumped).lower()
        assert "rows" not in dumped
        assert "sample" not in str(dumped).lower()

    def test_concurrent_batch_calls_do_not_cross_results(self):
        """Sanity de statelessness: get_sql_schema_context no debe guardar
        ningún acumulador a nivel de módulo. Los stubs se instalan UNA sola
        vez (sys.modules no es seguro para reinstalar en paralelo desde
        varios threads) y varias llamadas reales corren concurrentes sobre
        esa misma base compartida — cada una con su propio table_names, sin
        mezclarse entre sí."""
        import concurrent.futures

        db = FakeDatabase(engine="clickhouse")
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                f"tabla_{i}": {
                    "name": f"tabla_{i}",
                    "columns": [{"name": f"col_{i}", "type": "Int32", "comment": None}],
                }
                for i in range(9)
            },
        )

        def _run(offset):
            names = [f"tabla_{offset}", f"tabla_{offset + 1}", f"tabla_{offset + 2}"]
            return offset, names, get_sql_schema_context(_base_request(table_names=names))

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = [f.result() for f in [executor.submit(_run, offset) for offset in (0, 3, 6)]]

        for offset, names, response in results:
            assert response.success is True
            assert [t.name for t in response.table_contexts] == names
            for i, table_ctx in enumerate(response.table_contexts):
                assert table_ctx.columns[0].name == f"col_{offset + i}"


class TestBatchEngineSpecificMetadata:
    def test_clickhouse_batch_fetches_table_definitions_in_one_query(self):
        db = FakeDatabase(
            engine="clickhouse",
            raw_query_result=[
                ("ventas", "CREATE TABLE default.ventas (...) ENGINE = MergeTree() ORDER BY (id)"),
                ("clientes", "CREATE TABLE default.clientes (...) ENGINE = MergeTree() ORDER BY (id)"),
            ],
        )
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "ventas": {"name": "ventas", "columns": []},
                "clientes": {"name": "clientes", "columns": []},
            },
        )
        response = get_sql_schema_context(_base_request(table_names=["ventas", "clientes"]))
        assert response.success is True
        by_name = {t.name: t for t in response.table_contexts}
        assert "ORDER BY (id)" in by_name["ventas"].table_definition
        assert "ORDER BY (id)" in by_name["clientes"].table_definition
        assert len(db.raw_cursor.executed_statements) == 1
        assert "IN (" in db.raw_cursor.executed_statements[0]

    def test_postgres_batch_fetches_relation_info_in_one_query(self):
        db = FakeDatabase(
            engine="postgresql",
            raw_query_result=[
                ("ventas", "r", None),
                ("v_resumen", "v", "SELECT a FROM ventas"),
            ],
        )
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={
                "ventas": {"name": "ventas", "columns": []},
                "v_resumen": {"name": "v_resumen", "columns": []},
            },
        )
        response = get_sql_schema_context(_base_request(table_names=["ventas", "v_resumen"]))
        assert response.success is True
        by_name = {t.name: t for t in response.table_contexts}
        assert by_name["ventas"].relation_type == "table"
        assert by_name["ventas"].table_definition is None
        assert by_name["v_resumen"].relation_type == "view"
        assert by_name["v_resumen"].table_definition == "SELECT a FROM ventas"
        assert len(db.raw_cursor.executed_statements) == 1

    def test_batch_ddl_failure_is_best_effort_isolated(self):
        db = FakeDatabase(engine="clickhouse", raise_on_get_raw_connection=True)
        _install_superset_stubs(
            database=db,
            table_metadata_by_name={"t": {"name": "t", "columns": []}},
        )
        response = get_sql_schema_context(_base_request(table_names=["t"]))
        assert response.success is True
        assert response.table_contexts[0].success is True
        assert response.table_contexts[0].table_definition is None
