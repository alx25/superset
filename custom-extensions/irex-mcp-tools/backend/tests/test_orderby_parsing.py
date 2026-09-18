"""Tests de _parse_orderby / _describe_orderby de query_dataset.py.

query_dataset importa superset_core.mcp.decorators a nivel de módulo (solo
disponible dentro del servicio MCP), así que se inyecta un stub ANTES del
import — los helpers bajo test son funciones puras que no tocan Superset.

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

from irex.irex_mcp_tools.query_dataset import (  # noqa: E402
    _describe_orderby,
    _parse_orderby,
)

BRECHA_METRICS = [
    "SUM(pedido)",
    "SUM(enfirme)",
    'SUM(pedido)-SUM(enfirme) AS "Brecha"',
]


def test_prefijo_menos_descendente_se_mantiene():
    [(parsed, ascending)] = _parse_orderby(["-SUM(sell_out)"])
    assert ascending is False
    assert parsed["column"]["column_name"] == "sell_out"


def test_sin_marcador_es_ascendente():
    [(_, ascending)] = _parse_orderby(["SUM(cuota)"])
    assert ascending is True


def test_sufijo_desc_estilo_sql():
    [(parsed, ascending)] = _parse_orderby(["SUM(cuota) DESC"])
    assert ascending is False
    assert parsed["column"]["column_name"] == "cuota"


def test_sufijo_asc_explicito():
    [(_, ascending)] = _parse_orderby(["SUM(cuota) asc"])
    assert ascending is True


def test_sufijo_desc_sobre_expresion_con_alias():
    [(parsed, ascending)] = _parse_orderby(
        ['SUM(pedido)-SUM(enfirme) AS "Brecha" DESC']
    )
    assert ascending is False
    assert parsed["label"] == "Brecha"


def test_alias_resuelve_a_la_metrica_definida():
    [(parsed, ascending)] = _parse_orderby(["Brecha"], BRECHA_METRICS)
    assert ascending is True
    assert isinstance(parsed, dict)
    assert parsed["label"] == "Brecha"
    assert parsed["sqlExpression"] == "SUM(pedido)-SUM(enfirme)"


def test_alias_con_prefijo_menos():
    [(parsed, ascending)] = _parse_orderby(["-Brecha"], BRECHA_METRICS)
    assert ascending is False
    assert parsed["label"] == "Brecha"


def test_alias_con_sufijo_desc_y_comillas():
    [(parsed, ascending)] = _parse_orderby(['"Brecha" DESC'], BRECHA_METRICS)
    assert ascending is False
    assert parsed["label"] == "Brecha"


def test_alias_desconocido_pasa_como_metrica_guardada():
    [(parsed, ascending)] = _parse_orderby(["count"], BRECHA_METRICS)
    assert parsed == "count"
    assert ascending is True


def test_sin_metrics_el_alias_no_rompe():
    [(parsed, _)] = _parse_orderby(["Brecha"])
    assert parsed == "Brecha"


def test_describe_orderby_eco():
    parsed = _parse_orderby(
        ["Brecha DESC", "SUM(pedido)"], BRECHA_METRICS
    )
    assert _describe_orderby(parsed) == [
        {"by": "Brecha", "direction": "descending"},
        {"by": "SUM(pedido)", "direction": "ascending"},
    ]


def test_caso_sesion_32bf35fa_expresion_sin_marcador():
    # Exactamente el orderby de la sesión: sin marcador → ascendente, y el
    # eco lo hace visible para que el LLM detecte que el "top" quedó fuera.
    parsed = _parse_orderby(
        ['SUM(pedido)-SUM(enfirme) AS "Brecha"'], BRECHA_METRICS
    )
    assert _describe_orderby(parsed) == [
        {"by": "Brecha", "direction": "ascending"}
    ]
