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
"""Tool MCP de lectura del estado persistido de un gráfico en Explore."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_state_core import verified_explore_state


class GetExploreStateRequest(BaseModel):
    """Key de Explore provista por el backend del chat tras autenticar al usuario."""

    form_data_key: str = Field(..., min_length=1, max_length=256)


@tool(
    name="irex.get_explore_state",
    description=(
        "Lee el form_data persistido de Explore para una form_data_key, "
        "comprueba permisos sobre Explore, gráfico y dataset, y devuelve "
        "el rol Admin del usuario autenticado. state_kind=last_persisted: "
        "la key por sí sola no demuestra que ese estado se ejecutó."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def get_explore_state(request: GetExploreStateRequest) -> dict[str, Any]:
    """Obtiene el estado desde la caché de Superset bajo la identidad MCP."""
    from superset import security_manager
    from superset.commands.explore.form_data.utils import check_access
    from superset.extensions import cache_manager
    from superset.utils.core import DatasourceType

    state = cache_manager.explore_form_data_cache.get(request.form_data_key)
    return verified_explore_state(
        request.form_data_key,
        state,
        can_access=security_manager.can_access,
        check_access=lambda dataset_id, chart_id, datasource_type: check_access(
            dataset_id, chart_id, DatasourceType(datasource_type)
        ),
        is_admin=security_manager.is_admin,
    )
