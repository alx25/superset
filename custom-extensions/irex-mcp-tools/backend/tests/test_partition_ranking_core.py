"""Tests del núcleo de irex.rank_partitions — fixtures sintéticos, sin Superset.

Correr con:
  cd superset_v6_1_0/irex-mcp-tools/backend
  ../../.venv/bin/python -m pytest tests/ -q
"""

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from irex.irex_mcp_tools.partition_ranking_core import (  # noqa: E402
    compute_partition_ranking,
    rows_to_numeric_df,
    validate_inputs,
)


def _df(rows):
    return rows_to_numeric_df(rows, pd)


def _types(df):
    return {
        str(c): "number" if pd.api.types.is_numeric_dtype(df[c].dtype) else "text"
        for c in df.columns
    }


# Caso base de la propuesta: NULL unilateral no hace desaparecer filas.
BASE_ROWS = [
    {"area": "A", "producto": "X", "plan": 100, "proy": 120},
    {"area": "A", "producto": "Y", "plan": None, "proy": 50},
    {"area": "A", "producto": "Z", "plan": 30, "proy": None},
]


def _run(rows, **overrides):
    params = dict(
        partition_by=["area"],
        detail_by=["producto"],
        metric_a="plan",
        metric_b="proy",
        rank_by="abs_delta",
        direction="desc",
        top_n=10,
    )
    params.update(overrides)
    return compute_partition_ranking(_df(rows), **params)


def test_caso_base_deltas_y_totales():
    result = _run(BASE_ROWS)
    deltas = {r["producto"]: r["delta"] for r in result["rows"]}
    assert deltas == {"X": -20, "Y": -50, "Z": 30}

    (total,) = result["partition_totals"]
    assert total["plan_total"] == 130
    assert total["proy_total"] == 170
    assert total["delta_total"] == -40
    assert total["detail_row_count"] == 3

    rec = result["reconciliation"]
    assert rec["status"] == "ok"
    assert rec["partitions_checked"] == rec["partitions_reconciled"] == 1
    assert rec["details"] == []


def test_caso_base_top2_por_abs_delta_no_altera_el_total():
    result = _run(BASE_ROWS, top_n=2)
    assert [r["producto"] for r in result["rows"]] == ["Y", "Z"]
    (total,) = result["partition_totals"]
    # El total de la partición sigue siendo -40 (universo completo), no -20
    # (la suma del Top-2 es -50+30=-20 y queda en top_n_delta_sum).
    assert total["delta_total"] == -40
    assert total["top_n_row_count"] == 2
    assert total["top_n_delta_sum"] == -20
    assert total["remaining_delta"] == -20


def test_null_diagnostics_caso_base():
    diag = _run(BASE_ROWS)["null_diagnostics"]
    assert diag["metric_a_null_rows"] == 1
    assert diag["metric_b_null_rows"] == 1
    assert diag["only_metric_a_rows"] == 1
    assert diag["only_metric_b_rows"] == 1
    assert diag["both_null_rows"] == 0
    assert diag["excluded_rows"] == 0


def test_varias_particiones_top_n_por_particion():
    rows = BASE_ROWS + [
        {"area": "B", "producto": "P", "plan": 10, "proy": 5},
        {"area": "B", "producto": "Q", "plan": 1, "proy": 2},
        {"area": "B", "producto": "R", "plan": 7, "proy": 4},
    ]
    result = _run(rows, top_n=1)
    # top_n=1 se aplica DENTRO de cada partición: una fila por área.
    assert [(r["area"], r["producto"]) for r in result["rows"]] == [
        ("A", "Y"),
        ("B", "P"),
    ]
    totals = {t["area"]: t for t in result["partition_totals"]}
    assert totals["A"]["delta_total"] == -40
    assert totals["B"]["delta_total"] == 7
    assert result["reconciliation"]["partitions_checked"] == 2
    assert result["reconciliation"]["partitions_reconciled"] == 2


def test_empate_en_ranking_es_deterministico():
    rows = [
        {"area": "A", "producto": "M", "plan": 10, "proy": 0},
        {"area": "A", "producto": "K", "plan": 10, "proy": 0},
    ]
    result = _run(rows, top_n=1)
    # Mismo abs_delta — desempata por la dimensión de detalle (K < M).
    assert [r["producto"] for r in result["rows"]] == ["K"]
    result2 = _run(rows, top_n=1)
    assert result["rows"] == result2["rows"]


def test_denominador_cero_variation_pct_none():
    rows = [{"area": "A", "producto": "X", "plan": 50, "proy": None}]
    (total,) = _run(rows)["partition_totals"]
    assert total["proy_total"] == 0
    assert total["variation_pct"] is None


