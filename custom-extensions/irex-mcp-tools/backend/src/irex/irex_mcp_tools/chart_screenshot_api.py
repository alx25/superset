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
"""REST API propia de la extensión: sube la captura de pantalla del
gráfico ya renderizado (client-side, `dom-to-image-more` -- mismo mecanismo
que "Exportar a imagen" de Explore, ya probado) para que
`irex.get_chart_screenshot` se la sirva al modelo. Ruta:
POST /extensions/irex/irex-mcp-tools/chart-screenshots/upload.

Mismo patrón de permisos que `assistant_api.py` (ver su docstring para el
detalle de por qué NUNCA se usa `class_permission_name` de un tipo del
host): vista con nombre propio, sin permisos declarados, el handler valida
con permisos que YA existen (`can_explore`/Superset, `can_read`/Chart,
`can_read`/Dataset, más acceso al dataset declarado) — defensa en
profundidad, no depende de otorgar nada nuevo a ningún rol.

CSRF: igual que `assistant_api.py`, `csrf_exempt = False` explícito (FAB
exime por defecto).
"""

from __future__ import annotations

import logging

from flask import current_app, request
from flask_appbuilder.api import expose
from flask_login import current_user
from superset_core.rest_api.api import RestApi
from superset_core.rest_api.decorators import api

from ._assistant_proxy import has_explore_dataset_access, has_explore_permissions, has_required_role
from .chart_screenshot_store import ScreenshotTooLargeError, save_screenshot

logger = logging.getLogger(__name__)

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg"}
_MAX_DETAIL_CHARS = 2000


@api(
    id="chart_screenshots",
    name="Capturas de gráfico",
    description="Sube la captura client-side de un gráfico de Explore para revisión visual del asistente.",
    resource_name="chart-screenshots",
)
class ChartScreenshotRestApi(RestApi):
    class_permission_name = "IrexChartScreenshots"
    csrf_exempt = False

    @expose("/upload", methods=("POST",))
    def upload(self):
        from superset import security_manager
        from superset.daos.dataset import DatasetDAO

        if not current_user.is_authenticated:
            return self.response_401()
        if not has_explore_permissions(security_manager.can_access):
            return self.response_403()
        config = current_app.config
        role_names = [role.name for role in security_manager.get_user_roles(current_user)]
        if not has_required_role(config.get("CHAT_WIDGET_REQUIRED_ROLE"), role_names):
            return self.response_403()

        image_file = request.files.get("image")
        if image_file is None or image_file.content_type not in _ALLOWED_CONTENT_TYPES:
            return self.response(400, message="Falta el archivo 'image' (JPEG).")

        try:
            dataset_id = int(request.form.get("dataset_id", ""))
        except (TypeError, ValueError):
            return self.response(400, message="'dataset_id' inválido.")
        form_data_key = (request.form.get("form_data_key") or "").strip()
        if not form_data_key:
            return self.response(400, message="Falta 'form_data_key'.")
        slice_id_raw = request.form.get("slice_id")
        slice_id = None
        if slice_id_raw:
            try:
                slice_id = int(slice_id_raw)
            except ValueError:
                return self.response(400, message="'slice_id' inválido.")
        detail = (request.form.get("detail") or "").strip()[:_MAX_DETAIL_CHARS]

        if not has_explore_dataset_access(
            dataset_id,
            lambda id_: DatasetDAO.find_by_id(id_, skip_base_filter=True),
            security_manager.can_access_datasource,
        ):
            return self.response_403()

        image_bytes = image_file.read()
        if not image_bytes:
            return self.response(400, message="La imagen está vacía.")

        try:
            capture_id = save_screenshot(
                image_bytes,
                owner_username=current_user.username,
                slice_id=slice_id,
                form_data_key=form_data_key,
                dataset_id=dataset_id,
                detail=detail,
            )
        except ScreenshotTooLargeError as e:
            return self.response(413, message=str(e))

        return self.response(200, capture_id=capture_id)
