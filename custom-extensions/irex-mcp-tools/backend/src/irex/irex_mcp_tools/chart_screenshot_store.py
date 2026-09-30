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
"""Almacén compartido para capturas de pantalla de gráficos de Explore —
"ojos" para el LLM, a pedido del usuario 2026-09-29 (revisión visual
post-aplicar cambios).

El endpoint de subida (`chart_screenshot_api.py`) corre en el proceso de
`superset.service`/`superset_test.service`; la tool MCP que la lee
(`get_chart_screenshot.py`) corre en `superset_mcp.service`/
`superset_mcp_test.service` — un PROCESO DISTINTO. Un diccionario en
memoria (como `report_cache.py`, que solo se usa DENTRO del proceso MCP)
no sirve acá.

Se evaluaron los caches de Superset (`cache_manager`) y se descartaron:
`cache_manager.cache` es `NullCache` en `superset_config_test.py` (todo
`.set()` es un no-op, imposible de probar en test); `explore_form_data_cache`
sí es real en ambos entornos pero guarda en la base de metadata, pensada
para JSON chico de form_data, no para binarios de una imagen.

Como ambos servicios corren en la MISMA máquina, se usa disco compartido
directamente — sin depender de qué cache esté configurada en cada entorno.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

_SCREENSHOT_MAX_AGE_SEC = 600  # 10 minutos -- alcanza para capturar, subir y que el modelo la pida
_MAX_IMAGE_BYTES = 3 * 1024 * 1024  # 3 MB


def _store_dir() -> Path:
    # Leído en cada llamada (no a nivel de módulo) para que un test pueda
    # apuntar a un directorio propio via monkeypatch de la env var.
    return Path(os.environ.get("IREX_CHART_SCREENSHOT_DIR", "/tmp/irex-chart-screenshots"))


def _ensure_store_dir() -> Path:
    store_dir = _store_dir()
    store_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    return store_dir


def _safe_capture_id(capture_id: str) -> str:
    """`capture_id` siempre se genera acá mismo con `secrets.token_urlsafe`,
    pero se sanea igual antes de armar un path — nunca confiar en un id que
    puede haber llegado desde afuera (el parámetro de una tool MCP) sin
    revalidar."""
    return "".join(ch for ch in capture_id if ch.isalnum() or ch in "-_")


def _paths(capture_id: str) -> tuple[Path, Path]:
    safe_id = _safe_capture_id(capture_id)
    store_dir = _store_dir()
    return store_dir / f"{safe_id}.jpg", store_dir / f"{safe_id}.json"


def _cleanup_expired(now: float | None = None) -> None:
    now = time.time() if now is None else now
    store_dir = _store_dir()
    if not store_dir.is_dir():
        return
    for meta_path in store_dir.glob("*.json"):
        try:
            meta = json.loads(meta_path.read_text())
            created_at = float(meta.get("created_at", 0))
        except (OSError, ValueError):
            created_at = 0
        if now - created_at > _SCREENSHOT_MAX_AGE_SEC:
            meta_path.unlink(missing_ok=True)
            meta_path.with_suffix(".jpg").unlink(missing_ok=True)


class ScreenshotTooLargeError(ValueError):
    pass


def save_screenshot(
    image_bytes: bytes,
    *,
    owner_username: str,
    slice_id: int | None,
    form_data_key: str,
    dataset_id: int,
    detail: str,
) -> str:
    """Guarda la captura y devuelve un `capture_id` nuevo (token opaco,
    nunca adivinable) para que el modelo se lo pase a `irex.get_chart_screenshot`."""
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise ScreenshotTooLargeError(
            f"La captura ({len(image_bytes)} bytes) supera el límite de {_MAX_IMAGE_BYTES} bytes."
        )
    _ensure_store_dir()
    _cleanup_expired()
    capture_id = secrets.token_urlsafe(16)
    image_path, meta_path = _paths(capture_id)
    image_path.write_bytes(image_bytes)
    image_path.chmod(0o600)
    meta = {
        "created_at": time.time(),
        "owner_username": owner_username,
        "slice_id": slice_id,
        "form_data_key": form_data_key,
        "dataset_id": dataset_id,
        "detail": detail,
    }
    meta_path.write_text(json.dumps(meta))
    meta_path.chmod(0o600)
    return capture_id


def read_screenshot(capture_id: str, *, owner_username: str) -> dict[str, Any] | None:
    """Devuelve `{"image_bytes", "slice_id", "form_data_key", "dataset_id",
    "detail", "created_at"}` o `None` si no existe, venció, o pertenece a
    otro usuario -- en los tres casos, `None` (nunca se distingue el motivo
    hacia quien llama, para no filtrar si un capture_id de otro usuario
    "existe" o no)."""
    _cleanup_expired()
    image_path, meta_path = _paths(capture_id)
    if not image_path.is_file() or not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, ValueError):
        return None
    if time.time() - float(meta.get("created_at", 0)) > _SCREENSHOT_MAX_AGE_SEC:
        image_path.unlink(missing_ok=True)
        meta_path.unlink(missing_ok=True)
        return None
    if meta.get("owner_username") != owner_username:
        return None
    return {
        "image_bytes": image_path.read_bytes(),
        "slice_id": meta.get("slice_id"),
        "form_data_key": meta.get("form_data_key"),
        "dataset_id": meta.get("dataset_id"),
        "detail": meta.get("detail"),
        "created_at": meta.get("created_at"),
    }
