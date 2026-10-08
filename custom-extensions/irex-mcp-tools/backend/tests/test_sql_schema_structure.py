"""Tests de los metadatos estructurales de `irex.get_sql_schema_context`
(PK, FK, índices, vistas) — pedido del usuario 2026-10-08."""

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from irex.irex_mcp_tools.sql_schema_structure import (  # noqa: E402
    classify_error,
    collect_foreign_keys,
    collect_indexes,
    collect_primary_key,
    collect_view_info,
)


class FakeDb:
    def __init__(self, backend="postgresql", **kw):
        self.backend = backend
        self.pk = kw.get("pk", {"name": "pk_t", "constrained_columns": ["id"]})
        self.fks = kw.get("fks", [])
        self.indexes = kw.get("indexes", [])
        self.error = kw.get("error")
        self.view_definition = kw.get("view_definition")
        self.db_engine_spec = types.SimpleNamespace(engine="clickhouse")

    def _pk(self, name, schema):
        if self.error:
            raise self.error
        return self.pk

    def get_foreign_keys(self, table):
        if self.error:
            raise self.error
        return self.fks

    def get_indexes(self, table):
        if self.error:
            raise self.error
        return self.indexes

    def get_inspector(self, catalog=None, schema=None):
        outer = self

        class _Ctx:
            def __enter__(self_inner):
                return types.SimpleNamespace(get_view_definition=lambda name, schema: outer.view_definition, get_pk_constraint=outer._pk)

            def __exit__(self_inner, *a):
                return False

        return _Ctx()


def _row(index, pos, is_key=True, col=None, attnum=1, definition=None, **kw):
    base = dict(
        index_name=index, is_unique=False, is_primary=False, is_valid=True, method="btree",
        predicate=None, position=pos, is_key=is_key, attnum=attnum, column_name=col,
        definition=definition or col, is_desc=False, nulls_first=False,
        constraint_name=None, constraint_type=None,
    )
    base.update(kw)
    return base


class TestPrimaryAndForeignKeys:
    def test_pk_ok(self):
        pk = collect_primary_key(FakeDb(), catalog=None, schema="s", name="t")
        assert (pk.status, pk.name, pk.columns) == ("ok", "pk_t", ["id"])

    def test_table_without_pk_is_ok_with_no_columns_not_an_error(self):
        pk = collect_primary_key(FakeDb(pk={"constrained_columns": [], "name": None}), catalog=None, schema="s", name="t")
        assert pk.status == "ok" and pk.columns == []

    def test_permission_denied_is_explicit(self):
        class Denied(Exception):
            pass

        pk = collect_primary_key(FakeDb(error=Denied("permission denied for table t")), catalog=None, schema="s", name="t")
        assert pk.status == "permission_denied"

    def test_unsupported_engine(self):
        assert collect_foreign_keys(FakeDb(error=NotImplementedError()), ("t", "s", None), None).status == "unsupported"

    def test_foreign_keys_structure_and_access_flag(self):
        fks = [
            {
                "name": "fk_a", "constrained_columns": ["pregunta_id"], "referred_schema": "appsheet",
                "referred_table": "eva_pregunta", "referred_columns": ["pregunta_id"], "options": {"ondelete": "CASCADE"},
            }
        ]
        out = collect_foreign_keys(FakeDb(fks=fks), ("t", "s", None), lambda s, n: n != "secreta")
        item = out.items[0]
        assert out.status == "ok"
        assert (item.name, item.columns, item.referred_table, item.on_delete) == ("fk_a", ["pregunta_id"], "eva_pregunta", "CASCADE")
        assert item.referred_accessible is True


