"""Tests de compare_periods.py — cubren _build_comparison (extraída para
compartirse con export_to_excel), _infer_period_label, y la tool
compare_periods() end-to-end con _run_period_query mockeado (evita
depender de Superset real; _reject_hidden_columns ya cae a set() vacío
sin Superset por su propio try/except).

compare_periods.py importa superset_core.mcp.decorators a nivel de módulo
— se inyecta un stub ANTES del import, igual que los demás archivos de
test.

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

from irex.irex_mcp_tools import compare_periods as cp  # noqa: E402
from irex.irex_mcp_tools import dashboard_dataset_context as ddc  # noqa: E402
from irex.irex_mcp_tools.compare_periods import (  # noqa: E402
    ComparePeriodsRequest,
    _build_comparison,
    _infer_period_label,
    _is_additive_metric,
    compare_periods,
)
from irex.irex_mcp_tools.query_dataset import DatasetFilter  # noqa: E402

# Escenario sintético: Art1 sube (+10, +10%), Art2 baja (-50, -25%), Art3
# solo existe en A (desaparece, delta=-50), Art4 solo existe en B (aparece,
# delta=+80).
_ROWS_A = [
    {"articulo": "Art1", "AVG(precio)": 100.0, "SUM(precio)": 100.0},
    {"articulo": "Art2", "AVG(precio)": 200.0, "SUM(precio)": 200.0},
    {"articulo": "Art3", "AVG(precio)": 50.0, "SUM(precio)": 50.0},
]
_ROWS_B = [
    {"articulo": "Art1", "AVG(precio)": 110.0, "SUM(precio)": 110.0},
    {"articulo": "Art2", "AVG(precio)": 150.0, "SUM(precio)": 150.0},
    {"articulo": "Art4", "AVG(precio)": 80.0, "SUM(precio)": 80.0},
]


def _fake_run_period_query(
    dataset_id, metrics_parsed, groupby, base_filters, period_filters,
    fetch_limit=2000, jinja_filters=None,
):
    period_value = period_filters[0].value if period_filters else None
    if period_value == "A":
        return list(_ROWS_A), None
    return list(_ROWS_B), None


def _patch_run_period_query(monkeypatch):
    monkeypatch.setattr(cp, "_run_period_query", _fake_run_period_query)
    # compare_periods()/export_to_excel() llaman _reject_hidden_columns, que
    # internamente importa `superset` real dentro de un try/except que NO
    # cubre el propio import — en este entorno de test, el stub de
    # superset_core registrado en sys.modules (para poder importar
    # compare_periods.py sin el paquete real) rompe esa cadena de import.
    # No es responsabilidad de estos tests verificar _reject_hidden_columns
    # (no hay columnas ocultas relevantes en los datos sintéticos), así que
    # se mockea directo en vez de depender de que el import real funcione.
    monkeypatch.setattr(ddc, "_reject_hidden_columns", lambda dataset_id, referenced: None)


def _base_request(**overrides):
    base = dict(
        dataset_id=1,
        metrics=["AVG(precio)"],
        groupby=["articulo"],
        period_a_filters=[DatasetFilter(column="periodo", op="==", value="A")],
        period_b_filters=[DatasetFilter(column="periodo", op="==", value="B")],
    )
    base.update(overrides)
    return ComparePeriodsRequest(**base)


# 1. _build_comparison calcula var_pct y delta correctamente, incluidas
# filas que solo existen en un período.
def test_build_comparison_calcula_delta_y_var_pct(monkeypatch):
    _patch_run_period_query(monkeypatch)
    result = _build_comparison(
        1, [{"label": "AVG(precio)"}], ["AVG(precio)"], set(),
        ["articulo"], [],
        [DatasetFilter(column="periodo", op="==", value="A")],
        [DatasetFilter(column="periodo", op="==", value="B")],
        "variation_pct", None, None,
    )
    assert result["error"] is None
    by_articulo = {r["articulo"]: r for r in result["combined"]}
    assert by_articulo["Art1"]["AVG(precio)_delta"] == 10.0
    assert by_articulo["Art1"]["AVG(precio)_var_pct"] == 10.0
    assert by_articulo["Art2"]["AVG(precio)_delta"] == -50.0
    assert by_articulo["Art2"]["AVG(precio)_var_pct"] == -25.0
    # Solo en A: delta = 0 - 50 = -50 (no None, aunque var_pct sí sea None
    # porque falta un lado para calcular el %).
    assert by_articulo["Art3"]["AVG(precio)_delta"] == -50.0
    assert by_articulo["Art3"]["AVG(precio)_var_pct"] is None
    # Solo en B: delta = 80 - 0 = +80.
    assert by_articulo["Art4"]["AVG(precio)_delta"] == 80.0


# 2. sort_by='abs_delta' pone primero la fila de mayor cambio absoluto,
# incluida una fila que solo existe en un período (el bug reportado: en
# export_to_excel esas filas SIEMPRE se iban al final porque no calculaba
# delta y ordenaba solo por var_pct, que es None para esas filas).
def test_sort_by_abs_delta_prioriza_filas_solo_en_un_periodo(monkeypatch):
    _patch_run_period_query(monkeypatch)
    result = _build_comparison(
        1, [{"label": "AVG(precio)"}], ["AVG(precio)"], set(),
        ["articulo"], [],
        [DatasetFilter(column="periodo", op="==", value="A")],
        [DatasetFilter(column="periodo", op="==", value="B")],
        "abs_delta", None, None,
    )
    order = [r["articulo"] for r in result["combined"]]
    # |delta|: Art4=80, Art2=50, Art3=50, Art1=10 -> Art4 primero.
    assert order[0] == "Art4"
    assert order[-1] == "Art1"


def test_sort_by_variation_pct_es_el_default(monkeypatch):
    _patch_run_period_query(monkeypatch)
    result = _build_comparison(
        1, [{"label": "AVG(precio)"}], ["AVG(precio)"], set(),
        ["articulo"], [],
        [DatasetFilter(column="periodo", op="==", value="A")],
        [DatasetFilter(column="periodo", op="==", value="B")],
        "variation_pct", None, None,
    )
    order = [r["articulo"] for r in result["combined"]]
    # |var_pct|: Art2=25%, Art1=10%; Art3/Art4 tienen var_pct=None (quedan
    # al final del orden descendente, tratados como 0).
    assert order[0] == "Art2"
    assert order.index("Art1") < order.index("Art3")
    assert order.index("Art1") < order.index("Art4")


# 3. min_variation_pct filtra, pero las filas que solo existen en un
# período siempre se incluyen (sin importar el umbral).
def test_min_variation_pct_conserva_filas_solo_en_un_periodo(monkeypatch):
    _patch_run_period_query(monkeypatch)
    result = _build_comparison(
        1, [{"label": "AVG(precio)"}], ["AVG(precio)"], set(),
        ["articulo"], [],
        [DatasetFilter(column="periodo", op="==", value="A")],
        [DatasetFilter(column="periodo", op="==", value="B")],
        "variation_pct", 50.0, None,  # umbral alto: ni Art1(10%) ni Art2(25%) pasan
    )
    articulos = {r["articulo"] for r in result["combined"]}
    assert "Art3" in articulos  # solo en A, se incluye igual
    assert "Art4" in articulos  # solo en B, se incluye igual
    assert "Art1" not in articulos
    assert "Art2" not in articulos


# 4. Contribución al cambio total solo se calcula para métricas aditivas.
def test_contribution_pct_solo_para_metricas_aditivas(monkeypatch):
    _patch_run_period_query(monkeypatch)
    result = _build_comparison(
        1, [{"label": "AVG(precio)"}], ["AVG(precio)"], set(),  # NO aditiva
        ["articulo"], [],
        [DatasetFilter(column="periodo", op="==", value="A")],
        [DatasetFilter(column="periodo", op="==", value="B")],
        "variation_pct", None, None,
    )
    assert all("AVG(precio)_contribution_pct" not in r for r in result["combined"])

    result_sum = _build_comparison(
        1, [{"label": "SUM(precio)"}], ["SUM(precio)"], {"SUM(precio)"},  # aditiva
        ["articulo"], [],
        [DatasetFilter(column="periodo", op="==", value="A")],
        [DatasetFilter(column="periodo", op="==", value="B")],
        "variation_pct", None, None,
    )
    assert any("SUM(precio)_contribution_pct" in r for r in result_sum["combined"])


# 5. _infer_period_label: fallback genérico a partir de los filtros, sin
# asumir semántica de fecha/columna.
def test_infer_period_label_desde_filtros():
    label = _infer_period_label(
        [DatasetFilter(column="mes", op="IN", value=[7])], "Período A"
    )
    assert label == "mes=7"


def test_infer_period_label_fallback_sin_filtros():
    assert _infer_period_label([], "Período A") == "Período A"


def test_infer_period_label_multiples_filtros():
    label = _infer_period_label(
        [
            DatasetFilter(column="mes", op="IN", value=[7]),
            DatasetFilter(column="anio", op="==", value=2026),
        ],
        "Período A",
    )
    assert label == "mes=7 · anio=2026"


# 6. compare_periods() end-to-end: guarda sort_by y las etiquetas
# resueltas (explícitas o inferidas) en el report_id.
def test_compare_periods_guarda_sort_by_y_labels_explicitos(monkeypatch):
    _patch_run_period_query(monkeypatch)
    from irex.irex_mcp_tools import report_cache

    req = _base_request(
        sort_by="abs_delta",
        period_a_label="julio 2026",
        period_b_label="agosto 2026",
    )
    resp = compare_periods(req)
    assert resp["status"] == "success"
    cached = report_cache.get_report(resp["report_id"])
    assert cached["sort_by"] == "abs_delta"
    assert cached["period_a_label"] == "julio 2026"
    assert cached["period_b_label"] == "agosto 2026"


def test_compare_periods_infiere_labels_si_no_se_pasan(monkeypatch):
    _patch_run_period_query(monkeypatch)
    from irex.irex_mcp_tools import report_cache

    req = _base_request()  # sin period_a_label/period_b_label
    resp = compare_periods(req)
    cached = report_cache.get_report(resp["report_id"])
    assert cached["period_a_label"] == "periodo=A"
    assert cached["period_b_label"] == "periodo=B"
    assert cached["sort_by"] == "variation_pct"  # default


# 7. Las llamadas heredadas (sin period_a_label/period_b_label, sort_by
# default) conservan exactamente el comportamiento anterior: rows con
# '_a'/'_b'/'_var_pct'/'_delta', ordenadas por variation_pct.
def test_compare_periods_comportamiento_heredado_intacto(monkeypatch):
    _patch_run_period_query(monkeypatch)
    req = _base_request()
    resp = compare_periods(req)
    assert resp["status"] == "success"
    assert resp["period_a_row_count"] == 3
    assert resp["period_b_row_count"] == 3
    assert resp["matched_count"] == 2  # Art1, Art2
    assert resp["unmatched_a_only_count"] == 1  # Art3
    assert resp["unmatched_b_only_count"] == 1  # Art4
    row = resp["rows"][0]
    assert "AVG(precio)_a" in row
    assert "AVG(precio)_b" in row
    assert "AVG(precio)_var_pct" in row
    assert "AVG(precio)_delta" in row


def test_is_additive_metric():
    assert _is_additive_metric("SUM(x)") is True
    assert _is_additive_metric("COUNT(x)") is True
    assert _is_additive_metric("AVG(x)") is False
    assert _is_additive_metric("COUNT_DISTINCT(x)") is False


# 8. Regresión: compare_periods() con aggregate_by y SIN min_variation_pct
# lanzaba `NameError: name 'threshold' is not defined` (bug reportado en
# sesión aef949e4-a903-42e1-98db-f3a1e2fc9f72) porque el llamado a
# _aggregate_by_direction() referenciaba una variable `threshold` que nunca
# se definía dentro de compare_periods() — debía derivarse de
# request.min_variation_pct (default 0), como ya documentaba el propio
# campo 'aggregate_by'.
_ROWS_A_CANAL = [
    {"articulo": "Art1", "canal": "C1", "AVG(precio)": 100.0},
    {"articulo": "Art2", "canal": "C1", "AVG(precio)": 200.0},
    {"articulo": "Art3", "canal": "C2", "AVG(precio)": 100.0},
]
_ROWS_B_CANAL = [
    {"articulo": "Art1", "canal": "C1", "AVG(precio)": 110.0},  # +10%
    {"articulo": "Art2", "canal": "C1", "AVG(precio)": 150.0},  # -25%
    {"articulo": "Art3", "canal": "C2", "AVG(precio)": 102.0},  # +2%
]


def _fake_run_period_query_canal(
    dataset_id, metrics_parsed, groupby, base_filters, period_filters,
    fetch_limit=2000, jinja_filters=None,
):
    period_value = period_filters[0].value if period_filters else None
    if period_value == "A":
        return list(_ROWS_A_CANAL), None
    return list(_ROWS_B_CANAL), None


def test_compare_periods_aggregate_by_sin_min_variation_pct_no_lanza_nameerror(monkeypatch):
    # Reproducción mínima del request real que disparó el NameError (mismo
    # patrón: aggregate_by presente, min_variation_pct ausente).
    monkeypatch.setattr(cp, "_run_period_query", _fake_run_period_query_canal)
    monkeypatch.setattr(ddc, "_reject_hidden_columns", lambda dataset_id, referenced: None)

    req = _base_request(groupby=["articulo", "canal"], aggregate_by=["canal"])
    resp = compare_periods(req)

    assert resp["status"] == "success"
    assert resp["aggregation"]["threshold_used"] == 0
    # Sin umbral, las 3 variaciones (10%, -25%, 2%) cuentan como movimiento.
    breakdown = {r["canal"]: r for r in resp["aggregation"]["breakdown"]}
    assert breakdown["C1"]["increases_count"] == 1
    assert breakdown["C1"]["decreases_count"] == 1
    assert breakdown["C2"]["increases_count"] == 1


def test_compare_periods_aggregate_by_con_min_variation_pct_respeta_umbral(monkeypatch):
    monkeypatch.setattr(cp, "_run_period_query", _fake_run_period_query_canal)
    monkeypatch.setattr(ddc, "_reject_hidden_columns", lambda dataset_id, referenced: None)

    req = _base_request(
        groupby=["articulo", "canal"], aggregate_by=["canal"], min_variation_pct=5.0,
    )
    resp = compare_periods(req)

    assert resp["status"] == "success"
    assert resp["aggregation"]["threshold_used"] == 5.0
    # Art3 (+2%, canal C2) queda por debajo del umbral de 5% — ya se excluye
    # desde _build_comparison, así que C2 no aparece en el breakdown agregado.
    breakdown = {r["canal"]: r for r in resp["aggregation"]["breakdown"]}
    assert "C2" not in breakdown
    assert breakdown["C1"]["increases_count"] == 1
    assert breakdown["C1"]["decreases_count"] == 1
