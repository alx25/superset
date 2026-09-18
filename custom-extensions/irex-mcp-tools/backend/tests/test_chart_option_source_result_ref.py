"""Tests de 'source_result_ref' en chart_option.py — Fase 2 de la mejora
de small_multiples: en vez de que el LLM retranscriba a mano las
combinaciones exactas de un ranking/top-N ya calculado con
irex.query_dataset(save_as_report=True), chart_option puede referenciar
ese resultado por su 'report_id' y derivar 'facet_by'/'selected_groups'
automáticamente — evitando reproducir el ranking con un alcance distinto.

report_cache.py no depende de un request Flask real para store_report/
get_report (ver _current_user_key, que captura RuntimeError si no hay
contexto de aplicación) — se usa tal cual, sin mocks.

chart_option.py importa superset_core.mcp.decorators a nivel de módulo —
se inyecta un stub ANTES del import, igual que los demás archivos de test.

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

from irex.irex_mcp_tools import report_cache  # noqa: E402
from irex.irex_mcp_tools.chart_option import (  # noqa: E402
    ChartOptionRequest,
    SelectedGroups,
    _resolve_source_result_ref,
    _selected_groups_from_cached_rows,
)
from irex.irex_mcp_tools.query_dataset import QueryDatasetRequest  # noqa: E402


def _req(**overrides):
    base = dict(
        dataset_id=1,
        chart_type="small_multiples",
        x="mes",
        metrics=["SUM(precio)"],
    )
    base.update(overrides)
    return ChartOptionRequest(**base)


def _store_query_dataset_report(
    dataset_id=1, groupby=None, filters=None, rows=None
) -> str:
    return report_cache.store_report(
        dataset_id=dataset_id,
        mode="query_dataset",
        params={
            "dataset_id": dataset_id,
            "groupby": groupby or [],
            "filters": filters or [],
            "metrics": ["SUM(precio)"],
            "rows": rows or [],
        },
    )


# 1. _selected_groups_from_cached_rows deriva las tuplas EXACTAS presentes.
def test_selected_groups_from_cached_rows_deriva_tuplas_exactas():
    rows = [
        {"formato": "X", "articulo": "A", "SUM(precio)": 10},
        {"formato": "Y", "articulo": "B", "SUM(precio)": 20},
        {"formato": "X", "articulo": "A", "SUM(precio)": 15},  # duplicado
    ]
    sg = _selected_groups_from_cached_rows(rows, ["formato", "articulo"])
    assert isinstance(sg, SelectedGroups)
    assert sorted(sg.values) == sorted([["X", "A"], ["Y", "B"]])


# 2. source_result_ref válido CON facet_by/series_by explícitos: hereda
# filters y deriva selected_groups automáticamente — NUNCA facet_by (sería
# una decisión de diseño visual, no del análisis; ver bug reportado por el
# agente del chat: agrupar por ['formato','articulo'] no implica que ambas
# deban ser facet_by, el diseño real es panel=formato, serie=articulo).
def test_source_result_ref_con_facet_by_explicito_deriva_solo_selected_groups():
    rid = _store_query_dataset_report(
        dataset_id=1,
        groupby=["formato", "articulo"],
        filters=[{"column": "pais", "op": "==", "value": "CR"}],
        rows=[
            {"formato": "X", "articulo": "A", "SUM(precio)": 10},
            {"formato": "Y", "articulo": "B", "SUM(precio)": 20},
        ],
    )
    req = _req(source_result_ref=rid, facet_by=["formato"], series_by=["articulo"])
    effective, error = _resolve_source_result_ref(req)
    assert error is None
    assert effective.facet_by == ["formato"]  # exactamente lo que el caller pidió
    assert effective.series_by == ["articulo"]
    assert effective.selected_groups is not None
    assert effective.selected_groups.columns == ["formato", "articulo"]
    assert sorted(effective.selected_groups.values) == sorted([["X", "A"], ["Y", "B"]])
    assert any(f.column == "pais" and f.value == "CR" for f in effective.filters)


# 2b. source_result_ref SIN facet_by explícito para small_multiples ->
# error (ya NO se deriva automáticamente del groupby del reporte).
def test_source_result_ref_sin_facet_by_explicito_produce_error():
    rid = _store_query_dataset_report(
        dataset_id=1,
        groupby=["formato", "articulo"],
        rows=[{"formato": "X", "articulo": "A", "SUM(precio)": 10}],
    )
    req = _req(source_result_ref=rid)  # sin facet_by
    effective, error = _resolve_source_result_ref(req)
    assert error is not None
    assert "facet_by" in error["error"]


# 2c. facet_by/series_by con una columna que el reporte NO agrupó -> error
# explícito (no se puede derivar selected_groups sobre algo ausente).
def test_source_result_ref_facet_by_ajeno_al_reporte_produce_error():
    rid = _store_query_dataset_report(
        dataset_id=1,
        groupby=["formato", "articulo"],
        rows=[{"formato": "X", "articulo": "A", "SUM(precio)": 10}],
    )
    req = _req(source_result_ref=rid, facet_by=["pais"])  # 'pais' no está en el reporte
    effective, error = _resolve_source_result_ref(req)
    assert error is not None
    assert "pais" in error["error"]


# 3. report_id inválido/inexistente produce error explícito.
def test_source_result_ref_invalido_produce_error():
    req = _req(source_result_ref="no-existe-este-id")
    effective, error = _resolve_source_result_ref(req)
    assert error is not None
    assert error["status"] == "error"


# 4. dataset_id que no coincide con el del reporte -> error (no se cruzan
# datasets por accidente).
def test_source_result_ref_dataset_id_no_coincide():
    rid = _store_query_dataset_report(dataset_id=99, groupby=["formato"], rows=[
        {"formato": "X", "SUM(precio)": 1}
    ])
    req = _req(dataset_id=1, source_result_ref=rid)  # dataset distinto
    effective, error = _resolve_source_result_ref(req)
    assert error is not None


# 5. facet_by/selected_groups explícitos tienen prioridad — no se
# sobreescriben con lo derivado del reporte.
def test_facet_by_explicito_tiene_prioridad_sobre_el_reporte():
    rid = _store_query_dataset_report(
        dataset_id=1,
        groupby=["formato", "articulo"],
        rows=[{"formato": "X", "articulo": "A", "SUM(precio)": 10}],
    )
    req = _req(source_result_ref=rid, facet_by=["articulo"])  # override explícito
    effective, error = _resolve_source_result_ref(req)
    assert error is None
    assert effective.facet_by == ["articulo"]  # no fue reemplazado por ["formato","articulo"]


# 6. Sin source_result_ref: no-op, comportamiento heredado intacto.
def test_sin_source_result_ref_es_no_op():
    req = _req(facet_by=["formato"])
    effective, error = _resolve_source_result_ref(req)
    assert error is None
    assert effective is req  # mismo objeto, sin copia


# 7. Reporte sin filas de groupby (ej. guardado por otro modo) — incluso
# con facet_by explícito, sin 'selected_groups' tampoco, produce error
# claro en vez de fallar en silencio más adelante.
def test_reporte_sin_rows_produce_error_si_no_hay_selected_groups_explicito():
    rid = report_cache.store_report(
        dataset_id=1,
        mode="compare_periods",
        params={"dataset_id": 1, "groupby": ["formato"]},  # sin 'rows'
    )
    req = _req(source_result_ref=rid, facet_by=["formato"])
    effective, error = _resolve_source_result_ref(req)
    assert error is not None


# 7b. Sin facet_by explícito para small_multiples -> error, sin importar
# si el reporte tiene rows o no (nunca se deriva automáticamente).
def test_reporte_sin_rows_sin_facet_by_explicito_produce_error():
    rid = report_cache.store_report(
        dataset_id=1,
        mode="compare_periods",
        params={"dataset_id": 1, "groupby": ["formato"]},  # sin 'rows'
    )
    req = _req(source_result_ref=rid)  # sin facet_by explícito
    effective, error = _resolve_source_result_ref(req)
    assert error is not None
    assert "facet_by" in error["error"]


# 8. save_as_report existe en QueryDatasetRequest y en RankPartitionsRequest
# con default False (compatibilidad — las llamadas viejas sin este campo no
# cambian de comportamiento). rank_partitions es el camino correcto para un
# top-N POR PARTICIÓN (query_dataset.row_limit solo recorta globalmente).
def test_query_dataset_request_save_as_report_default_false():
    req = QueryDatasetRequest(dataset_id=1, metrics=["SUM(precio)"])
    assert req.save_as_report is False


def test_rank_partitions_request_save_as_report_default_false():
    from irex.irex_mcp_tools.rank_partitions import RankPartitionsRequest

    req = RankPartitionsRequest(
        dataset_id=1,
        metrics=["SUM(a) AS a", "SUM(b) AS b"],
        detail_by=["articulo"],
        metric_a="a",
        metric_b="b",
    )
    assert req.save_as_report is False
