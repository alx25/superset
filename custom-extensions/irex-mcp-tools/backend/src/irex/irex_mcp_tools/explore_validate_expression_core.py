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
"""Núcleo puro de `irex.validate_expression` (PLAN_COPILOTO_EXPLORE.md,
Fase 4, punto 4): arma la query mínima para probar una expresión de
métrica o columna ad-hoc contra el dataset real — la MISMA forma que usa
Explore cuando el usuario escribe una métrica/columna SQL a mano en su
propia UI (`expressionType: "SQL"`, ver
`superset-frontend/src/explore/components/controls/MetricControl/...`).
No es una validación "de mentira": `row_limit: 1` la ejecuta de verdad
contra la base (vía `QueryContextFactory`/`ChartDataCommand`, mismo
pipeline que `explain_chart`/`preview_chart` y `chart_option.py`), porque
una columna que no existe recién falla en el motor de la base, no en la
generación del SQL — pedir solo el SQL generado (`result_type=query`) no
alcanzaría para detectarlo."""

from __future__ import annotations

from typing import Any, Literal

ValidationKind = Literal["metric", "column"]

# Label interno, no elegible por el usuario ni visible en el gráfico —
# solo existe para que la respuesta tenga una columna que leer.
_METRIC_LABEL = "__irex_validate_metric__"
_COLUMN_LABEL = "__irex_validate_column__"


def build_validation_query(kind: ValidationKind, expression: str) -> dict[str, Any]:
    """La query de una sola query_object, `row_limit=1` — ni guarda nada
    ni cambia el gráfico; es una ejecución de descarte."""
    if kind == "metric":
        return {
            "metrics": [{"expressionType": "SQL", "sqlExpression": expression, "label": _METRIC_LABEL}],
            "columns": [],
            "row_limit": 1,
        }
    return {
        "metrics": [],
        "columns": [{"expressionType": "SQL", "sqlExpression": expression, "label": _COLUMN_LABEL}],
        "row_limit": 1,
    }


def validation_result(*, dataset_id: int, expression: str, valid: bool, error: str | None = None) -> dict[str, Any]:
    """Forma exacta de la respuesta — `valid: true` solo cuando la
    ejecución de descarte corrió sin error; nunca devuelve las filas
    (es una verificación, no una vista previa)."""
    result: dict[str, Any] = {"valid": valid, "dataset_id": dataset_id, "expression": expression}
    if error is not None:
        result["error"] = error
    return result
