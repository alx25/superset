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
"""Núcleo puro de `irex.get_dataset_catalog` (PLAN_COPILOTO_EXPLORE.md,
ampliación de Fase 4, a pedido del agente del backend del chat, 2026-09-25):
reduce columnas/métricas ORM de un dataset a nombres reales verificados.

Encontrado en vivo (sesión `explore-2287e800...`): el usuario pidió una
métrica sobre "cuota"; el modelo recibió el datasource y
`verified_named_columns: ["sell_in"]` (una búsqueda parcial del lado del
chat, no un catálogo), y preguntó qué columna representaba "cuota" — que
ya existía en el dataset. `irex.validate_expression` confirma una
expresión A LA VEZ; sin un catálogo, el modelo no tiene forma de descubrir
qué nombres existen antes de preguntarle al usuario o de adivinar mal (ver
entrada 86: adivinó `planv` en vez de `cuota` en una sesión relacionada).

Metadatos únicamente — nunca filas, nunca prueba de ejecución. El
llamador (`get_dataset_catalog.py`) es quien pasa por
`verified_explore_state` primero, así que este catálogo queda atado al
mismo `state_kind: "last_persisted"` que cualquier otra lectura de
Explore: existir en el dataset no significa que el gráfico se haya
ejecutado con esas columnas."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

# Generoso a propósito (la mayoría de los datasets reales tiene muchas
# menos): el límite existe para no mandar un catálogo sin fin al modelo,
# no para recortar el caso común. Cuando se llega al tope, `truncated`
# queda en `true` — nunca se trunca en silencio.
MAX_CATALOG_COLUMNS = 300
MAX_CATALOG_METRICS = 200


def _catalog_column(column: Mapping[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {"name": column["column_name"], "type": column.get("type")}
    if column.get("verbose_name"):
        entry["label"] = column["verbose_name"]
    if column.get("description"):
        entry["description"] = column["description"]
    if column.get("expression"):
        # Columna calculada (virtual): el "type" declarado no viene de la
        # tabla física, y `expression` es la definición real.
        entry["is_calculated"] = True
        entry["expression"] = column["expression"]
    if column.get("is_dttm"):
        entry["is_temporal"] = True
    return entry


def _catalog_metric(metric: Mapping[str, Any]) -> dict[str, Any]:
    entry: dict[str, Any] = {"name": metric["metric_name"], "expression": metric["expression"]}
    if metric.get("verbose_name"):
        entry["label"] = metric["verbose_name"]
    if metric.get("description"):
        entry["description"] = metric["description"]
    return entry


def dataset_catalog(
    columns: Sequence[Mapping[str, Any]],
    metrics: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Da forma al catálogo — el llamador ya filtró columnas inactivas y
    ya verificó el acceso al dataset; acá solo se ordena (nombre, para que
    la respuesta sea determinística y fácil de buscar), se trunca si hace
    falta, y se recorta a los campos del contrato."""
    sorted_columns = sorted(columns, key=lambda c: c["column_name"])
    sorted_metrics = sorted(metrics, key=lambda m: m["metric_name"])
    columns_truncated = len(sorted_columns) > MAX_CATALOG_COLUMNS
    metrics_truncated = len(sorted_metrics) > MAX_CATALOG_METRICS
    return {
        "columns": [_catalog_column(c) for c in sorted_columns[:MAX_CATALOG_COLUMNS]],
        "metrics": [_catalog_metric(m) for m in sorted_metrics[:MAX_CATALOG_METRICS]],
        "truncated": columns_truncated or metrics_truncated,
    }
