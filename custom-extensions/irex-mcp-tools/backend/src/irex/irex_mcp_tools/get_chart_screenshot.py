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
"""Tool MCP: `irex.get_chart_screenshot` — le da "ojos" al LLM sobre un
gráfico de Explore YA RENDERIZADO en el navegador del usuario. Propuesta
del usuario 2026-09-29, confirmada con el backend del chat: la captura se
sube ANTES (client-side, `dom-to-image-more`, mismo mecanismo que "Exportar
a imagen") vía `chart_screenshot_api.py`; esta tool solo la sirve.

Devuelve una lista `[metadata, Image]` — `fastmcp.utilities.types.Image`
convierte el JPEG a un bloque `ImageContent` real del protocolo MCP. El
backend del chat es quien decide si/cómo pasa ese bloque al modelo como
`input_image` (confirmado: el campo `images` de un tool_result NO llega
solo por existir — lo consume su propia lógica de Explore, no
`extract_text`). Ver `chart_screenshot_core.py` para el núcleo probado con
pytest (este archivo es solo el wrapper `@tool`, sin lógica propia)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .chart_screenshot_core import chart_screenshot_result


class GetChartScreenshotRequest(BaseModel):
    capture_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="El capture_id que devolvió el endpoint de subida del widget al capturar el gráfico renderizado.",
    )


@tool(
    name="irex.get_chart_screenshot",
    description=(
        "Devuelve la captura de pantalla (JPEG) de un gráfico de Explore YA RENDERIZADO en el navegador del "
        "usuario -- subida por el widget cuando el usuario pide una revisión visual, nunca generada por esta "
        "tool. Usarla para revisar layout, superposición de elementos, colores, legibilidad -- NO para "
        "confirmar que los datos en sí son correctos (para eso, preview_chart/explain_chart). Importante: una "
        "captura que se ve bien NO prueba que la consulta tenga un orden determinístico -- si el diseño "
        "depende de recorrer filas en un orden específico (matrices, líneas de tiempo agrupadas) y no hay "
        "orderby explícito seteado, la MISMA configuración puede verse distinta en la próxima carga; eso es un "
        "problema de la consulta, no algo que una sola captura pueda descartar. El capture_id vence a los 10 "
        "minutos de subido. Devuelve {\"error\": \"not_found\", ...} (nunca crashea) si venció, no existe, o "
        "pertenece a otro usuario -- en ese caso, pedirle al usuario que repita la revisión visual."
    ),
    tags=["irex", "explore", "chart", "read_only"],
    class_permission_name="Chart",
    method_permission_name="read",
)
def get_chart_screenshot(request: GetChartScreenshotRequest) -> Any:
    from fastmcp.utilities.types import Image

    return chart_screenshot_result(request.capture_id, image_cls=Image)
