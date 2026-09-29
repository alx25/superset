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
"""Tool MCP de lectura: `irex.validate_calculated_column_formula` —
verifica una fórmula de `calculated_columns` de `table_v3` (lenguaje
propio, evaluado en el navegador, NUNCA SQL) antes de proponerla.

Ampliación de Fase 6 (PLAN_COPILOTO_EXPLORE.md), a pedido del usuario
(2026-09-25): "en la tableV3 puedo usar jinja en varias opciones...
necesito que el LLM pueda verlos e interactuar". `irex.validate_expression`
no sirve para esto — ver `explore_calculated_column_core.py` para el
detalle de por qué y qué SÍ verifica esta tool."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_calculated_column_core import formula_validation_result, known_calculated_column_names
from .explore_state_core import verified_explore_state


class ValidateCalculatedColumnFormulaRequest(BaseModel):
    """Misma key que `irex.get_explore_state` — los nombres disponibles
    para la fórmula (columnas agrupadas, etiquetas de métricas) salen del
    ESTADO VERIFICADO, no de lo que el modelo crea recordar."""

    form_data_key: str = Field(..., min_length=1, max_length=256)
    expression: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description=(
            "La fórmula de calculated_columns a verificar, tal cual se escribiría en Explore. "
            "Ej. '{{Venta}} - {{Costo}}' o 'IF({{Cuota}} = 0, 0, {{Venta}}/{{Cuota}})'."
        ),
    )


@tool(
    name="irex.validate_calculated_column_formula",
    description=(
        "Verifica una fórmula de calculated_columns de table_v3 (lenguaje propio "
        "con referencias {{Columna}}/scope.{{Columna}} y funciones IF/OR/AND/NOT/"
        "ISBLANK/ABS/ROUND/MAX/MIN — NUNCA SQL, se evalúa en el navegador) ANTES de "
        "proponerla con patch_form_data sobre el control calculated_columns. Usar "
        "SIEMPRE antes de proponer una fórmula nueva o editar una existente: una "
        "referencia a una columna/métrica que no existe, o una función mal escrita, "
        "NO da error visible en el gráfico — la fórmula queda en blanco en silencio "
        "en todas las filas, sin ningún aviso. 'valid': true significa que las "
        "referencias existen en el gráfico y la estructura (llaves/paréntesis) es "
        "sana — NO ejecuta la fórmula ni confirma qué valor calcula, eso solo se ve "
        "en el navegador con datos reales. Rechaza cualquier identificador fuera de {{}} "
        "que no sea una de esas funciones exactas en mayúsculas (ej. un nombre mal escrito "
        "o en minúscula) — el compilador real usa new Function() sin aislar del navegador, "
        "así que un identificador desconocido no es solo un error de tipeo, es un riesgo. "
        "No usar para jinja_fields (son SQL, usar "
        "validate_expression) ni para metricFormulas de pivot_table_rx1 (mecanismo "
        "distinto, no cubierto todavía). Si la fórmula usa el alcance total.{{...}}, "
        "'warnings' avisa si el gráfico no tiene show_totals activo todavía — sin eso, "
        "total.{{...}} resuelve siempre a nulo y la fórmula da siempre el mismo "
        "resultado aunque sea estructuralmente válida (encontrado en vivo, sesión real)."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def validate_calculated_column_formula(request: ValidateCalculatedColumnFormulaRequest) -> dict[str, Any]:
    from superset import security_manager
    from superset.commands.explore.form_data.utils import check_access
    from superset.extensions import cache_manager
    from superset.utils.core import DatasourceType

    state = cache_manager.explore_form_data_cache.get(request.form_data_key)
    verified = verified_explore_state(
        request.form_data_key,
        state,
        can_access=security_manager.can_access,
        check_access=lambda dataset_id, chart_id, datasource_type: check_access(
            dataset_id, chart_id, DatasourceType(datasource_type)
        ),
        is_admin=security_manager.is_admin,
    )
    known_names = known_calculated_column_names(verified["form_data"])
    show_totals_enabled = bool(verified["form_data"].get("show_totals"))
    return formula_validation_result(request.expression, known_names, show_totals_enabled=show_totals_enabled)
