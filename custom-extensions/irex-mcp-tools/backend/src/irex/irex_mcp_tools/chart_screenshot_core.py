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
"""Núcleo puro de `irex.get_chart_screenshot` — sin el decorador `@tool`
(que solo existe dentro de un proceso MCP real), para poder probarse con
pytest normal. Ver `chart_screenshot_store.py` para el almacén compartido
entre procesos y `get_chart_screenshot.py` para el wrapper `@tool`."""

from __future__ import annotations

from typing import Any

from .chart_screenshot_store import read_screenshot

NOT_FOUND_RESULT: dict[str, str] = {
    "error": "not_found",
    "message": (
        "La captura no existe, venció (10 minutos), o no pertenece a este usuario. "
        "Pedile al usuario que repita la revisión visual."
    ),
}


def current_username() -> str | None:
    """Mismo patrón que `report_cache._current_user_key()` -- `g.user` es
    la identidad ya resuelta por `auth_bridge.py` a partir del JWT dentro
    del contexto de una tool MCP."""
    try:
        from flask import g

        user = getattr(g, "user", None)
    except RuntimeError:
        user = None
    if user is None:
        return None
    return getattr(user, "username", None)


def chart_screenshot_result(capture_id: str, *, image_cls: type) -> Any:
    """`image_cls` es `fastmcp.utilities.types.Image` en el wrapper real —
    inyectado como parámetro para no importar fastmcp en el módulo core
    (mismo motivo por el que este módulo, a diferencia del wrapper, no
    importa nada de `superset_core`)."""
    username = current_username()
    record = read_screenshot(capture_id, owner_username=username or "")
    if record is None:
        return dict(NOT_FOUND_RESULT)
    metadata = {
        "slice_id": record["slice_id"],
        "form_data_key": record["form_data_key"],
        "detail": record["detail"],
    }
    return [metadata, image_cls(data=record["image_bytes"], format="jpeg")]
