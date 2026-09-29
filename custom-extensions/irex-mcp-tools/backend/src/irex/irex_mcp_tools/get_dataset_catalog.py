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
"""Tool MCP de lectura: `irex.get_dataset_catalog` — columnas y métricas
guardadas REALES del dataset del gráfico identificado por `form_data_key`.

Ampliación de Fase 4 (PLAN_COPILOTO_EXPLORE.md), a pedido del agente del
backend del chat (2026-09-25): sin esto, el modelo solo podía comprobar
una expresión a la vez (`irex.validate_expression`), y terminaba
preguntándole al usuario por columnas que ya existían, o adivinando mal
(ver `explore_dataset_catalog_core.py` para el caso real que motivó esto).
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_dataset_catalog_core import dataset_catalog
from .explore_state_core import verified_explore_state


class GetDatasetCatalogRequest(BaseModel):
    """Misma key de Explore que `irex.get_explore_state` — el catálogo
    queda atado al datasource de ESE estado verificado, nunca a un
    dataset_id suelto: evita que se pida el catálogo de un dataset
    arbitrario sin pasar por la comprobación de acceso al gráfico."""

    form_data_key: str = Field(..., min_length=1, max_length=256)


@tool(
    name="irex.get_dataset_catalog",
    description=(
        "Catálogo verificado de columnas y métricas guardadas del dataset "
        "del gráfico identificado por form_data_key — nombres reales, "
        "tipos, etiquetas y descripciones cuando existen; las métricas "
        "guardadas incluyen su expresión SQL. Llamar ANTES de preguntarle "
        "al usuario qué columna representa algo, o de adivinar un nombre "
        "al armar una expresión para validate_expression — es la forma de "
        "confirmar qué existe de verdad en el dataset, para cualquier "
        "gráfico (incluido uno sin guardar). No prueba ejecución ni "
        "guarda nada: nunca devuelve filas, y state_kind sigue siendo "
        "last_persisted. Si 'truncated'=true, la lista de columnas o "
        "métricas está incompleta — no asumir que un nombre no existe "
        "solo porque no aparece."
    ),
    tags=["irex", "explore", "chart", "dataset", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def get_dataset_catalog(request: GetDatasetCatalogRequest) -> dict[str, Any]:
    from superset import security_manager
    from superset.commands.explore.form_data.utils import check_access
    from superset.daos.dataset import DatasetDAO
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

    # El acceso al dataset ya lo verificó `check_access` de arriba
    # (`superset.explore.utils.check_access` → `check_datasource_access`,
    # el mismo camino real que usa Explore) — `skip_base_filter` acá es
    # solo para CARGAR el objeto, no una segunda comprobación de permisos.
    dataset_id = verified["datasource"]["id"]
    dataset = DatasetDAO.find_by_id(dataset_id, skip_base_filter=True)
    if dataset is None:
        raise ValueError("El dataset no existe")

    columns = [
        {
            "column_name": column.column_name,
            "type": column.type,
            "verbose_name": column.verbose_name,
            "description": column.description,
            "expression": column.expression,
            "is_dttm": column.is_dttm,
        }
        for column in dataset.columns
        if column.is_active is not False  # None cuenta como activa (default histórico de la columna)
    ]
    metrics = [
        {
            "metric_name": metric.metric_name,
            "expression": metric.expression,
            "verbose_name": metric.verbose_name,
            "description": metric.description,
        }
        for metric in dataset.metrics
    ]

    return {
        "form_data_key": verified["form_data_key"],
        "slice_id": verified["slice_id"],
        "datasource": verified["datasource"],
        "state_kind": verified["state_kind"],
        **dataset_catalog(columns, metrics),
    }
