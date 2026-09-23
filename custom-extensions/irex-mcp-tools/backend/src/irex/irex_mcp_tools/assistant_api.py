"""REST API propia de la extensión para el asistente de SQL Lab (Fase 6,
portabilidad, de PLAN_ASISTENTE_SQL_LAB.md).

Ruta: POST /extensions/irex/irex-mcp-tools/assistant/sql-lab

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
Así no hay que otorgar permisos nuevos a ningún rol.

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
    build_upstream_headers,
    filter_response_headers,
    has_required_role,
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
        role_names = [role.name for role in security_manager.get_user_roles(current_user)]
        if not has_required_role(config.get("CHAT_WIDGET_REQUIRED_ROLE"), role_names):
            return self.response_403()

        url = upstream_url(config.get("CHAT_WIDGET_API_URL"))
        if url is None:
            return self.response(503, message="El backend del chat no está configurado (CHAT_WIDGET_API_URL).")

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
                data=with_environment_mcp_url(request.get_data(), config.get("MCP_WIDGET_URL")),
                headers=headers,
                stream=True,
                timeout=_UPSTREAM_TIMEOUT,
            )
        except requests.RequestException as e:
            logger.warning("irex.assistant_api: no se pudo contactar al backend del chat: %s", type(e).__name__)
            return self.response(502, message="No se pudo contactar al backend del chat.")

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
