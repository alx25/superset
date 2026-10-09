"""Tests de `explore_temporal_core` (capacidades temporales y resolución de
expresiones de granularidad) — pedido del usuario 2026-10-09."""

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from irex.irex_mcp_tools.explore_temporal_core import (  # noqa: E402
    query_capabilities,
    resolve_temporal_expression,
    time_grain_entries,
)


class FakeSpec:
    engine = "postgresql"
    engine_name = "PostgreSQL"

    def __init__(self, grains=None, error=None):
        self._grains = grains if grains is not None else [
            SimpleNamespace(duration=None, label="Original value"),
            SimpleNamespace(duration="P1D", label="Day"),
            SimpleNamespace(duration="P1M", label="Month"),
        ]
        self._error = error

    def get_time_grains(self):
        if self._error:
            raise self._error
        return self._grains


def _db(spec=None):
    return SimpleNamespace(id=11, database_name="appsheet_pg", backend="postgresql", db_engine_spec=spec or FakeSpec())


def _col(name, is_dttm=True, expression=None, type_="TIMESTAMP", active=True, pdf=None):
    return SimpleNamespace(column_name=name, is_dttm=is_dttm, expression=expression, type=type_,
                           is_active=active, python_date_format=pdf)


def _dataset(columns, spec=None):
    return SimpleNamespace(id=42, table_name="eva_evaluacion", schema="appsheet", database=_db(spec), columns=columns)


VERIFIED = {"form_data_key": "k1", "slice_id": None, "state_kind": "last_persisted",
            "datasource": {"id": 42, "type": "table"}}


def _resolve(columns, grain="P1D", compile_expression=None, spec=None):
    return resolve_temporal_expression(
        verified=VERIFIED, dataset=_dataset(columns, spec), column_name="fecha", time_grain=grain,
        compile_expression=compile_expression or (lambda col, g: f"DATE_TRUNC('day', {col.column_name})"),
    )


class TestCapabilities:
    def test_lists_engine_grains_without_the_none_entry_and_without_uri(self):
        caps = query_capabilities(_db())
        assert caps["status"] == "ok"
        assert caps["time_grains"] == [{"id": "P1D", "label": "Day"}, {"id": "P1M", "label": "Month"}]
        assert caps["database"] == {"id": 11, "name": "appsheet_pg"}
        assert caps["engine"] == "postgresql"
        assert "uri" not in str(caps).lower() and "password" not in str(caps).lower()

    def test_engine_without_grains_is_unsupported(self):
        caps = query_capabilities(_db(FakeSpec(grains=[SimpleNamespace(duration=None, label="Original")])))
        assert caps["status"] == "unsupported" and caps["time_grains"] == []

    def test_failure_is_a_status_not_an_exception(self):
        caps = query_capabilities(_db(FakeSpec(error=RuntimeError("permission denied for database"))))
        assert caps["status"] == "permission_denied" and caps["time_grains"] == []

    def test_time_grain_entries_keeps_superset_order(self):
        assert [g["id"] for g in time_grain_entries(FakeSpec())] == ["P1D", "P1M"]


class TestResolve:
    def test_physical_column_generated_not_validated(self):
        out = _resolve([_col("fecha")])
        assert out["status"] == "generated"
        assert out["expression"] == "DATE_TRUNC('day', fecha)"
        assert out["resolution"] == {"generated": True, "executed": False, "validated": False,
                                     "method": "TableColumn.get_timestamp_expression -> db_engine_spec.get_timestamp_expr"}
        assert out["time_grain"] == {"id": "P1D", "label": "Day"}
        assert out["next_step"]["tool"] == "irex.validate_expression"
        assert out["next_step"]["arguments"] == {"dataset_id": 42, "expression": out["expression"], "kind": "column"}
        assert out["column"]["is_calculated"] is False and out["slice_id"] is None

    def test_calculated_column_is_passed_to_superset_and_reported(self):
        seen = {}

        def compile_expression(col, grain):
            seen["col"], seen["grain"] = col, grain
            return "DATE_TRUNC('month', CAST(fecha_txt AS DATE))"

        out = _resolve([_col("fecha", expression="CAST(fecha_txt AS DATE)")], grain="P1M", compile_expression=compile_expression)
        assert out["status"] == "generated" and seen["grain"] == "P1M"
        assert out["column"]["is_calculated"] is True and out["column"]["expression"] == "CAST(fecha_txt AS DATE)"

    def test_missing_column(self):
        assert _resolve([_col("otra")])["status"] == "column_not_found"

    def test_inactive_column_counts_as_missing(self):
        assert _resolve([_col("fecha", active=False)])["status"] == "column_not_found"

    def test_non_temporal_column(self):
        out = _resolve([_col("fecha", is_dttm=False, type_="VARCHAR")])
        assert out["status"] == "column_not_temporal" and out["resolution"]["generated"] is False

    def test_unknown_grain_lists_supported_ones(self):
        out = _resolve([_col("fecha")], grain="P1W")
        assert out["status"] == "time_grain_not_supported"
        assert [g["id"] for g in out["supported_time_grains"]] == ["P1D", "P1M"]

    def test_engine_without_grains(self):
        out = _resolve([_col("fecha")], spec=FakeSpec(grains=[]))
        assert out["status"] == "unsupported"

    def test_superset_not_implemented_is_unsupported(self):
        def boom(col, grain):
            raise NotImplementedError("No grain spec for P1D for database x")

        assert _resolve([_col("fecha")], compile_expression=boom)["status"] == "unsupported"

    def test_compile_error_is_reported(self):
        def boom(col, grain):
            raise RuntimeError("template error\nmore")

        out = _resolve([_col("fecha")], compile_expression=boom)
        assert out["status"] == "error" and out["detail"] == "template error"


def test_enum_grain_ids_are_plain_strings():
    from enum import Enum

    class TG(str, Enum):
        DAY = "P1D"

    spec = FakeSpec(grains=[SimpleNamespace(duration=TG.DAY, label="Day")])
    entry = time_grain_entries(spec)[0]
    assert entry["id"] == "P1D" and type(entry["id"]) is str
