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
"""Tools MCP de solo lectura que re-ejecutan el `query_context` real
capturado por el navegador para un gráfico de Explore: `irex.explain_chart`
(SQL generado, sin ejecutar contra la base) e `irex.preview_chart`
(resultado real, con RLS). Ver `explore_query_context_core.py` para la
verificación (mismo dataset/gráfico que `irex.get_explore_state`), y
`chart_option.py::_execute_chart_query` para el mismo patrón de ejecución
(`QueryContextFactory`/`ChartDataCommand`) que ya usa esa tool en producción.

Nunca aceptan SQL libre ni reconstruyen el `query_context` a partir de
`form_data` — el que llega es el que el propio plugin del gráfico (nativo o
uno de los tres propios) armó de verdad en el navegador."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .explore_query_context_core import capped_queries, parse_query_context, verify_query_context_matches_state
from .explore_state_core import verified_explore_state

_QUERY_CONTEXT_FIELD = Field(
    ...,
    min_length=1,
    description=(
        "El query_context EXACTO que el navegador capturó al observar la "
        "última ejecución real del gráfico (POST /api/v1/chart/data) — nunca "
        "se arma a mano ni se adivina desde form_data; se re-ejecuta tal cual "
        "bajo el control de acceso (RLS) del usuario actual. Sin esta captura "
        "disponible, no hay query_context fiel que pasar."
    ),
)


class ExploreChartQueryRequest(BaseModel):
    form_data_key: str = Field(..., min_length=1, max_length=256, description="La misma key que verificó irex.get_explore_state.")
    query_context: str = _QUERY_CONTEXT_FIELD


class PreviewChartRequest(ExploreChartQueryRequest):
    row_limit: int = Field(100, ge=1, le=5000, description="Tope de filas — nunca mayor al que ya trae el query_context capturado.")


def _verified_state(form_data_key: str) -> dict[str, Any]:
    from superset import security_manager
    from superset.commands.explore.form_data.utils import check_access
    from superset.extensions import cache_manager
    from superset.utils.core import DatasourceType

    state = cache_manager.explore_form_data_cache.get(form_data_key)
    return verified_explore_state(
        form_data_key,
        state,
        can_access=security_manager.can_access,
        check_access=lambda dataset_id, chart_id, datasource_type: check_access(
            dataset_id, chart_id, DatasourceType(datasource_type)
        ),
        is_admin=security_manager.is_admin,
    )


def _verified_query_context(request: ExploreChartQueryRequest) -> tuple[dict[str, Any], dict[str, Any]]:
    """Verificación en dos capas, en este orden: (1) `form_data_key` prueba
    acceso al dataset/gráfico igual que `get_explore_state`; (2) el
    `query_context` capturado se compara contra ESE estado ya verificado
    (mismo dataset, mismo gráfico si ambos lo declaran) — nunca se confía
    en el `query_context` por sí solo, viene de un cliente."""
    state = _verified_state(request.form_data_key)
    query_context = parse_query_context(request.query_context)
    verify_query_context_matches_state(query_context, state)
    return state, query_context


def _run(query_context: dict[str, Any], *, queries: list[dict[str, Any]], result_type: "Any") -> dict[str, Any]:
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    factory = QueryContextFactory()
    built = factory.create(
        datasource=query_context["datasource"],
        queries=queries,
        form_data=query_context["form_data"],
        result_type=result_type,
        force=bool(query_context.get("force")),
    )
    command = ChartDataCommand(built)
    command.validate()  # `raise_for_access()` — mismo RLS/RBAC que cualquier ejecución real.
    result = command.run()
    return (result or {}).get("queries", [{}])[0]


@tool(
    name="irex.explain_chart",
    description=(
        "Genera el SQL real de un gráfico de Explore a partir de su "
        "query_context capturado, SIN ejecutarlo contra la base (solo "
        "genera el texto — igual de seguro que irex.explain_query, más "
        "barato: ni siquiera corre EXPLAIN). Requiere primero "
        "irex.get_explore_state para obtener/confirmar la form_data_key, y "
        "un query_context capturado del navegador — no acepta SQL libre ni "
        "lo arma a partir de form_data."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def explain_chart(request: ExploreChartQueryRequest) -> dict[str, Any]:
    from superset.common.chart_data import ChartDataResultType

    state, query_context = _verified_query_context(request)
    query_result = _run(query_context, queries=query_context["queries"], result_type=ChartDataResultType.QUERY)
    if query_result.get("error"):
        return {"status": "error", "error": query_result["error"], "datasource": state["datasource"]}
    return {
        "status": "success",
        "sql": query_result.get("query"),
        "language": query_result.get("language"),
        "datasource": state["datasource"],
        "slice_id": state["slice_id"],
    }


@tool(
    name="irex.preview_chart",
    description=(
        "Devuelve el resultado REAL (no samples) de un gráfico de Explore a "
        "partir de su query_context capturado, con RLS y un tope de filas — "
        "nunca ejecuta SQL libre ni reconstruye el query_context. Requiere "
        "primero irex.get_explore_state y un query_context capturado del "
        "navegador."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def preview_chart(request: PreviewChartRequest) -> dict[str, Any]:
    from superset.common.chart_data import ChartDataResultType

    state, query_context = _verified_query_context(request)
    queries = capped_queries(query_context, request.row_limit)
    query_result = _run(query_context, queries=queries, result_type=ChartDataResultType.FULL)
    if query_result.get("error"):
        return {"status": "error", "error": query_result["error"], "datasource": state["datasource"]}
    rows = query_result.get("data") or []
    return {
        "status": "success",
        "sql": query_result.get("query"),
        "columns": query_result.get("colnames") or [],
        "coltypes": query_result.get("coltypes") or [],
        "rows": rows,
        "rowcount": query_result.get("rowcount", len(rows)),
        "truncated": len(rows) >= request.row_limit,
        "applied_filters": query_result.get("applied_filters") or [],
        "rejected_filters": query_result.get("rejected_filters") or [],
        "datasource": state["datasource"],
        "slice_id": state["slice_id"],
    }
