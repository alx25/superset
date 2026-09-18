"""Tests de execute_sql_analysis (sql_analysis.py) con extra_tables.

El fetch a Superset (_fetch_source_rows) se mockea — acá se prueba el
pipeline DuckDB: materialización de tablas extra, JOINs, diagnósticos de
truncamiento (result_exact/incomplete_reason) y validación de nombres.
Es el mismo motor que usa el modo SQL de irex.export_to_excel, así que la
paridad query_dataset_sql/export_to_excel es estructural.

Correr con:
  cd superset_v6_1_0/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import sys
import types
from pathlib import Path

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

from irex.irex_mcp_tools import sql_analysis  # noqa: E402
from irex.irex_mcp_tools.sql_analysis import (  # noqa: E402
    ExtraTable,
    execute_sql_analysis,
)

MAIN_ROWS = [
    {"cliente_id": 1, "SUM(sell_in)": 100.0},
    {"cliente_id": 2, "SUM(sell_in)": 50.0},
]
EXTRA_ROWS = [
    {"cliente_id": 1, "producto_id": 10, "SUM(sell_in)": 30.0},
    {"cliente_id": 1, "producto_id": 11, "SUM(sell_in)": 20.0},
    {"cliente_id": 2, "producto_id": 10, "SUM(sell_in)": 5.0},
]


def _fake_fetch(truncate: set[str] | None = None):
    """Devuelve un _fetch_source_rows falso: dataset 62 → MAIN_ROWS,
    dataset 63 → EXTRA_ROWS. 'truncate' marca qué dataset_ids (como str)
    reportan truncamiento."""
    truncate = truncate or set()

    def fetch(dataset_id, metrics, groupby, filters, fetch_row_limit, jinja):
        rows = MAIN_ROWS if dataset_id == 62 else EXTRA_ROWS
        return list(rows), None, str(dataset_id) in truncate

    return fetch


def _run(monkeypatch, sql, extra_tables=None, truncate=None):
    monkeypatch.setattr(sql_analysis, "_fetch_source_rows", _fake_fetch(truncate))
    return execute_sql_analysis(
        dataset_id=62,
        metrics=["SUM(sell_in)"],
        groupby=["cliente_id"],
        filters=[],
        fetch_row_limit=5000,
        sql=sql,
        result_row_limit=100,
        extra_tables=extra_tables,
    )


def test_join_data_con_extra_table(monkeypatch):
    result = _run(
        monkeypatch,
        sql=(
            'SELECT d.cliente_id, d."SUM(sell_in)" AS total, '
            "COUNT(DISTINCT e.producto_id) AS skus "
            "FROM data d LEFT JOIN data2 e ON d.cliente_id = e.cliente_id "
            "GROUP BY 1, 2 ORDER BY 1"
        ),
        extra_tables=[ExtraTable(name="data2", dataset_id=63)],
    )
    assert result["status"] == "success"
    assert result["result_exact"] is True
    assert result["rows"] == [
        {"cliente_id": 1, "total": 100.0, "skus": 2},
        {"cliente_id": 2, "total": 50.0, "skus": 1},
    ]
    (extra,) = result["extra_sources"]
    assert extra["name"] == "data2"
    assert extra["dataset_id"] == 63
    assert extra["row_count"] == 3
    assert extra["truncated"] is False


def test_extra_truncada_marca_result_exact_false(monkeypatch):
    result = _run(
        monkeypatch,
        sql="SELECT COUNT(*) AS n FROM data2",
        extra_tables=[ExtraTable(name="data2", dataset_id=63)],
        truncate={"63"},
    )
    assert result["status"] == "success"
    assert result["result_exact"] is False
    assert result["incomplete_reason"] == "source_truncated"
    assert "data2" in result["source_truncated_warning"]


def test_fuente_principal_truncada(monkeypatch):
    result = _run(monkeypatch, sql="SELECT * FROM data", truncate={"62"})
    assert result["result_exact"] is False
    assert "data" in result["source_truncated_warning"]


def test_nombre_data_reservado(monkeypatch):
    result = _run(
        monkeypatch,
        sql="SELECT 1 AS x FROM data",
        extra_tables=[ExtraTable(name="data", dataset_id=63)],
    )
    assert result["status"] == "error"
    assert "reservado" in result["error"]


def test_nombre_invalido(monkeypatch):
    result = _run(
        monkeypatch,
        sql="SELECT 1 AS x FROM data",
        extra_tables=[ExtraTable(name="2data", dataset_id=63)],
    )
    assert result["status"] == "error"
    assert "inválido" in result["error"]


def test_nombre_duplicado(monkeypatch):
    result = _run(
        monkeypatch,
        sql="SELECT 1 AS x FROM data",
        extra_tables=[
            ExtraTable(name="data2", dataset_id=63),
            ExtraTable(name="data2", dataset_id=63),
        ],
    )
    assert result["status"] == "error"
    assert "duplicado" in result["error"]


def test_sql_referencia_tabla_no_declarada(monkeypatch):
    result = _run(
        monkeypatch,
        sql="SELECT * FROM data3",
        extra_tables=[ExtraTable(name="data2", dataset_id=63)],
    )
    assert result["status"] == "error"
    assert "data3" in result["error"]
