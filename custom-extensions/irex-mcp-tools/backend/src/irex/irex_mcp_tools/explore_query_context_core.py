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
"""Verificación de un `query_context` capturado por el navegador contra el
estado ya verificado de Explore (`explore_state_core.verified_explore_state`).

No reconstruye ni "adivina" el `query_context` — lo recibe TAL CUAL lo
capturó el navegador al observar el `POST /api/v1/chart/data` real que
Explore mandó (mismo `buildQuery` de cada plugin, nativo o propio; ver
`frontend/src/hosts/exploreQueryCapture.ts`). Solo confirma que referencia
el MISMO dataset (y, si aplica, el mismo gráfico) que el estado ya
verificado, antes de dejarlo pasar a re-ejecutarse por el pipeline real de
Superset (`QueryContextFactory`/`ChartDataCommand`, ver `chart_option.py`),
que aplica RLS igual que cualquier otra ejecución — la verificación
"independiente" que pide el contrato v1 (`docs/explore-assistant-contract.md`)
es justamente esa re-ejecución, no un chequeo de forma."""

from __future__ import annotations

import json
from typing import Any


def parse_query_context(raw: str) -> dict[str, Any]:
    """JSON crudo → dict, con los chequeos de forma mínimos que hacen falta
    para poder pasarlo a `QueryContextFactory.create(**...)`. No valida el
    contenido de `queries[]` — eso lo hace Superset al construir el
    `QueryContext` real."""
    try:
        context = json.loads(raw)
    except ValueError as exc:
        raise ValueError("query_context no es JSON válido") from exc
    if not isinstance(context, dict):
        raise ValueError("query_context debe ser un objeto")
    if not isinstance(context.get("datasource"), dict):
        raise ValueError("query_context sin datasource")
    queries = context.get("queries")
    if not isinstance(queries, list) or not queries or not all(isinstance(q, dict) for q in queries):
        raise ValueError("query_context sin queries")
    if not isinstance(context.get("form_data"), dict):
        raise ValueError("query_context sin form_data")
    return context


def verify_query_context_matches_state(query_context: dict[str, Any], verified_state: dict[str, Any]) -> None:
    """Compara SOLO lo que es seguro comparar: el dataset (id + tipo) y,
    si los dos lo declaran, el gráfico. El `form_data` del query_context NO
    se compara contra el del estado persistido — Explore arma el request
    desde controles normalizados mientras la URL persiste el estado crudo
    del editor; no son la misma representación (mismo criterio ya
    documentado en `exploreQueryCapture.ts`)."""
    datasource = query_context["datasource"]
    expected = verified_state["datasource"]
    if datasource.get("id") != expected["id"] or datasource.get("type") != expected["type"]:
        raise ValueError("El query_context no corresponde al dataset verificado por form_data_key")

    verified_slice_id = verified_state.get("slice_id")
    query_context_slice_id = query_context["form_data"].get("slice_id")
    if verified_slice_id is not None and query_context_slice_id is not None and verified_slice_id != query_context_slice_id:
        raise ValueError("El query_context no corresponde al gráfico verificado por form_data_key")


def capped_queries(query_context: dict[str, Any], row_limit: int) -> list[dict[str, Any]]:
    """Copia `queries[]` con `row_limit` acotado a como máximo `row_limit`
    en cada query — el query_context capturado puede pedir uno mayor (el
    que usa Explore para su propia grilla), pero la vista previa del
    asistente no debe devolver más filas de las pedidas explícitamente."""
    capped: list[dict[str, Any]] = []
    for query in query_context["queries"]:
        item = dict(query)
        current = item.get("row_limit")
        item["row_limit"] = min(current, row_limit) if isinstance(current, int) and current > 0 else row_limit
        capped.append(item)
    return capped
