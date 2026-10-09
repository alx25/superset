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
"""Tool MCP de lectura: `irex.resolve_temporal_expression` — expresión SQL
para agrupar una columna temporal del dataset del gráfico por una
granularidad, construida por Superset para el motor real.

No recibe SQL libre ni guarda nada: recibe la revisión del gráfico
(`form_data_key`), un nombre de columna y un id de granularidad; ver
`explore_temporal_core.py`."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_state_core import verified_explore_state
from .explore_temporal_core import resolve_temporal_expression as resolve_core


class ResolveTemporalExpressionRequest(BaseModel):
    form_data_key: str = Field(
        ...,
        min_length=1,
        max_length=256,
        description="Revisión actual del gráfico (la misma key de irex.get_explore_state / get_dataset_catalog).",
    )
    column_name: str = Field(
        ...,
        min_length=1,
        max_length=256,
        description="Nombre EXACTO de una columna temporal del dataset (ver irex.get_dataset_catalog).",
    )
    time_grain: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description=(
            "Id de granularidad tal como aparece en query_capabilities.time_grains de "
            "irex.get_dataset_catalog (ISO 8601, ej. 'P1D' día, 'P1M' mes)."
        ),
    )


def _compile_with_dialect(dataset: Any) -> Any:
    def compile_expression(column: Any, time_grain: str) -> str:
        template_processor = None
        if column.expression and ("{{" in column.expression or "{%" in column.expression):
            template_processor = dataset.get_template_processor()
        expr = column.get_timestamp_expression(time_grain=time_grain, template_processor=template_processor)
        # `make_sqla_column_compatible` lo envuelve en un Label ("... AS __timestamp");
        # se compila la expresión sin el alias.
        element = getattr(expr, "element", expr)
        compiled = element.compile(
            dialect=dataset.database.get_dialect(), compile_kwargs={"literal_binds": True}
        )
        return str(compiled)

    return compile_expression


@tool(
    name="irex.resolve_temporal_expression",
    description=(
        "Devuelve la expresión SQL EXACTA para agrupar una columna temporal del "
        "dataset del gráfico por una granularidad (día, mes, ...), construida por "
        "Superset con el mecanismo nativo del motor — la misma que usaría Explore "
        "con ese 'Time grain'. Recibe form_data_key (revisión actual), column_name "
        "y time_grain (un id de query_capabilities.time_grains de "
        "irex.get_dataset_catalog). No recibe SQL, no ejecuta nada ni guarda nada: "
        "status='generated' significa generada, NO validada — comprobarla con "
        "irex.validate_expression (kind='column', ver next_step) antes de "
        "proponerla. Otros status: column_not_found, column_not_temporal, "
        "time_grain_not_supported (incluye supported_time_grains), unsupported, "
        "invalid_revision, permission_denied, error."
    ),
    tags=["irex", "explore", "chart", "dataset", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def resolve_temporal_expression(request: ResolveTemporalExpressionRequest) -> dict[str, Any]:
    from superset import security_manager
    from superset.commands.explore.form_data.utils import check_access
    from superset.daos.dataset import DatasetDAO
    from superset.extensions import cache_manager
    from superset.utils.core import DatasourceType

    state = cache_manager.explore_form_data_cache.get(request.form_data_key)
    try:
        verified = verified_explore_state(
            request.form_data_key,
            state,
            can_access=security_manager.can_access,
            check_access=lambda dataset_id, chart_id, datasource_type: check_access(
                dataset_id, chart_id, DatasourceType(datasource_type)
            ),
            is_admin=security_manager.is_admin,
        )
    except PermissionError as exc:
        return {"status": "permission_denied", "detail": str(exc), "form_data_key": request.form_data_key}
    except (KeyError, ValueError) as exc:
        return {
            "status": "invalid_revision",
            "detail": str(exc).strip("'\""),
            "form_data_key": request.form_data_key,
        }

    # Acceso ya verificado por `check_access` (mismo camino que Explore);
    # `skip_base_filter` solo para cargar el objeto.
    dataset = DatasetDAO.find_by_id(verified["datasource"]["id"], skip_base_filter=True)
    if dataset is None:
        return {"status": "invalid_revision", "detail": "El dataset de esta revisión ya no existe.",
                "form_data_key": request.form_data_key}

    return resolve_core(
        verified=verified,
        dataset=dataset,
        column_name=request.column_name,
        time_grain=request.time_grain,
        compile_expression=_compile_with_dialect(dataset),
    )