class TestIndexesPostgres:
    def test_columns_in_order_expression_include_predicate_and_constraint(self):
        rows = [
            _row("ix_mix", 1, col="a", is_desc=True, nulls_first=True, predicate="(activa = true)"),
            _row("ix_mix", 2, attnum=0, definition="lower(nombre)", predicate="(activa = true)"),
            _row("ix_mix", 3, is_key=False, col="extra", predicate="(activa = true)"),
            _row("uq", 1, col="id", is_unique=True, constraint_name="uq", constraint_type="u"),
        ]
        out = collect_indexes(FakeDb(), ("t", "s", None), schema="s", name="t", runner=lambda sql, params: rows)
        assert out.status == "ok" and out.source == "pg_catalog"
        mix = next(i for i in out.items if i.name == "ix_mix")
        assert [(k.position, k.column, k.expression) for k in mix.key_columns] == [(1, "a", None), (2, None, "lower(nombre)")]
        assert mix.key_columns[0].descending and mix.key_columns[0].nulls_first
        assert mix.include_columns == ["extra"]
        assert mix.predicate == "(activa = true)"
        uq = next(i for i in out.items if i.name == "uq")
        assert uq.constraint == "uq" and uq.constraint_type == "u"

    def test_catalog_receives_bound_parameters_not_interpolated_names(self):
        seen = {}

        def runner(sql, params):
            seen["sql"], seen["params"] = sql, params
            return []

        collect_indexes(FakeDb(), ("x", "s", None), schema="s'; DROP TABLE x;--", name="t", runner=runner)
        assert "DROP" not in seen["sql"] and seen["params"]["schema"].startswith("s'")

    def test_no_indexes_is_ok_and_empty(self):
        out = collect_indexes(FakeDb(), ("t", "s", None), schema="s", name="t", runner=lambda s, p: [])
        assert out.status == "ok" and out.items == []

    def test_permission_error_from_catalog(self):
        def runner(sql, params):
            raise RuntimeError("permission denied for schema pg_catalog")

        out = collect_indexes(FakeDb(), ("t", "s", None), schema="s", name="t", runner=runner)
        assert out.status == "permission_denied" and "permission denied" in out.detail


class TestIndexesOtherEngines:
    def test_inspector_fallback_reads_partial_predicate_and_include(self):
        db = FakeDb(
            backend="mysql",
            indexes=[{
                "name": "ix", "unique": True, "column_names": ["a", None], "expressions": [None, "lower(b)"],
                "include_columns": ["c"], "dialect_options": {"postgresql_where": "(x > 0)"},
            }],
        )
        out = collect_indexes(db, ("t", "s", None), schema="s", name="t", runner=None)
        item = out.items[0]
        assert out.source == "sqlalchemy_inspector"
        assert item.unique and item.predicate == "(x > 0)" and item.include_columns == ["c"]
        assert item.key_columns[1].expression == "lower(b)"


class TestViews:
    def _runner(self, definition, deps):
        def run(sql, params):
            return [{"definition": definition}] if "pg_get_viewdef" in sql else deps
        return run

    def test_definition_and_physical_dependencies_from_catalog(self):
        deps = [
            {"schema_name": "appsheet", "name": "vi_base_vw", "relkind": "v", "depth": 1},
            {"schema_name": "appsheet", "name": "vi_plan_visita_tb", "relkind": "r", "depth": 2},
        ]
        info = collect_view_info(
            FakeDb(), catalog=None, schema="appsheet", name="v",
            runner=self._runner(" SELECT 1 ", deps), can_access=lambda s, n: n != "vi_plan_visita_tb",
        )
        assert info.status == "ok" and info.definition == "SELECT 1" and info.source == "pg_catalog"
        assert [r.name for r in info.depends_on] == ["vi_base_vw"]
        assert [r.name for r in info.base_tables] == ["vi_plan_visita_tb"]
        assert info.base_tables[0].accessible is False and info.depends_on[0].kind == "view"

    def test_long_definition_is_truncated_and_flagged(self):
        info = collect_view_info(
            FakeDb(), catalog=None, schema="s", name="v",
            runner=self._runner("x" * 25_000, []), can_access=None,
        )
        assert info.definition_truncated is True and len(info.definition) == 20_000

    def test_non_postgres_parses_definition_excluding_ctes(self):
        sys.modules["superset.sql.parse"] = types.SimpleNamespace(SQLGLOT_DIALECTS={"clickhouse": types.SimpleNamespace(value="clickhouse")})
        sys.modules.setdefault("superset", types.ModuleType("superset"))
        db = FakeDb(backend="clickhouse", view_definition="WITH c AS (SELECT * FROM base.ventas) SELECT * FROM c JOIN dim.cliente d ON 1=1")
        info = collect_view_info(db, catalog=None, schema="s", name="v", runner=None, can_access=None)
        assert info.dependencies_source == "parsed_definition"
        assert sorted((r.schema_name, r.name) for r in info.depends_on) == [("base", "ventas"), ("dim", "cliente")]
        assert info.base_tables == []

    def test_engine_without_definition_support_is_explicit(self):
        info = collect_view_info(FakeDb(backend="clickhouse", view_definition=None), catalog=None, schema="s", name="v", runner=None, can_access=None)
        assert info.status == "unsupported" and info.dependencies_status == "unsupported"


def test_classify_error_trims_to_first_line():
    status, detail = classify_error(RuntimeError("boom\nsecond line with secrets"))
    assert status == "error" and detail == "boom"
