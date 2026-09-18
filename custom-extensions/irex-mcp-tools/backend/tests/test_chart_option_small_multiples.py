"""Tests de small_multiples (facet_by/series_by/selected_groups) en
chart_option.py.

Contexto: un análisis previo calculó un top-8 de combinaciones EXACTAS
(articulo, formato). Al graficarlo con small_multiples, filtros IN
independientes por columna generaban el producto cruzado de esos valores
(31 series en vez de 8), y group_by=['formato'] agregaba los artículos
dentro de cada panel de formato en vez de darles paneles propios. Estos
tests cubren facet_by/series_by (separan identidad de panel/serie de las
dimensiones de agregación) y selected_groups (restringe a tuplas exactas
sin depender de que 'filters' las reproduzca).

chart_option.py importa superset_core.mcp.decorators (solo disponible
dentro del servicio MCP) y depende de .query_dataset, que también lo
importa a nivel de módulo — se inyecta un stub ANTES del import, igual que
test_orderby_parsing.py. Las funciones bajo test son puras: no tocan
Superset ni ejecutan SQL.

Correr con:
  cd superset_v6_1_0/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import inspect
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

import pytest  # noqa: E402

from irex.irex_mcp_tools import chart_option as co  # noqa: E402
from irex.irex_mcp_tools.chart_option import (  # noqa: E402
    ChartBuildError,
    ChartOptionRequest,
    SelectedGroups,
    _apply_selected_groups,
    _build_small_multiples,
    _facet_columns,
    _small_multiples_grid_dims,
    _suggested_container_height_px,
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


def _row(mes, articulo=None, formato=None, canal=None, precio=0):
    r = {"mes": mes, "precio": precio}
    if articulo is not None:
        r["articulo"] = articulo
    if formato is not None:
        r["formato"] = formato
    if canal is not None:
        r["canal"] = canal
    return r


# 1. facet_by=['articulo','formato'] genera un panel por cada tupla única
def test_facet_by_compuesto_genera_un_panel_por_tupla_unica():
    rows = [
        _row("Ene", articulo="A", formato="X", precio=10),
        _row("Feb", articulo="A", formato="X", precio=12),
        _row("Ene", articulo="B", formato="Y", precio=20),
        _row("Feb", articulo="B", formato="Y", precio=22),
    ]
    req = _req(facet_by=["articulo", "formato"])
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 2
    assert len(option["xAxis"]) == 2
    assert len(option["yAxis"]) == 2


# 2. Ocho combinaciones seleccionadas generan exactamente ocho paneles
def test_ocho_combinaciones_seleccionadas_generan_ocho_paneles():
    articulos = [f"Art{i}" for i in range(8)]
    formatos = [f"Fmt{i}" for i in range(8)]
    # Producto cruzado (lo que trae un IN independiente por columna) +
    # solo 8 de esas 64 combinaciones son el "ranking" real.
    rows = [
        _row("Ene", articulo=a, formato=f, precio=1)
        for a in articulos
        for f in formatos
    ]
    selected = SelectedGroups(
        columns=["articulo", "formato"],
        values=[[articulos[i], formatos[i]] for i in range(8)],
    )
    filtered, matched, warning = _apply_selected_groups(rows, selected)
    assert warning is None
    assert matched == 8
    req = _req(facet_by=["articulo", "formato"])
    option = _build_small_multiples(req, filtered)
    assert len(option["grid"]) == 8


# 3. selected_groups no permite combinaciones cruzadas adicionales
def test_selected_groups_descarta_combinaciones_cruzadas():
    rows = [
        _row("Ene", articulo="A", formato="X"),
        _row("Ene", articulo="A", formato="Y"),  # cruzada, no seleccionada
        _row("Ene", articulo="B", formato="X"),  # cruzada, no seleccionada
        _row("Ene", articulo="B", formato="Y"),
    ]
    selected = SelectedGroups(
        columns=["articulo", "formato"], values=[["A", "X"], ["B", "Y"]]
    )
    filtered, matched, warning = _apply_selected_groups(rows, selected)
    assert warning is None
    assert matched == 2
    combos = {(r["articulo"], r["formato"]) for r in filtered}
    assert combos == {("A", "X"), ("B", "Y")}


# 4. Dos artículos con el mismo formato permanecen en paneles separados
def test_dos_articulos_mismo_formato_paneles_separados():
    rows = [
        _row("Ene", articulo="A", formato="X", precio=10),
        _row("Ene", articulo="B", formato="X", precio=20),
    ]
    req = _req(facet_by=["articulo", "formato"])
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 2
    labels = {t["text"] for t in option["title"] if "text" in t}
    assert {"A · X", "B · X"} <= labels


# 5. Un mismo artículo en dos formatos produce dos paneles
def test_mismo_articulo_dos_formatos_dos_paneles():
    rows = [
        _row("Ene", articulo="A", formato="X", precio=10),
        _row("Ene", articulo="A", formato="Y", precio=20),
    ]
    req = _req(facet_by=["articulo", "formato"])
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 2
    labels = {t["text"] for t in option["title"] if "text" in t}
    assert {"A · X", "A · Y"} <= labels


# 6. series_by crea varias líneas dentro del panel correcto
def test_series_by_crea_lineas_dentro_del_panel_correcto():
    rows = [
        _row("Ene", articulo="A", canal="Online", precio=10),
        _row("Feb", articulo="A", canal="Online", precio=15),
        _row("Ene", articulo="A", canal="Tienda", precio=5),
        _row("Feb", articulo="A", canal="Tienda", precio=7),
        _row("Ene", articulo="B", canal="Online", precio=100),
        _row("Feb", articulo="B", canal="Online", precio=110),
    ]
    req = _req(facet_by=["articulo"], series_by=["canal"])
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 2  # paneles: A, B

    names_by_panel: dict[int, list[str]] = {}
    for s in option["series"]:
        names_by_panel.setdefault(s["xAxisIndex"], []).append(s["name"])
    # Un panel (A) tiene 2 series (Online, Tienda); el otro (B) tiene 1.
    assert sorted(len(v) for v in names_by_panel.values()) == [1, 2]
    all_names = {n for names in names_by_panel.values() for n in names}
    assert {"Online", "Tienda"} <= all_names


# 7. Valores con guiones, comas o el separador visual no colisionan
def test_valores_con_separadores_no_colisionan():
    rows = [
        _row("Ene", articulo="Detergente, 400gr", formato="7-Maxi Pali", precio=1),
        _row("Ene", articulo="A | B", formato="1-Tradicional", precio=2),
    ]
    req = _req(facet_by=["articulo", "formato"])
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 2
    labels = {t["text"] for t in option["title"] if "text" in t}
    assert "Detergente, 400gr · 7-Maxi Pali" in labels
    assert "A | B · 1-Tradicional" in labels


# 8. Los filtros usan parámetros, no interpolación SQL — selected_groups es
# filtrado puro en memoria y nunca construye ni concatena una cláusula SQL.
# Se verifica que el CÓDIGO (no la prosa del docstring) no invoque nada del
# motor de queries de Superset: si construyera SQL, referenciaría alguno de
# estos símbolos (parseo de filtros, comando/factory de queries, expresión
# SQL cruda de una métrica).
def test_selected_groups_no_construye_sql():
    body_lines = inspect.getsource(co._apply_selected_groups).splitlines()
    body = "\n".join(
        line for line in body_lines if not line.strip().startswith(("#", '"'))
    )
    for forbidden in (
        "_parse_filter(",
        "ChartDataCommand",
        "QueryContextFactory",
        "sqlExpression",
        ".execute(",
    ):
        assert forbidden not in body, (
            f"_apply_selected_groups no debe tocar el motor de queries "
            f"({forbidden!r} encontrado)"
        )


# 9. Las llamadas antiguas que solo usan group_by conservan su comportamiento
def test_group_by_legacy_sigue_funcionando_sin_facet_by():
    rows = [
        _row("Ene", formato="X", precio=10),
        _row("Feb", formato="X", precio=12),
        _row("Ene", formato="Y", precio=20),
    ]
    req = _req(group_by=["formato"])  # sin facet_by
    assert _facet_columns(req) == ["formato"]
    option = _build_small_multiples(req, rows)
    assert len(option["grid"]) == 2


# 10. Diferencia entre combinaciones solicitadas y obtenidas produce advertencia
def test_discrepancia_selected_groups_produce_advertencia():
    rows = [
        _row("Ene", articulo="A", formato="X"),
        # ("B","Y") no tiene datos — typo, o sin datos bajo los filtros.
    ]
    selected = SelectedGroups(
        columns=["articulo", "formato"], values=[["A", "X"], ["B", "Y"]]
    )
    filtered, matched, warning = _apply_selected_groups(rows, selected)
    assert len(filtered) == 1
    assert matched == 1
    assert warning is not None
    assert "2" in warning and "1" in warning


# 11. Se respeta el límite configurable de paneles
def test_limite_configurable_de_paneles():
    rows = [_row("Ene", articulo=f"Art{i}", precio=i) for i in range(5)]
    req_bajo = _req(facet_by=["articulo"], max_panels=3)
    with pytest.raises(ChartBuildError):
        _build_small_multiples(req_bajo, rows)
    req_alto = _req(facet_by=["articulo"], max_panels=10)
    option = _build_small_multiples(req_alto, rows)
    assert len(option["grid"]) == 5


# 12. Título y altura sugerida se calculan correctamente para dimensión compuesta
def test_titulo_y_altura_sugerida_dimension_compuesta():
    rows = [
        _row("Ene", articulo="A", formato="X", precio=10),
        _row("Ene", articulo="B", formato="Y", precio=20),
        _row("Ene", articulo="C", formato="Z", precio=30),
    ]
    req = _req(facet_by=["articulo", "formato"], title="Precio por combo")
    option = _build_small_multiples(req, rows)
    titles = {t["text"] for t in option["title"]}
    assert "Precio por combo" in titles
    assert {"A · X", "B · Y", "C · Z"} <= titles

    cols, panel_rows = _small_multiples_grid_dims(3)
    assert cols * panel_rows >= 3
    assert _suggested_container_height_px(panel_rows) >= 320
