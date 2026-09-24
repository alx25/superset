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
"""Validación del estado cacheado de Explore, sin confundirlo con ejecución."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any


def verified_explore_state(
    form_data_key: str,
    state: Mapping[str, Any] | None,
    *,
    can_access: Callable[[str, str], bool],
    check_access: Callable[[int, int | None, str], object],
    is_admin: Callable[[], bool],
) -> dict[str, Any]:
    """Devuelve solo el estado cacheado cuyo dataset y gráfico son accesibles.

    `form_data_key` no prueba ejecución: Explore también la actualiza al
    cambiar de pestaña y al volver a renderizar. La distinción `last_persisted`
    evita declarar falsamente que su configuración es el SQL visible.
    """
    if not state:
        raise KeyError("form_data_key no encontrada o vencida")
    for permission, view in (
        ("can_explore", "Superset"),
        ("can_read", "Chart"),
        ("can_read", "Dataset"),
    ):
        if not can_access(permission, view):
            raise PermissionError("Acceso a Explore denegado")

    datasource_id = state.get("datasource_id")
    chart_id = state.get("chart_id") or None
    datasource_type = state.get("datasource_type")
    type_name = getattr(datasource_type, "value", datasource_type)
    if (
        isinstance(datasource_id, bool)
        or not isinstance(datasource_id, int)
        or datasource_id <= 0
    ):
        raise ValueError("Dataset cacheado inválido")
    if chart_id is not None and (
        isinstance(chart_id, bool) or not isinstance(chart_id, int) or chart_id <= 0
    ):
        raise ValueError("Gráfico cacheado inválido")
    if type_name != "table":
        raise ValueError("Tipo de datasource no soportado en Explore")
    try:
        check_access(datasource_id, chart_id, type_name)
    except Exception as exc:
        raise PermissionError("Acceso al dataset o gráfico denegado") from exc

    raw_form_data = state.get("form_data")
    try:
        form_data = (
            json.loads(raw_form_data) if isinstance(raw_form_data, str) else None
        )
    except ValueError as exc:
        raise ValueError("form_data cacheado inválido") from exc
    if not isinstance(form_data, dict):
        raise ValueError("form_data cacheado inválido")

    return {
        "form_data_key": form_data_key,
        "slice_id": chart_id,
        "datasource": {"id": datasource_id, "type": type_name},
        "form_data": form_data,
        "state_kind": "last_persisted",
        "user": {"is_admin": is_admin()},
    }
