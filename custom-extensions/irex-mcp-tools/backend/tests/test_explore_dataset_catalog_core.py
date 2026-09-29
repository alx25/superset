# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Pruebas del núcleo puro de irex.get_dataset_catalog.

Los permisos y la resolución de datasource/key (incluido gráfico sin
guardar, key vencida, dataset/chart inválido) ya están cubiertos por
`test_explore_state_core.py` — `get_dataset_catalog.py` reusa
`verified_explore_state` SIN modificarla, así que no se duplican esos
casos acá. Lo que es nuevo de esta tool es la forma del catálogo mismo."""

from irex.irex_mcp_tools.explore_dataset_catalog_core import (
    MAX_CATALOG_COLUMNS,
    MAX_CATALOG_METRICS,
    dataset_catalog,
)


def column(name, **overrides):
    base = {"column_name": name, "type": "VARCHAR", "verbose_name": None, "description": None, "expression": None, "is_dttm": False}
    base.update(overrides)
    return base


def metric(name, expression="COUNT(*)", **overrides):
    base = {"metric_name": name, "expression": expression, "verbose_name": None, "description": None}
    base.update(overrides)
    return base


class TestDatasetCatalog:
    def test_columna_minima_solo_trae_nombre_y_tipo(self):
        result = dataset_catalog([column("cuota", type="DOUBLE")], [])
        assert result["columns"] == [{"name": "cuota", "type": "DOUBLE"}]

    def test_columna_con_label_y_descripcion_las_incluye(self):
        result = dataset_catalog(
            [column("cuota", type="DOUBLE", verbose_name="Cuota mensual", description="Meta de venta asignada")], []
        )
        assert result["columns"] == [
            {"name": "cuota", "type": "DOUBLE", "label": "Cuota mensual", "description": "Meta de venta asignada"}
        ]

    def test_columna_calculada_incluye_is_calculated_y_expression(self):
        result = dataset_catalog([column("margen_pct", expression="(venta - costo) / venta")], [])
        entry = result["columns"][0]
        assert entry["is_calculated"] is True
        assert entry["expression"] == "(venta - costo) / venta"

    def test_columna_fisica_no_trae_is_calculated_ni_expression(self):
        entry = dataset_catalog([column("cuota")], [])["columns"][0]
        assert "is_calculated" not in entry
        assert "expression" not in entry

    def test_columna_temporal_marca_is_temporal(self):
        entry = dataset_catalog([column("fecha_id", is_dttm=True)], [])["columns"][0]
        assert entry["is_temporal"] is True

    def test_columna_no_temporal_no_trae_la_clave(self):
        entry = dataset_catalog([column("cuota")], [])["columns"][0]
        assert "is_temporal" not in entry

    def test_metrica_guardada_siempre_trae_expression(self):
        result = dataset_catalog([], [metric("count", expression="COUNT(*)")])
        assert result["metrics"] == [{"name": "count", "expression": "COUNT(*)"}]

    def test_metrica_con_label_y_descripcion(self):
        result = dataset_catalog([], [metric("cumplimiento", expression="SUM(sell_in)/SUM(cuota)", verbose_name="Cumplimiento (%)", description="% de la cuota alcanzado")])
        assert result["metrics"] == [
            {"name": "cumplimiento", "expression": "SUM(sell_in)/SUM(cuota)", "label": "Cumplimiento (%)", "description": "% de la cuota alcanzado"}
        ]

    def test_columnas_y_metricas_se_ordenan_por_nombre(self):
        result = dataset_catalog([column("zeta"), column("alfa")], [metric("zeta_m"), metric("alfa_m")])
        assert [c["name"] for c in result["columns"]] == ["alfa", "zeta"]
        assert [m["name"] for m in result["metrics"]] == ["alfa_m", "zeta_m"]

    def test_sin_columnas_ni_metricas_no_trunca(self):
        result = dataset_catalog([], [])
        assert result == {"columns": [], "metrics": [], "truncated": False}

    def test_catalogo_dentro_del_limite_no_trunca(self):
        columns = [column(f"col_{i}") for i in range(MAX_CATALOG_COLUMNS)]
        result = dataset_catalog(columns, [])
        assert len(result["columns"]) == MAX_CATALOG_COLUMNS
        assert result["truncated"] is False

    def test_catalogo_de_columnas_por_encima_del_limite_trunca_y_lo_declara(self):
        columns = [column(f"col_{i:04d}") for i in range(MAX_CATALOG_COLUMNS + 5)]
        result = dataset_catalog(columns, [])
        assert len(result["columns"]) == MAX_CATALOG_COLUMNS
        assert result["truncated"] is True

    def test_catalogo_de_metricas_por_encima_del_limite_trunca_y_lo_declara(self):
        metrics = [metric(f"m_{i:04d}") for i in range(MAX_CATALOG_METRICS + 3)]
        result = dataset_catalog([], metrics)
        assert len(result["metrics"]) == MAX_CATALOG_METRICS
        assert result["truncated"] is True
