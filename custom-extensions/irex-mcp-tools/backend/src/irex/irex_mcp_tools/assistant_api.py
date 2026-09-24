"""REST API propia de la extensión para SQL Lab y Explore.

Rutas: POST /extensions/irex/irex-mcp-tools/assistant/sql-lab y /explore.
La ruta Explore solo se empaqueta en test hasta autorización de producción.

Reemplaza, para el panel de SQL Lab, al proxy genérico
`/api/chat-widget/api/sql-lab-assistant` de `custom-src/login/mcp_widget.py`,
que vive fuera de la extensión. Con esto el .supx trae su propio backend
HTTP y no depende de un blueprint instalado aparte. El proxy viejo sigue
existiendo (lo usa el widget de dashboards) y el panel lo usa como
fallback si esta ruta no está registrada.

PERMISOS — por qué NO se usa `@protect()` con `class_permission_name="SQLLab"`:
el decorador `@api` del host llama `appbuilder._add_permission(view, True)`,
y `add_permissions_view` de Flask-AppBuilder 5.0.2 BORRA DE TODOS LOS ROLES
cualquier permiso de esa vista que la API no declare. Con "SQLLab", cada
arranque eliminaría `can_execute_sql_query` (que usa todo el RBAC del MCP),
`can_format_sql`, etc. Por eso la API tiene su propio nombre de vista, sin
permisos declarados, y el handler valida con permisos que YA existen
(defensa en profundidad, punto 2 del plan):
  1. usuario autenticado por la sesión de Superset;
  2. `can_read` sobre `SQLLab` (el mismo que hace falta para abrir SQL Lab);
  3. el rol `CHAT_WIDGET_REQUIRED_ROLE`, si está configurado (mismo criterio
     que el widget).
Así no hay que otorgar permisos nuevos a ningún rol. Explore agrega
`can_explore` sobre Superset, `can_read` sobre Chart/Dataset y acceso al
dataset declarado antes de reenviar el body. La tool MCP verifica después
el estado real y el acceso al mismo dataset.

Config leída solo del servidor (nunca del bundle JS): `CHAT_WIDGET_API_URL`,
`CHAT_BACKEND_SECRET`, `CHAT_WIDGET_REQUIRED_ROLE` y `MCP_WIDGET_URL` (MCP
de este entorno, que se fija en el body como `mcp_url`; ver
`_assistant_proxy.with_environment_mcp_url`).

CSRF: `flask_appbuilder.api.BaseApi` trae `csrf_exempt = True` y
`superset_core.rest_api.RestApi` NO lo sobreescribe (las APIs propias de
Superset sí, vía `BaseSupersetApiMixin`). Sin `csrf_exempt = False`, esta
ruta autenticada por cookie quedaría exenta de CSRF (verificado en test,
2026-09-23). El panel manda `X-CSRFToken` vía
`authentication.getCSRFToken()` de la API pública.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator

import requests
from flask import Response, current_app, request, stream_with_context
from flask_appbuilder.api import expose
from flask_login import current_user
from superset_core.rest_api.api import RestApi
from superset_core.rest_api.decorators import api

from ._assistant_proxy import (
    EXPLORE_UPSTREAM_PATH,
    build_upstream_headers,
    explore_datasource_id,
    filter_response_headers,
    has_required_role,
    has_explore_dataset_access,
    has_explore_permissions,
    prepare_explore_body,
    upstream_url,
    with_environment_mcp_url,
)

logger = logging.getLogger(__name__)

# (conexión, lectura entre bytes). La lectura se renueva con cada evento
# SSE, así que un pedido largo con progreso no se corta.
_UPSTREAM_TIMEOUT = (10, 120)


@api(
    id="sql_lab_assistant",
    name="Asistente SQL Lab",
    description="Reenvía pedidos del panel del asistente de SQL Lab al backend del chat.",
    resource_name="assistant",
)
class SqlLabAssistantRestApi(RestApi):
    # Nombre de vista PROPIO, nunca uno del host (ver docstring del módulo).
    class_permission_name = "IrexSqlLabAssistant"
    # FAB exime de CSRF a toda BaseApi por defecto (ver docstring del módulo).
    csrf_exempt = False

    @expose("/sql-lab", methods=("POST",))
    def sql_lab(self) -> Response:
        from superset import security_manager

        if not current_user.is_authenticated:
            return self.response_401()
        if not security_manager.can_access("can_read", "SQLLab"):
            return self.response_403()
        config = current_app.config
        role_names = [
            role.name for role in security_manager.get_user_roles(current_user)
        ]
        if not has_required_role(config.get("CHAT_WIDGET_REQUIRED_ROLE"), role_names):
            return self.response_403()

        url = upstream_url(config.get("CHAT_WIDGET_API_URL"))
        if url is None:
            return self.response(
                503,
                message="El backend del chat no está configurado (CHAT_WIDGET_API_URL).",
            )

        headers = build_upstream_headers(
            request.headers,
            service_secret=config.get("CHAT_BACKEND_SECRET"),
            username=current_user.username,
            email=current_user.email,
            display_name=current_user.get_full_name(),
        )
        try:
            upstream = requests.post(
                url,
                data=with_environment_mcp_url(
                    request.get_data(), config.get("MCP_WIDGET_URL")
                ),
                headers=headers,
                stream=True,
                timeout=_UPSTREAM_TIMEOUT,
            )
        except requests.RequestException as e:
            logger.warning(
                "irex.assistant_api: no se pudo contactar al backend del chat: %s",
                type(e).__name__,
            )
            return self.response(
                502, message="No se pudo contactar al backend del chat."
            )

        def relay() -> Iterator[bytes]:
            try:
                for chunk in upstream.iter_content(chunk_size=4096):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return Response(
            stream_with_context(relay()),
            status=upstream.status_code,
            headers=filter_response_headers(upstream.headers.items()),
        )

    @expose("/explore", methods=("POST",))
    def explore(self) -> Response:
        """Reenvía Explore con identidad, rol Admin y MCP fijados por Superset."""
        from superset import security_manager

        if not current_user.is_authenticated:
            return self.response_401()
        if not has_explore_permissions(security_manager.can_access):
            return self.response_403()
        config = current_app.config
        role_names = [
            role.name for role in security_manager.get_user_roles(current_user)
        ]
        if not has_required_role(config.get("CHAT_WIDGET_REQUIRED_ROLE"), role_names):
            return self.response_403()

        url = upstream_url(config.get("CHAT_WIDGET_API_URL"), EXPLORE_UPSTREAM_PATH)
        mcp_url = (config.get("MCP_WIDGET_URL") or "").strip()
        if url is None or not mcp_url:
            return self.response(
                503, message="El backend del chat o MCP de Explore no está configurado."
            )

        is_admin = security_manager.is_admin()
        try:
            body = prepare_explore_body(
                request.get_data(), is_admin=is_admin, mcp_url=mcp_url
            )
            dataset_id = explore_datasource_id(body)
        except (TypeError, ValueError, AttributeError):
            return self.response(400, message="Contrato Explore v1 inválido.")
        from superset.daos.dataset import DatasetDAO

        if not has_explore_dataset_access(
            dataset_id,
            lambda id_: DatasetDAO.find_by_id(id_, skip_base_filter=True),
            security_manager.can_access_datasource,
        ):
            return self.response_403()
        headers = build_upstream_headers(
            request.headers,
            service_secret=config.get("CHAT_BACKEND_SECRET"),
            username=current_user.username,
            email=current_user.email,
            display_name=current_user.get_full_name(),
        )
        headers["X-Superset-Is-Admin"] = "true" if is_admin else "false"
        try:
            upstream = requests.post(
                url,
                data=body,
                headers=headers,
                stream=True,
                timeout=_UPSTREAM_TIMEOUT,
            )
        except requests.RequestException as e:
            logger.warning(
                "irex.assistant_api: no se pudo contactar al backend Explore: %s",
                type(e).__name__,
            )
            return self.response(
                502, message="No se pudo contactar al backend del chat."
            )

        def relay() -> Iterator[bytes]:
            try:
                for chunk in upstream.iter_content(chunk_size=4096):
                    if chunk:
                        yield chunk
            finally:
                upstream.close()

        return Response(
            stream_with_context(relay()),
            status=upstream.status_code,
            headers=filter_response_headers(upstream.headers.items()),
        )
