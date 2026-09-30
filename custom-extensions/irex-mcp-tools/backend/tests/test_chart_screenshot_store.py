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
"""Pruebas del almacén de capturas compartido entre procesos
(chart_screenshot_store.py) — disco compartido, ver su docstring para por
qué no se usa cache_manager."""

import time

import pytest

from irex.irex_mcp_tools import chart_screenshot_store as store


@pytest.fixture(autouse=True)
def _isolated_store_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("IREX_CHART_SCREENSHOT_DIR", str(tmp_path / "screenshots"))
    yield


class TestSaveAndReadScreenshot:
    def test_guarda_y_lee_de_vuelta_con_el_mismo_dueño(self):
        capture_id = store.save_screenshot(
            b"\xff\xd8\xff\xe0fake-jpeg-bytes",
            owner_username="ana",
            slice_id=54,
            form_data_key="key-1",
            dataset_id=108,
            detail="el color de fondo se ve mal",
        )
        record = store.read_screenshot(capture_id, owner_username="ana")
        assert record is not None
        assert record["image_bytes"] == b"\xff\xd8\xff\xe0fake-jpeg-bytes"
        assert record["slice_id"] == 54
        assert record["form_data_key"] == "key-1"
        assert record["dataset_id"] == 108
        assert record["detail"] == "el color de fondo se ve mal"

    def test_capture_id_es_opaco_y_distinto_cada_vez(self):
        ids = {
            store.save_screenshot(
                b"a", owner_username="ana", slice_id=1, form_data_key="k", dataset_id=1, detail=""
            )
            for _ in range(5)
        }
        assert len(ids) == 5

    def test_otro_usuario_no_puede_leer_la_captura(self):
        capture_id = store.save_screenshot(
            b"a", owner_username="ana", slice_id=1, form_data_key="k", dataset_id=1, detail=""
        )
        assert store.read_screenshot(capture_id, owner_username="otro") is None

    def test_capture_id_inexistente_devuelve_none(self):
        assert store.read_screenshot("no-existe", owner_username="ana") is None

    def test_captura_vencida_devuelve_none_y_se_borra(self, monkeypatch):
        monkeypatch.setattr(store, "_SCREENSHOT_MAX_AGE_SEC", 0)
        capture_id = store.save_screenshot(
            b"a", owner_username="ana", slice_id=1, form_data_key="k", dataset_id=1, detail=""
        )
        time.sleep(0.01)
        assert store.read_screenshot(capture_id, owner_username="ana") is None
        # confirma que se borró de disco, no solo que se ocultó por vencimiento
        monkeypatch.setattr(store, "_SCREENSHOT_MAX_AGE_SEC", 600)
        assert store.read_screenshot(capture_id, owner_username="ana") is None

    def test_captura_demasiado_grande_se_rechaza_sin_guardar_nada(self, tmp_path):
        too_big = b"x" * (store._MAX_IMAGE_BYTES + 1)
        with pytest.raises(store.ScreenshotTooLargeError):
            store.save_screenshot(
                too_big, owner_username="ana", slice_id=1, form_data_key="k", dataset_id=1, detail=""
            )
        screenshots_dir = tmp_path / "screenshots"
        assert not screenshots_dir.exists() or list(screenshots_dir.iterdir()) == []

    def test_capture_id_con_caracteres_raros_no_escapa_el_directorio(self):
        # Nunca debería pasar (capture_id siempre lo genera save_screenshot),
        # pero read_screenshot lo sanea igual antes de armar un path.
        assert store.read_screenshot("../../../etc/passwd", owner_username="ana") is None
        assert store.read_screenshot("a/b/c", owner_username="ana") is None
