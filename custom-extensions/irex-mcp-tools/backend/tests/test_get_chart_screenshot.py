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
"""Pruebas de la lógica pura de irex.get_chart_screenshot
(chart_screenshot_core.py) -- el decorador @tool real (get_chart_screenshot.py)
se prueba contra el servidor MCP real, no acá (mismo criterio que el resto
de las tools)."""

from types import SimpleNamespace

import pytest

from irex.irex_mcp_tools import chart_screenshot_store as store
from irex.irex_mcp_tools.chart_screenshot_core import NOT_FOUND_RESULT, chart_screenshot_result


class _FakeImage:
    """Doble de `fastmcp.utilities.types.Image` -- no se importa fastmcp
    en estas pruebas, solo se verifica que chart_screenshot_result llame al
    `image_cls` inyectado con los argumentos correctos."""

    def __init__(self, *, data: bytes, format: str):
        self.data = data
        self.format = format


@pytest.fixture(autouse=True)
def _isolated_store_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("IREX_CHART_SCREENSHOT_DIR", str(tmp_path / "screenshots"))
    yield


@pytest.fixture
def _as_user(monkeypatch):
    def _set(username: str | None):
        fake_g = SimpleNamespace(user=SimpleNamespace(username=username) if username else None)
        monkeypatch.setattr("flask.g", fake_g)

    return _set


class TestChartScreenshotResult:
    def test_devuelve_metadata_e_imagen_para_el_dueño(self, _as_user):
        _as_user("ana")
        capture_id = store.save_screenshot(
            b"\xff\xd8\xff\xe0jpeg",
            owner_username="ana",
            slice_id=54,
            form_data_key="key-1",
            dataset_id=108,
            detail="el borde se corta",
        )
        result = chart_screenshot_result(capture_id, image_cls=_FakeImage)
        assert isinstance(result, list)
        assert len(result) == 2
        metadata, image = result
        assert metadata == {"slice_id": 54, "form_data_key": "key-1", "detail": "el borde se corta"}
        assert image.data == b"\xff\xd8\xff\xe0jpeg"
        assert image.format == "jpeg"

    def test_capture_id_de_otro_usuario_da_not_found_no_la_imagen(self, _as_user):
        _as_user("ana")
        capture_id = store.save_screenshot(
            b"a", owner_username="ana", slice_id=1, form_data_key="k", dataset_id=1, detail=""
        )
        _as_user("otro")
        result = chart_screenshot_result(capture_id, image_cls=_FakeImage)
        assert result == NOT_FOUND_RESULT

    def test_capture_id_inexistente_da_not_found_sin_romper(self, _as_user):
        _as_user("ana")
        result = chart_screenshot_result("no-existe", image_cls=_FakeImage)
        assert result == NOT_FOUND_RESULT

    def test_sin_usuario_resuelto_da_not_found_no_crashea(self, _as_user):
        _as_user(None)
        result = chart_screenshot_result("cualquiera", image_cls=_FakeImage)
        assert result == NOT_FOUND_RESULT
