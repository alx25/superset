"""Tests del modo comparación de irex.export_to_excel — bug reportado por
el agente del chat: un Excel exportado vía report_id de compare_periods
perdía la columna de cambio absoluto ('*_delta'), usaba encabezados
técnicos ('AVG(precio) [Periodo A]'), ignoraba el sort_by original (las
filas sin valor en un período se iban siempre al final), y no resaltaba
máximos/mínimos ni aplicaba formato condicional al delta.

Causa raíz: export_to_excel reimplementaba el cruce A/B por su cuenta, en
vez de reusar _build_comparison (el mismo cálculo que compare_periods usa
para la tabla del chat). Este archivo cubre: _metric_display_name,
_format_comparison_rows, el formato condicional/highlight en
_write_data_sheet, y export_to_excel() end-to-end (modo comparación
directo y vía report_id, con _run_period_query mockeado).

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
from irex.irex_mcp_tools import export_excel as ee  # noqa: E402
from irex.irex_mcp_tools import report_cache  # noqa: E402
from irex.irex_mcp_tools.export_excel import (  # noqa: E402
    ExportToExcelRequest,
    _build_workbook,
    _format_comparison_rows,
    _metric_display_name,
    _write_data_sheet,
    export_to_excel,
)
from irex.irex_mcp_tools.query_dataset import DatasetFilter  # noqa: E402

_ROWS_A = [
    {"articulo": "Art1", "AVG(precio)": 100.0},
    {"articulo": "Art2", "AVG(precio)": 200.0},
    {"articulo": "Art3", "AVG(precio)": 50.0},  # solo en A
]
_ROWS_B = [
    {"articulo": "Art1", "AVG(precio)": 110.0},
    {"articulo": "Art2", "AVG(precio)": 150.0},
    {"articulo": "Art4", "AVG(precio)": 300.0},  # solo en B, mayor |delta| de todas
]


def _fake_run_period_query(
    dataset_id, metrics_parsed, groupby, base_filters, period_filters,
    fetch_limit=2000, jinja_filters=None,
):
    period_value = period_filters[0].value if period_filters else None
    return (list(_ROWS_A) if period_value == "A" else list(_ROWS_B)), None


def _patch_deps(monkeypatch):
    monkeypatch.setattr(cp, "_run_period_query", _fake_run_period_query)
    monkeypatch.setattr(ddc, "_reject_hidden_columns", lambda dataset_id, referenced: None)


# 1. _metric_display_name simplifica el nombre técnico.
def test_metric_display_name():
    assert _metric_display_name("AVG(precio)") == "precio"
    assert _metric_display_name("SUM(sell_in)") == "sell_in"
    assert _metric_display_name("Métrica Guardada") == "Métrica Guardada"  # sin cambios


# 2. _format_comparison_rows arma encabezados descriptivos con las
# etiquetas de período reales, no el nombre técnico crudo.
def test_format_comparison_rows_encabezados_descriptivos():
    combined = [
        {"articulo": "Art1", "AVG(precio)_a": 100.0, "AVG(precio)_b": 110.0,
         "AVG(precio)_var_pct": 10.0, "AVG(precio)_delta": 10.0},
    ]
    rows, var_pct_cols, delta_cols = _format_comparison_rows(
        combined, ["AVG(precio)"], "julio 2026", "agosto 2026",
    )
    row = rows[0]
    assert row["precio · julio 2026"] == 100.0
    assert row["precio · agosto 2026"] == 110.0
    assert row["precio · variación: agosto 2026 vs julio 2026"] == 10.0
    assert row["precio · cambio: agosto 2026 − julio 2026"] == 10.0
    assert var_pct_cols == ["precio · variación: agosto 2026 vs julio 2026"]
    assert delta_cols == ["precio · cambio: agosto 2026 − julio 2026"]
    assert row["articulo"] == "Art1"  # columnas de groupby intactas


# 3. _write_data_sheet aplica color condicional también a delta_cols (no
# solo a var_pct_cols) y resalta con borde la fila de mayor/menor valor de
# highlight_col.
def test_write_data_sheet_aplica_delta_cols_y_highlight():
    import pandas as pd
    from openpyxl import Workbook

    df = pd.DataFrame([
        {"articulo": "Art1", "delta": 10.0, "var_pct": 5.0},
        {"articulo": "Art2", "delta": -50.0, "var_pct": -25.0},
        {"articulo": "Art3", "delta": 80.0, "var_pct": None},
    ])
    wb = Workbook()
    ws = wb.active
    _write_data_sheet(ws, df, var_pct_cols=["var_pct"], delta_cols=["delta"], highlight_col="delta")

    # Formato condicional en delta: positivo verde, negativo rojo.
    assert ws.cell(2, 2).fill.fgColor.rgb == "00C6EFCE"  # Art1 delta=10 > 0
    assert ws.cell(3, 2).fill.fgColor.rgb == "00FFC7CE"  # Art2 delta=-50 < 0
    # Highlight: fila de mayor delta (Art3=80, fila 4) y menor (Art2=-50, fila 3)
    # tienen borde; Art1 no.
    assert ws.cell(4, 1).border.top.style == "medium"
    assert ws.cell(3, 1).border.top.style == "medium"
    assert ws.cell(2, 1).border.top.style is None
    # Autofiltro habilitado.
    assert ws.auto_filter.ref is not None


def test_write_data_sheet_sin_delta_cols_no_rompe_modos_existentes():
    import pandas as pd
    from openpyxl import Workbook

    df = pd.DataFrame([{"col": "x", "val": 1.0}])
    wb = Workbook()
    ws = wb.active
    _write_data_sheet(ws, df, var_pct_cols=[])  # firma vieja, sin delta_cols/highlight
    assert ws.cell(2, 2).value == 1.0


# 4. export_to_excel en modo comparación DIRECTO (sin report_id) ya
# incluye '*_delta' y respeta sort_by='abs_delta'.
def test_export_to_excel_modo_comparacion_directo_incluye_delta(monkeypatch, tmp_path):
    _patch_deps(monkeypatch)
    monkeypatch.setattr(ee, "_EXPORT_DIR", tmp_path)

    req = ExportToExcelRequest(
        dataset_id=1,
        metrics=["AVG(precio)"],
        groupby=["articulo"],
        period_a_filters=[DatasetFilter(column="periodo", op="==", value="A")],
        period_b_filters=[DatasetFilter(column="periodo", op="==", value="B")],
        period_a_label="julio 2026",
        period_b_label="agosto 2026",
    )
    resp = export_to_excel(req)
    assert resp["status"] == "success"

    import openpyxl

    token = resp["download_url"].rsplit("/", 1)[-1]
    wb = openpyxl.load_workbook(tmp_path / f"{token}.xlsx")
    ws = wb.active
    headers = [c.value for c in ws[1]]
    assert "precio · julio 2026" in headers
    assert "precio · agosto 2026" in headers
    assert "precio · variación: agosto 2026 vs julio 2026" in headers
    assert "precio · cambio: agosto 2026 − julio 2026" in headers


# 5. export_to_excel vía report_id: conserva sort_by='abs_delta' y las
# etiquetas de período del reporte original — el bug reportado exacto.
def test_export_to_excel_via_report_id_conserva_sort_by_y_labels(monkeypatch, tmp_path):
    _patch_deps(monkeypatch)
    monkeypatch.setattr(ee, "_EXPORT_DIR", tmp_path)

    report_id = report_cache.store_report(
        dataset_id=1,
        mode="compare_periods",
        params={
            "dataset_id": 1,
            "metrics": ["AVG(precio)"],
            "groupby": ["articulo"],
            "base_filters": [],
            "period_a_filters": [{"column": "periodo", "op": "==", "value": "A"}],
            "period_b_filters": [{"column": "periodo", "op": "==", "value": "B"}],
            "min_variation_pct": None,
            "sort_by": "abs_delta",
            "period_a_label": "julio 2026",
            "period_b_label": "agosto 2026",
        },
    )
    req = ExportToExcelRequest(dataset_id=1, report_id=report_id)
    resp = export_to_excel(req)
    assert resp["status"] == "success"

    import openpyxl

    token = resp["download_url"].rsplit("/", 1)[-1]
    wb = openpyxl.load_workbook(tmp_path / f"{token}.xlsx")
    ws = wb.active
    headers = [c.value for c in ws[1]]
    assert "precio · cambio: agosto 2026 − julio 2026" in headers

    delta_col_idx = headers.index("precio · cambio: agosto 2026 − julio 2026") + 1
    articulo_col_idx = headers.index("articulo") + 1
    # Orden por abs_delta: Art4 (|delta|=220, solo en B) debe ir primero —
    # antes del fix, esta fila se iba al final porque no se calculaba delta
    # en absoluto y el sort usaba var_pct (None para filas de un solo lado).
    assert ws.cell(2, articulo_col_idx).value == "Art4"
    assert ws.cell(2, delta_col_idx).value == 300.0  # 300 - 0 (ausente en A)


# 6. report_id "viejo" (guardado antes de este cambio, sin sort_by ni
# labels) sigue funcionando con los defaults heredados — compatibilidad
# hacia atrás.
def test_export_to_excel_report_id_viejo_sin_metadatos_nuevos(monkeypatch, tmp_path):
    _patch_deps(monkeypatch)
    monkeypatch.setattr(ee, "_EXPORT_DIR", tmp_path)

    report_id = report_cache.store_report(
        dataset_id=1,
        mode="compare_periods",
        params={
            "dataset_id": 1,
            "metrics": ["AVG(precio)"],
            "groupby": ["articulo"],
            "base_filters": [],
            "period_a_filters": [{"column": "periodo", "op": "==", "value": "A"}],
            "period_b_filters": [{"column": "periodo", "op": "==", "value": "B"}],
            "min_variation_pct": None,
            # sin 'sort_by' ni 'period_a_label'/'period_b_label'
        },
    )
    req = ExportToExcelRequest(dataset_id=1, report_id=report_id)
    resp = export_to_excel(req)
    assert resp["status"] == "success"

    import openpyxl

    token = resp["download_url"].rsplit("/", 1)[-1]
    wb = openpyxl.load_workbook(tmp_path / f"{token}.xlsx")
    headers = [c.value for c in wb.active[1]]
    assert "precio · Período A" in headers  # fallback por defecto
    assert "precio · Período B" in headers


# 7. No se alteran los otros modos de export_to_excel: _build_workbook sin
# delta_cols/highlight_col (defaults None, exactamente como lo llaman los
# modos consulta simple y SQL, que no fueron tocados por este cambio)
# sigue construyendo un workbook de datos simples sin errores.
def test_build_workbook_modo_simple_sin_delta_cols_no_afectado():
    wb, error = _build_workbook(
        rows=[{"articulo": "Art1", "AVG(precio)": 100.0}],
        title="Consulta simple",
        var_pct_cols=[],
        summary_text=None,
        split_by=None,
        include_chart=False,
        chart_type="bar",
        chart_x=None,
        chart_y=None,
    )
    assert error is None
    ws = wb.active
    assert ws.cell(1, 1).value == "articulo"
    assert ws.cell(2, 2).value == 100.0


# 8. split_by + summary_text + include_chart siguen funcionando juntos,
# sin pasar delta_cols/highlight_col (comportamiento no tocado por este
# cambio, más allá de agregar autofiltro — mejora general sin riesgo).
def test_build_workbook_split_by_summary_chart_no_afectados():
    rows = [
        {"formato": "X", "articulo": "Art1", "AVG(precio)": 100.0},
        {"formato": "X", "articulo": "Art2", "AVG(precio)": 200.0},
        {"formato": "Y", "articulo": "Art3", "AVG(precio)": 50.0},
    ]
    wb, error = _build_workbook(
        rows=rows,
        title="Reporte",
        var_pct_cols=[],
        summary_text="## Resumen\nTexto de análisis.",
        split_by="formato",
        include_chart=True,
        chart_type="bar",
        chart_x="articulo",
        chart_y="AVG(precio)",
    )
    assert error is None
    sheet_names = wb.sheetnames
    assert "Resumen" in sheet_names
    assert "Gráfico" in sheet_names
    assert "X" in sheet_names
    assert "Y" in sheet_names
    ws_x = wb["X"]
    assert ws_x.cell(1, 1).value == "articulo"  # 'formato' se dropeó del split
