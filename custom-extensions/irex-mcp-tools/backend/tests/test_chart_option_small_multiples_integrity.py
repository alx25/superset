"""Tests de exactitud/legibilidad de small_multiples — segunda ronda de
bugs reportados por el agente del chat sobre un caso real: 8 facetas
(formato) x 5 series (articulo) x 8 períodos, con 40 tuplas exactas en
selected_groups y un filtro explícito de 8 meses.

Bugs reproducidos en ese caso:
1. selected_groups se aplicaba DESPUÉS de que row_limit ya había cortado
   la consulta amplia -> solo 38/40 combinaciones, sin aviso claro.
2. El eje mostraba Ene-Jun aunque se pidieron Ene-Ago (el dominio del eje
   se derivaba de lo que trajo la consulta, no de lo pedido).
3. Leyenda global con 34 nombres largos, superpuesta al título.
4. Warning de "filtro IN no agrupado" disparado sobre un filtro de alcance
   legítimo (sin evidencia de que se quisiera comparar esos valores).

chart_option.py importa superset_core.mcp.decorators a nivel de módulo —
se inyecta un stub ANTES del import, igual que los demás archivos de test.
Todo lo testeado acá son funciones puras (sin tocar Superset/SQL real).

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

from irex.irex_mcp_tools.chart_option import (  # noqa: E402
    ChartOptionRequest,
    DatasetFilter,
    SelectedGroups,
    _apply_selected_groups,
    _build_small_multiples,
    _selected_groups_incomplete_response,
    _selected_groups_scope_filters,
    _small_multiples_completeness,
    _ungrouped_in_filter_warning,
)


def _req(**overrides):
    base = dict(
        dataset_id=1,
        chart_type="small_multiples",
        x="mes",
        metrics=["SUM(precio)"],
    )
    base.update(overrides)
    return ChartOptionRequest(**base)


def _row(mes, articulo=None, formato=None, precio=0):
    # La key usa el string crudo de la métrica ('SUM(precio)'), igual que
    # las filas YA remapeadas por _remap_rows_to_raw_metrics en el flujo
    # real de chart_option() — _build_small_multiples opera sobre ese
    # formato, no sobre el nombre de columna crudo.
    r = {"mes": mes, "SUM(precio)": precio}
    if articulo is not None:
        r["articulo"] = articulo
    if formato is not None:
        r["formato"] = formato
    return r


def _caso_real_rows(formatos, articulos, meses):
    """8 formatos x 5 articulos x N meses, todas las combinaciones con dato."""
    return [
        _row(m, articulo=a, formato=f, precio=1)
        for f in formatos
        for a in articulos
        for m in meses
    ]


# 1. Ocho facetas, cinco series por faceta y ocho períodos: dominio
# completo sin truncamiento silencioso.
def test_ocho_facetas_cinco_series_ocho_periodos_dominio_completo():
    formatos = [f"Fmt{i}" for i in range(8)]
    articulos = [f"Art{i}" for i in range(5)]
    meses = list(range(1, 9))
    rows = _caso_real_rows(formatos, articulos, meses)
    req = _req(
        facet_by=["formato"],
        series_by=["articulo"],
        filters=[DatasetFilter(column="mes", op="IN", value=meses)],
    )
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 8  # un panel por formato
    assert len(option["xAxis"][0]["data"]) == 8  # los 8 meses, ninguno perdido
    for series in option["series"]:
        assert len(series["data"]) == 8


# 2. Las 40 tuplas solicitadas producen matched_group_count == 40.
def test_cuarenta_tuplas_producen_matched_group_count_40():
    formatos = [f"Fmt{i}" for i in range(8)]
    articulos = [f"Art{i}" for i in range(5)]
    rows = _caso_real_rows(formatos, articulos, [1])
    values = [[f, a] for f in formatos for a in articulos]  # 40 tuplas
    assert len(values) == 40
    selected = SelectedGroups(columns=["formato", "articulo"], values=values)
    filtered, matched, warning = _apply_selected_groups(rows, selected)
    assert matched == 40
    assert warning is None


# 3. No aparecen combinaciones cruzadas adicionales.
def test_no_aparecen_combinaciones_cruzadas_adicionales():
    # Universo más amplio que las tuplas seleccionadas (simula lo que trae
    # un filtro IN independiente por columna).
    formatos = [f"Fmt{i}" for i in range(8)]
    articulos = [f"Art{i}" for i in range(8)] + ["ArtExtra"]  # universo más amplio
    rows = _caso_real_rows(formatos, articulos, [1])
    values = [[f, f"Art{i}"] for i, f in enumerate(formatos)]  # 8 diagonales
    selected = SelectedGroups(columns=["formato", "articulo"], values=values)
    filtered, matched, warning = _apply_selected_groups(rows, selected)
    assert matched == 8
    combos = {(r["formato"], r["articulo"]) for r in filtered}
    assert combos == {(f, f"Art{i}") for i, f in enumerate(formatos)}


# 4. Una tupla ausente produce complete=false y metadatos coherentes.
def test_tupla_ausente_produce_complete_false():
    rows = [_row(1, articulo="A", formato="X")]  # falta ("B","Y")
    selected = SelectedGroups(columns=["formato", "articulo"], values=[["X", "A"], ["Y", "B"]])
    filtered, matched, warning = _apply_selected_groups(rows, selected)
    assert matched == 1
    assert warning is not None
    complete = _small_multiples_completeness(
        truncated_before_selection=False,
        selected_group_count=2,
        matched_group_count=matched,
        requested_x_values=None,
        returned_x_values=["Ene"],
    )
    assert complete is False


# 5. Un límite deliberadamente bajo nunca debe presentarse como éxito
# completo: si la consulta truncó ANTES de aplicar selected_groups y no
# todas las tuplas aparecen, la completitud debe ser False (chart_option()
# convierte esto en status='incomplete', nunca 'success').
def test_truncamiento_con_combinaciones_faltantes_nunca_es_completo():
    complete = _small_multiples_completeness(
        truncated_before_selection=True,
        selected_group_count=40,
        matched_group_count=38,
        requested_x_values=None,
        returned_x_values=["Ene"],
    )
    assert complete is False
    # Si NO truncó y de todos modos faltan (no existen los datos), también
    # es incompleto — pero por una razón distinta (no ambigua, no requiere
    # reintento en chart_option()).
    complete_sin_truncar = _small_multiples_completeness(
        truncated_before_selection=False,
        selected_group_count=40,
        matched_group_count=38,
        requested_x_values=None,
        returned_x_values=["Ene"],
    )
    assert complete_sin_truncar is False


# 6. Todos los ejes conservan las categorías solicitadas y usan null donde
# no existe dato.
def test_eje_conserva_categorias_solicitadas_con_null():
    # Datos reales solo para meses 1-6, pero se pidieron 1-8.
    rows = [_row(m, articulo="A", formato="X", precio=10) for m in range(1, 7)]
    req = _req(
        facet_by=["formato"],
        filters=[DatasetFilter(column="mes", op="IN", value=list(range(1, 9)))],
    )
    option = _build_small_multiples(req, rows)
    x_data = option["xAxis"][0]["data"]
    assert len(x_data) == 8
    series_data = option["series"][0]["data"]
    assert len(series_data) == 8
    assert series_data[6] is None and series_data[7] is None  # meses 7 y 8 sin dato
    assert all(v is not None for v in series_data[:6])


# 7. La leyenda no se superpone al título ni a los grids.
def test_leyenda_no_se_superpone_a_titulo_ni_grids():
    formatos = [f"Fmt{i}" for i in range(4)]
    articulos = ["Canal A", "Canal B"]
    rows = _caso_real_rows(formatos, articulos, [1, 2])
    req = _req(
        facet_by=["formato"], series_by=["articulo"], title="Ventas por formato",
        legend_mode="scroll",  # fuerza leyenda GLOBAL para este test
    )
    option = _build_small_multiples(req, rows)
    assert "legend" in option and isinstance(option["legend"], dict)
    legend_top = float(option["legend"]["top"].rstrip("%"))
    title_top = float(option["title"][0]["top"].rstrip("%"))
    assert title_top < legend_top  # el título va arriba de la leyenda
    # Ningún grid debe empezar antes de donde termina la franja reservada
    # (título + leyenda global) — si no, se superpondrían visualmente.
    reserved_bottom = legend_top + 8.0  # aprox. el alto de la franja de leyenda
    for grid in option["grid"]:
        grid_top = float(grid["top"].rstrip("%"))
        assert grid_top >= legend_top


# 8. Cada panel contiene como máximo sus propias series en la leyenda.
def test_leyenda_per_facet_no_mezcla_series_de_otros_paneles():
    # Muchos nombres únicos de serie (>6) para forzar legend_mode='auto' a
    # decidir 'per_facet' — o forzarlo explícitamente para no depender de
    # ese umbral en el test.
    rows = [
        _row(1, articulo="ArticuloUnico1", formato="Fmt1", precio=1),
        _row(1, articulo="ArticuloUnico2", formato="Fmt1", precio=2),
        _row(1, articulo="ArticuloUnico3", formato="Fmt2", precio=3),
    ]
    req = _req(facet_by=["formato"], series_by=["articulo"], legend_mode="per_facet")
    option = _build_small_multiples(req, rows)
    assert isinstance(option["legend"], list)
    assert len(option["legend"]) == 2  # un legend por panel (Fmt1, Fmt2)

    names_by_panel_series: dict[int, set] = {}
    for s in option["series"]:
        names_by_panel_series.setdefault(s["xAxisIndex"], set()).add(s["name"])

    for i, legend in enumerate(option["legend"]):
        panel_series_names = names_by_panel_series[i]
        # La leyenda del panel i solo debe listar nombres de series de ESE panel.
        assert set(legend["data"]) == panel_series_names


# 9. Etiquetas largas: nombre completo preservado en el 'name' real de la
# serie (usado en el tooltip) — no se transforma, solo la presentación
# visual de la leyenda cambia a 'scroll' cuando hay muchos nombres (el
# widget solo aplica JSON puro vía setOption, sin funciones JS para
# truncar dinámicamente un formatter).
def test_etiquetas_largas_preservan_nombre_completo_en_series():
    long_name = "Detergente Ultra Concentrado Aroma Lavanda 400 Gramos Pack x3"
    rows = [_row(1, articulo=long_name, formato="Fmt1", precio=1)]
    req = _req(facet_by=["formato"], series_by=["articulo"])
    option = _build_small_multiples(req, rows)
    assert option["series"][0]["name"] == long_name  # sin truncar en la serie/tooltip


def test_muchos_nombres_unicos_usan_legend_scroll():
    rows = [
        _row(1, articulo=f"Articulo con nombre largo numero {i}", formato="Fmt1", precio=i)
        for i in range(10)
    ]
    req = _req(facet_by=["formato"], series_by=["articulo"], legend_mode="scroll")
    option = _build_small_multiples(req, rows)
    assert option["legend"]["type"] == "scroll"


# 10. El filtrado exacto sigue respetando RLS — selected_groups y sus
# filtros de alcance derivados nunca tocan SQL/motor de queries
# directamente, van por el mismo mecanismo (_parse_filter/QueryContextFactory)
# que ya aplica RLS para cualquier filtro normal.
def test_scope_filters_usan_el_mismo_formato_que_filtros_normales():
    req = _req(
        selected_groups=SelectedGroups(
            columns=["formato", "articulo"],
            values=[["X", "A"], ["Y", "B"]],
        ),
        facet_by=["formato"],
    )
    derived = _selected_groups_scope_filters(req)
    assert derived == [
        {"col": "formato", "op": "IN", "val": ["X", "Y"]},
        {"col": "articulo", "op": "IN", "val": ["A", "B"]},
    ]
    # No agrega un filtro derivado para una columna que el caller ya filtró.
    req2 = _req(
        selected_groups=SelectedGroups(
            columns=["formato", "articulo"],
            values=[["X", "A"], ["Y", "B"]],
        ),
        facet_by=["formato"],
        filters=[DatasetFilter(column="formato", op="IN", value=["X", "Y", "Z"])],
    )
    derived2 = _selected_groups_scope_filters(req2)
    assert derived2 == [{"col": "articulo", "op": "IN", "val": ["A", "B"]}]


# 11. Los filtros IN multivalor usados solo para alcance no producen
# warnings falsos cuando ya hay una dimensión de comparación declarada.
def test_filtro_in_de_alcance_no_produce_warning_falso_con_facet_by():
    req = _req(
        facet_by=["formato"],
        series_by=["articulo"],
        filters=[DatasetFilter(column="pais", op="IN", value=["CR", "PA", "GT"])],
    )
    # dims incluye x/formato/articulo pero NO 'pais' — antes esto disparaba
    # el warning aunque 'pais' fuera claramente alcance, no comparación.
    dims = ["mes", "formato", "articulo"]
    assert _ungrouped_in_filter_warning(req, dims) is None


def test_filtro_in_sin_ninguna_dimension_declarada_si_advierte():
    # Sin group_by declarado (chart_type='bar', no small_multiples, ya que
    # small_multiples exige facet_by/group_by por validación del modelo):
    # sigue siendo sospechoso que un filtro IN amplio no tenga ningún
    # mecanismo de comparación declarado.
    req = ChartOptionRequest(
        dataset_id=1,
        chart_type="bar",
        x="mes",
        metrics=["SUM(precio)"],
        filters=[DatasetFilter(column="pais", op="IN", value=["CR", "PA", "GT"])],
    )
    dims = ["mes"]
    warning = _ungrouped_in_filter_warning(req, dims)
    assert warning is not None
    assert "group_by" in warning


# 12. Las llamadas heredadas continúan pasando: sin selected_groups, la
# derivación de filtros de alcance es un no-op.
def test_sin_selected_groups_no_hay_filtros_derivados():
    req = _req(facet_by=["formato"])
    assert _selected_groups_scope_filters(req) == []


# 13. status='incomplete' SIEMPRE que matched < expected — sin importar la
# causa (truncamiento vs. combinaciones sin datos) — con incomplete_reason
# distinguiendo ambos casos para que el agente del chat pueda dar una
# instrucción correctiva específica en vez de una advertencia genérica.
def test_incomplete_reason_truncado():
    resp = _selected_groups_incomplete_response(
        expected=40, matched=38, truncated_before_selection=True,
        facet_columns=["formato"],
    )
    assert resp["status"] == "incomplete"
    assert resp["incomplete_reason"] == "selected_groups_truncated"
    assert resp["data_summary"]["complete"] is False
    assert resp["data_summary"]["matched_group_count"] == 38
    assert resp["data_summary"]["selected_group_count"] == 40


def test_incomplete_reason_datos_ausentes_sin_truncar():
    resp = _selected_groups_incomplete_response(
        expected=2, matched=1, truncated_before_selection=False,
        facet_columns=["formato"],
    )
    assert resp["status"] == "incomplete"
    assert resp["incomplete_reason"] == "selected_groups_missing_data"
    assert resp["data_summary"]["truncated_before_selection"] is False
