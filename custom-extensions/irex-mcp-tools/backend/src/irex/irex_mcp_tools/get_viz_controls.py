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
"""Tool MCP de solo lectura: catálogo de nombres de control válidos por
`viz_type` — ver `explore_viz_controls_core.py` para la fuente y el nivel de
confianza (`specific` para los tres plugins propios, verificado leyendo su
código fuente; `generic` para cualquier otro tipo, el registro compartido de
Superset, no confirmado para ese tipo en particular). Sin acceso a un
dataset ni a un gráfico — no hace falta `form_data_key` ni permisos más allá
de los básicos de la extensión: es un catálogo estático, igual para
cualquier usuario."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_viz_controls_core import resolve_viz_controls


class GetVizControlsRequest(BaseModel):
    viz_type: str = Field(..., min_length=1, max_length=100, description="El viz_type del gráfico, ej. 'table_v3', 'mixed_timeseries'.")


@tool(
    name="irex.get_viz_controls",
    description=(
        "Catálogo de nombres de control válidos para un viz_type — usar "
        "ANTES de proponer un cambio de control (patch_form_data) o de tipo "
        "de gráfico (change_viz_type), para no inventar un nombre de "
        "control que no existe. Devuelve source='specific' (lista exacta, "
        "verificada contra el código fuente real) solo para los tres "
        "plugins propios (table_v3, html_cards, pivot_table_rx1); para "
        "cualquier otro tipo devuelve source='generic' (el catálogo "
        "compartido de Superset, NO verificado específicamente para ese "
        "tipo — puede faltar o sobrar algún control)."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def get_viz_controls(request: GetVizControlsRequest) -> dict[str, Any]:
    return resolve_viz_controls(request.viz_type)
