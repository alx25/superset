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
"""Pruebas del núcleo puro de irex.validate_expression."""

from irex.irex_mcp_tools.explore_validate_expression_core import (
    build_validation_query,
    validation_result,
)


class TestBuildValidationQuery:
    def test_metric_arma_la_metrica_sql_con_row_limit_1(self):
        query = build_validation_query("metric", "SUM(cuota)")
        assert query["row_limit"] == 1
        assert query["columns"] == []
        assert len(query["metrics"]) == 1
        assert query["metrics"][0]["sqlExpression"] == "SUM(cuota)"
        assert query["metrics"][0]["expressionType"] == "SQL"

    def test_column_arma_la_columna_sql_con_row_limit_1(self):
        query = build_validation_query("column", "UPPER(nombre)")
        assert query["row_limit"] == 1
        assert query["metrics"] == []
        assert len(query["columns"]) == 1
        assert query["columns"][0]["sqlExpression"] == "UPPER(nombre)"
        assert query["columns"][0]["expressionType"] == "SQL"

    def test_metric_y_column_no_comparten_label(self):
        metric_label = build_validation_query("metric", "SUM(x)")["metrics"][0]["label"]
        column_label = build_validation_query("column", "x")["columns"][0]["label"]
        assert metric_label != column_label


class TestValidationResult:
    def test_valido_no_incluye_campo_error(self):
        result = validation_result(dataset_id=5, expression="SUM(cuota)", valid=True)
        assert result == {"valid": True, "dataset_id": 5, "expression": "SUM(cuota)"}
        assert "error" not in result

    def test_invalido_incluye_el_mensaje_de_error(self):
        result = validation_result(dataset_id=5, expression="SUM(no_existe)", valid=False, error="column \"no_existe\" does not exist")
        assert result["valid"] is False
        assert result["error"] == 'column "no_existe" does not exist'

    def test_nunca_devuelve_filas_ni_datos_calculados(self):
        result = validation_result(dataset_id=5, expression="SUM(cuota)", valid=True)
        assert "rows" not in result
        assert "data" not in result
