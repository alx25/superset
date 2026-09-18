"""Tests de _dataset_summary en dashboard_dataset_context.py — expone al
LLM el contexto de negocio en texto libre que un admin de Superset ya
puede escribir hoy desde la UI (Editar Dataset > Settings/Columns), sin
que el MCP lo leyera hasta ahora (column.description solo se usaba para
detectar el marcador '#no-ia' de ocultamiento, nunca se exponía su
contenido; dataset.description no se leía en absoluto).

dashboard_dataset_context.py importa superset_core.mcp.decorators a nivel
de módulo — se inyecta un stub ANTES del import, igual que los demás
archivos de test. _dataset_summary es duck-typed (solo usa .id,
.table_name, .columns, .metrics, .description) — se prueba con un objeto
falso simple, sin tocar Superset.

Correr con:
  cd superset_v6_1_0/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import sys
import types
from pathlib import Path
from types import SimpleNamespace

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

from irex.irex_mcp_tools.dashboard_dataset_context import _dataset_summary  # noqa: E402


def _col(name, description=None, verbose_name=None):
    return SimpleNamespace(
        column_name=name, description=description, verbose_name=verbose_name
    )


def _metric(name, expression="SUM(x)", description=None):
    return SimpleNamespace(
        metric_name=name, expression=expression, description=description
    )


def _dataset(columns, metrics=None, description=None, dataset_id=1, table_name="t"):
    return SimpleNamespace(
        id=dataset_id,
        table_name=table_name,
        columns=columns,
        metrics=metrics or [],
        description=description,
    )


# 1. dataset_description se expone cuando el dataset tiene descripción.
def test_dataset_description_se_expone():
    ds = _dataset([_col("pais")], description="Excluye clientes dados de baja.")
    summary = _dataset_summary(ds)
    assert summary["dataset_description"] == "Excluye clientes dados de baja."


# 2. Sin descripción de dataset, la clave ni aparece (mismo patrón que
# column_labels — no ensuciar la respuesta con campos vacíos).
def test_sin_dataset_description_no_aparece_la_clave():
    ds = _dataset([_col("pais")], description=None)
    summary = _dataset_summary(ds)
    assert "dataset_description" not in summary


# 3. column_descriptions expone el contenido real de columnas visibles.
def test_column_descriptions_expone_contenido_real():
    ds = _dataset([
        _col("pais", description="Código ISO de 2 letras."),
        _col("marca", description=None),
    ])
    summary = _dataset_summary(ds)
    assert summary["column_descriptions"] == {"pais": "Código ISO de 2 letras."}
    assert "marca" not in summary["column_descriptions"]


# 4. Una columna oculta (#no-ia) nunca aparece en column_descriptions,
# aunque su texto tenga más contenido además del marcador.
def test_columna_oculta_no_aparece_en_column_descriptions():
    ds = _dataset([
        _col("interno_x", description="Uso interno, no exponer #no-ia"),
        _col("pais", description="Código ISO."),
    ])
    summary = _dataset_summary(ds)
    assert "interno_x" not in summary["columns"]
    assert "interno_x" not in summary.get("column_descriptions", {})
    assert summary["column_descriptions"] == {"pais": "Código ISO."}


# 5. Sin ninguna columna con descripción, la clave ni aparece.
def test_sin_column_descriptions_no_aparece_la_clave():
    ds = _dataset([_col("pais"), _col("marca")])
    summary = _dataset_summary(ds)
    assert "column_descriptions" not in summary


# 6. Comportamiento heredado intacto: column_labels y metrics siguen
# funcionando igual que antes de este cambio.
def test_column_labels_y_metrics_siguen_funcionando():
    ds = _dataset(
        [_col("area_c", verbose_name="Área Comercial")],
        metrics=[_metric("total", description="Suma total")],
    )
    summary = _dataset_summary(ds)
    assert summary["column_labels"] == {"area_c": "Área Comercial"}
    assert summary["metrics"] == [
        {"metric_name": "total", "expression": "SUM(x)", "description": "Suma total"}
    ]