def test_ambas_metricas_nulas_participa_con_delta_cero():
    rows = BASE_ROWS + [{"area": "A", "producto": "W", "plan": None, "proy": None}]
    result = _run(rows)
    deltas = {r["producto"]: r["delta"] for r in result["rows"]}
    assert deltas["W"] == 0
    assert result["null_diagnostics"]["both_null_rows"] == 1
    (total,) = result["partition_totals"]
    assert total["delta_total"] == -40
    assert total["detail_row_count"] == 4


def test_top_n_mayor_que_filas():
    result = _run(BASE_ROWS, top_n=50)
    assert len(result["rows"]) == 3


def test_particion_global_sin_partition_by():
    result = _run(BASE_ROWS, partition_by=[], top_n=2)
    assert [r["producto"] for r in result["rows"]] == ["Y", "Z"]
    (total,) = result["partition_totals"]
    assert total["delta_total"] == -40


def test_nombres_con_espacios_y_caracteres_especiales():
    rows = [
        {"área comercial": "A", "marca familia": "M1",
         "SUM(plan)": 100, "SUM(proy)": 120},
        {"área comercial": "A", "marca familia": "M2",
         "SUM(plan)": None, "SUM(proy)": 50},
    ]
    result = _run(
        rows,
        partition_by=["área comercial"],
        detail_by=["marca familia"],
        metric_a="SUM(plan)",
        metric_b="SUM(proy)",
    )
    deltas = {r["marca familia"]: r["delta"] for r in result["rows"]}
    assert deltas == {"M1": -20, "M2": -50}


def test_rank_by_metric_a_direcciones():
    desc = _run(BASE_ROWS, rank_by="metric_a", direction="desc")
    assert [r["producto"] for r in desc["rows"]] == ["X", "Z", "Y"]
    asc = _run(BASE_ROWS, rank_by="metric_a", direction="asc")
    assert [r["producto"] for r in asc["rows"]] == ["Y", "Z", "X"]


def test_rank_by_delta_captura_contrario_al_total():
    # delta desc pone primero la fila que va CONTRA el total negativo (Z=+30).
    result = _run(BASE_ROWS, rank_by="delta", direction="desc", top_n=1)
    assert result["rows"][0]["producto"] == "Z"


@pytest.mark.parametrize(
    "kwargs,fragment",
    [
        (dict(metric_a="no_existe"), "no existe en la fuente"),
        (dict(metric_a="producto"), "no es numérica"),
        (dict(metric_a="proy", metric_b="proy"), "distintas"),
        (dict(partition_by=["area"], detail_by=["area"]), "compartir columnas"),
        (dict(detail_by=["fantasma"]), "no existe en la fuente"),
        (dict(rank_by="variation_pct"), "rank_by inválido"),
    ],
)
def test_validaciones(kwargs, fragment):
    df = _df(BASE_ROWS)
    params = dict(
        partition_by=["area"],
        detail_by=["producto"],
        metric_a="plan",
        metric_b="proy",
        rank_by="abs_delta",
    )
    params.update(kwargs)
    error = validate_inputs(list(df.columns), _types(df), **params)
    assert error is not None and fragment in error


def test_rows_usan_alias_reales_no_genericos():
    result = _run(BASE_ROWS)
    row = result["rows"][0]
    assert "plan" in row and "proy" in row
    assert "metric_a" not in row and "metric_b" not in row
    assert set(row) == {"area", "producto", "plan", "proy", "delta", "abs_delta", "rank"}
    (total,) = result["partition_totals"]
    assert "plan_total" in total and "proy_total" in total
    assert "metric_a_total" not in total


def test_totales_con_alias_de_caracteres_especiales():
    rows = [
        {"area": "A", "m": "M1", "SUM(plan)": 100, "SUM(proy)": 120},
    ]
    result = _run(
        rows, detail_by=["m"], metric_a="SUM(plan)", metric_b="SUM(proy)"
    )
    (total,) = result["partition_totals"]
    assert total["SUM(plan)_total"] == 100
    assert total["SUM(proy)_total"] == 120


@pytest.mark.parametrize("reserved", ["delta", "abs_delta", "rank", "__pr_x"])
def test_nombres_reservados_rechazados(reserved):
    rows = [{"area": "A", reserved: "d1", "plan": 1, "proy": 2}]
    df = _df(rows)
    error = validate_inputs(
        list(df.columns), _types(df),
        partition_by=["area"], detail_by=[reserved],
        metric_a="plan", metric_b="proy", rank_by="abs_delta",
    )
    assert error is not None and "reservado" in error
