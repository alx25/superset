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


class FakeDatabase:
    def __init__(self, database_name="clickhousedb", tables=None):
        self.database_name = database_name
        self._tables = tables if tables is not None else set()

    def get_all_table_names_in_schema(self, catalog, schema):
        return self._tables


class FakeDatabaseWithViews(FakeDatabase):
    """Como Superset real: tablas, vistas (tuplas) y vistas materializadas (objetos con .table)."""

    def __init__(self, tables=None, views=None, mviews=None):
        super().__init__(tables=tables)
        self._views = views or set()
        self._mviews = mviews or set()

    def get_all_view_names_in_schema(self, catalog, schema):
        return self._views

    def get_all_materialized_view_names_in_schema(self, catalog, schema):
        return [types.SimpleNamespace(table=n) for n in self._mviews]


def _install_superset_stubs(
    database=None,
    can_access_database=True,
    can_access_table=True,
    table_metadata=None,
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


class TestViews:
    """Pedido del usuario 2026-10-07: el listado omitía las vistas (solo
    `get_table_names()`, tablas físicas) -- una vista real nunca se
    descubría. Ahora van aparte, para que el modelo sepa que NO es tabla."""

    def _db(self):
        return FakeDatabaseWithViews(
            tables={("vi_plan_visita_tb", "appsheet", None)},
            views={("vi_plan_ruta_vista", "appsheet", None)},
            mviews={"mv_resumen"},
        )

    def test_lists_views_and_materialized_views_separately(self):
        _install_superset_stubs(database=self._db())
        response = get_sql_schema_context(_base_request())
        assert response.tables == ["vi_plan_visita_tb"]
        assert response.views == ["vi_plan_ruta_vista"]
        assert response.materialized_views == ["mv_resumen"]

    def test_search_applies_to_views(self):
        _install_superset_stubs(database=self._db())
        response = get_sql_schema_context(_base_request(search="ruta_vista"))
        assert response.tables == []
        assert response.views == ["vi_plan_ruta_vista"]

    def test_limit_is_per_category_so_views_are_not_pushed_out_by_tables(self):
        db = FakeDatabaseWithViews(
            tables={(f"t_{i}", "s", None) for i in range(5)},
            views={("v_unica", "s", None)},
        )
        _install_superset_stubs(database=db)
        response = get_sql_schema_context(_base_request(limit=2))
        assert len(response.tables) == 2
        assert response.views == ["v_unica"]
        assert response.truncated is True

    def test_view_listing_failure_does_not_break_table_listing(self):
        class NoViews(FakeDatabaseWithViews):
            def get_all_view_names_in_schema(self, catalog, schema):
                raise RuntimeError("motor sin vistas")

        _install_superset_stubs(database=NoViews(tables={("a", "s", None)}))
        response = get_sql_schema_context(_base_request())
        assert response.success is True
        assert response.tables == ["a"]
        assert response.views == []

    def test_table_lookup_reports_kind(self):
        meta = {"name": "x", "columns": [{"name": "c", "type": "int"}]}
        _install_superset_stubs(database=self._db(), table_metadata={**meta, "name": "vi_plan_ruta_vista"})
        assert get_sql_schema_context(_base_request(table="vi_plan_ruta_vista")).table.kind == "view"
        _install_superset_stubs(database=self._db(), table_metadata={**meta, "name": "mv_resumen"})
        assert get_sql_schema_context(_base_request(table="mv_resumen")).table.kind == "materialized_view"
        _install_superset_stubs(database=self._db(), table_metadata={**meta, "name": "vi_plan_visita_tb"})
        assert get_sql_schema_context(_base_request(table="vi_plan_visita_tb")).table.kind == "table"


class TestStructureInResponse:
    """Pedido 2026-10-08: PK/FK/índices/vista como metadatos estructurados."""

    _META = {"name": "x", "columns": [{"name": "c", "type": "int"}]}

    def _db(self):
        return FakeDatabaseWithViews(
            tables={("t", "appsheet", None)}, views={("v", "appsheet", None)}
        )

    def test_include_structure_false_returns_only_columns(self):
        _install_superset_stubs(database=self._db(), table_metadata=self._META)
        response = get_sql_schema_context(_base_request(table="t", include_structure=False))
        assert response.table.primary_key is None and response.table.indexes is None

    def test_section_failures_are_explicit_not_fatal(self):
        # FakeDatabase no implementa get_inspector: cada sección falla por separado
        # y lo dice en su `status`, sin tumbar las columnas.
        _install_superset_stubs(database=self._db(), table_metadata=self._META)
        response = get_sql_schema_context(_base_request(table="t"))
        assert response.success is True and response.table.columns
        assert response.table.primary_key.status == "error"
        assert response.table.foreign_keys.status == "error"
        assert response.table.indexes.status == "error"
        assert response.table.view is None

    def test_view_gets_not_applicable_for_keys_and_a_view_section(self):
        _install_superset_stubs(database=self._db(), table_metadata=self._META)
        response = get_sql_schema_context(_base_request(table="v"))
        assert response.table.kind == "view"
        assert response.table.primary_key.status == "not_applicable"
        assert response.table.foreign_keys.status == "not_applicable"
        assert response.table.indexes.status == "not_applicable"
        assert response.table.view is not None
