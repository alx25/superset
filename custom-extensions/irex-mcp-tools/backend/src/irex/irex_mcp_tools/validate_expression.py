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
"""Tool MCP de solo lectura: `irex.validate_expression` — prueba una
expresión de métrica o columna ad-hoc contra el dataset real, sin guardar
nada (PLAN_COPILOTO_EXPLORE.md, Fase 4, punto 4).

Encontrada la falta de esto en vivo (sesión real, 2026-09-25): el modelo,
correctamente, se negó a proponer `SUM(cuota)` porque "la configuración
disponible no confirma que cuota exista en este dataset" — sin esta tool
no tenía ninguna forma de comprobarlo."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_validate_expression_core import build_validation_query, validation_result


class ValidateExpressionRequest(BaseModel):
    dataset_id: int = Field(..., gt=0)
    expression: str = Field(..., min_length=1, max_length=2000, description="La expresión SQL exacta a validar, ej. 'SUM(cuota)' o 'UPPER(nombre)'.")
    kind: Literal["metric", "column"] = Field(..., description="'metric' para una métrica ad-hoc (se agrega, ej. SUM/AVG); 'column' para una columna calculada.")


@tool(
    name="irex.validate_expression",
    description=(
        "Prueba si una expresión SQL de métrica o columna es válida para un "
        "dataset — usar ANTES de proponer add_adhoc_metric/add_adhoc_column/"
        "add_dataset_metric/add_calculated_column, nunca después. Ejecuta la "
        "expresión de verdad contra la base (row_limit=1, con RLS y acceso "
        "al dataset), porque una columna que no existe solo falla ahí, no en "
        "la generación del SQL. Devuelve valid=true solo si corrió sin error; "
        "'metric'/'column' determinan si se agrega como métrica o como "
        "columna. No guarda nada ni devuelve las filas — es una verificación."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def validate_expression(request: ValidateExpressionRequest) -> dict[str, Any]:
    from superset import security_manager
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.chart_data import ChartDataResultType
    from superset.common.query_context_factory import QueryContextFactory
    from superset.daos.dataset import DatasetDAO

    dataset = DatasetDAO.find_by_id(request.dataset_id, skip_base_filter=True)
    if dataset is None:
        raise ValueError("El dataset no existe")
    if not security_manager.can_access_datasource(dataset):
        raise PermissionError("Acceso al dataset denegado")

    factory = QueryContextFactory()
    query_context = factory.create(
        datasource={"id": request.dataset_id, "type": "table"},
        queries=[build_validation_query(request.kind, request.expression)],
        form_data={"datasource": f"{request.dataset_id}__table", "viz_type": "table"},
        result_type=ChartDataResultType.FULL,
    )
    command = ChartDataCommand(query_context)
    command.validate()  # raise_for_access() — mismo RLS/RBAC que cualquier ejecución real.
    try:
        result = command.run()
    except Exception as exc:  # noqa: BLE001 - se reporta el mensaje, no se relanza
        return validation_result(dataset_id=request.dataset_id, expression=request.expression, valid=False, error=str(exc))

    query_result = (result or {}).get("queries", [{}])[0]
    error = query_result.get("error")
    if error:
        return validation_result(dataset_id=request.dataset_id, expression=request.expression, valid=False, error=error)
    return validation_result(dataset_id=request.dataset_id, expression=request.expression, valid=True)
