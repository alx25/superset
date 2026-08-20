"""Chat widget integration — inyecta el botón de chat en Superset y genera tokens MCP JWT."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

import jwt
import flask
import requests
from flask import Blueprint, Response, current_app, jsonify, request
from flask_login import current_user

logger = logging.getLogger(__name__)

mcp_widget_bp = Blueprint("mcp_widget", __name__, url_prefix="/api")


def _generate_mcp_token(username: str, first_name: str = "", last_name: str = "") -> str:
    """Genera un JWT HS256 firmado para el usuario de Superset."""
    secret: str = current_app.config.get("MCP_JWT_SECRET", "")
    issuer: str = current_app.config.get("MCP_JWT_ISSUER", "superset-chat-widget")
    audience: str = current_app.config.get("MCP_JWT_AUDIENCE", "superset-mcp")
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": username,
        "given_name": first_name,
        "family_name": last_name,
        "name": f"{first_name} {last_name}".strip(),
        "iss": issuer,
        "aud": audience,
        "exp": now + 3600,
        "nbf": now,
        "iat": now,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@mcp_widget_bp.route("/mcp-token")
def get_mcp_token() -> Response:
    """Devuelve un JWT fresco para el usuario autenticado actualmente."""
    if not current_user.is_authenticated:
        return jsonify({"error": "Not authenticated"}), 401
    if not _user_has_chat_access():
        return jsonify({"error": "No tiene el rol requerido para usar el chat"}), 403
    token = _generate_mcp_token(
        current_user.username,
        getattr(current_user, "first_name", ""),
        getattr(current_user, "last_name", ""),
    )
    return jsonify({"token": token, "user": current_user.username})


_PROXY_EXCLUDED_RESPONSE_HEADERS = {"content-encoding", "transfer-encoding", "connection"}
_PROXY_EXCLUDED_REQUEST_HEADERS = {
    "host", "content-length", "authorization",
    "x-service-secret", "x-superset-user",
}


@mcp_widget_bp.route("/chat-widget/widget.js")
def chat_widget_js() -> Response:
    """Sirve widget.js a través de Superset: el servidor del widget solo es
    alcanzable desde este servidor, no desde el navegador del usuario final."""
    if not current_user.is_authenticated or not _user_has_chat_access():
        return Response(status=403)
    url: str = current_app.config.get("CHAT_WIDGET_URL", "")
    if not url:
        return Response(status=404)
    upstream = requests.get(url, timeout=10)
    return Response(
        upstream.content,
        status=upstream.status_code,
        content_type="application/javascript",
    )


@mcp_widget_bp.route("/chat-widget/widget.css")
def chat_widget_css() -> Response:
    """widget.js calcula la URL del css como `<dir de widget.js>/widget.css`
    — como widget.js ahora se sirve desde acá, el navegador pide el css acá
    también."""
    if not current_user.is_authenticated or not _user_has_chat_access():
        return Response(status=403)
    js_url: str = current_app.config.get("CHAT_WIDGET_URL", "")
    if not js_url:
        return Response(status=404)
    css_url = js_url.rsplit("/", 1)[0] + "/widget.css"
    upstream = requests.get(css_url, timeout=10)
    return Response(
        upstream.content, status=upstream.status_code, content_type="text/css"
    )


@mcp_widget_bp.route("/chat-widget/assets/<path:filename>")
def chat_widget_asset(filename: str) -> Response:
    """widget.js calcula la URL de sus assets (logo, etc.) como
    `<apiUrl>/assets/<archivo>` — mismo motivo que el resto del proxy."""
    if not current_user.is_authenticated or not _user_has_chat_access():
        return Response(status=403)
    base: str = current_app.config.get("CHAT_WIDGET_API_URL", "").rstrip("/")
    if not base:
        return Response(status=404)
    upstream = requests.get(f"{base}/assets/{filename}", timeout=10)
    content_type = upstream.headers.get("Content-Type", "application/octet-stream")
    return Response(
        upstream.content, status=upstream.status_code, content_type=content_type
    )


@mcp_widget_bp.route(
    "/chat-widget/api/<path:subpath>",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
def chat_widget_api_proxy(subpath: str) -> Response:
    """Reenvía las llamadas que hace widget.js (fetch a `${apiUrl}/api/...`)
    al backend real del chat — mismo motivo que chat_widget_js: el navegador
    del usuario no tiene ruta directa a ese servidor."""
    if not current_user.is_authenticated or not _user_has_chat_access():
        return Response(status=403)
    base: str = current_app.config.get("CHAT_WIDGET_API_URL", "").rstrip("/")
    if not base:
        return Response(status=404)

    target = f"{base}/api/{subpath}"
    forward_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in _PROXY_EXCLUDED_REQUEST_HEADERS
    }
    service_secret = current_app.config.get("CHAT_BACKEND_SECRET", "")
    if service_secret:
        forward_headers["X-Service-Secret"] = service_secret
    forward_headers["X-Superset-User"] = current_user.username
    upstream = requests.request(
        method=request.method,
        url=target,
        params=request.args,
        data=request.get_data(),
        headers=forward_headers,
        stream=True,
        timeout=120,
    )

    def generate():
        for chunk in upstream.iter_content(chunk_size=4096):
            if chunk:
                yield chunk

    response_headers = [
        (k, v)
        for k, v in upstream.raw.headers.items()
        if k.lower() not in _PROXY_EXCLUDED_RESPONSE_HEADERS
    ]
    return Response(
        generate(), status=upstream.status_code, headers=response_headers
    )


@mcp_widget_bp.route("/mcp/download/<token>")
def mcp_download_export(token: str) -> Response:
    """Sirve archivos Excel generados por irex.export_to_excel.
    El token es un identificador opaco y de corta vida generado por la herramienta MCP.
    """
    import re as _re
    from pathlib import Path as _Path

    if not current_user.is_authenticated:
        return Response("No autenticado", status=401)

    if not _re.fullmatch(r"[A-Za-z0-9_-]{10,128}", token):
        return Response("Token inválido", status=400)

    export_dir = _Path("/home/imercados/.superset/mcp_exports")
    file_path = export_dir / f"{token}.xlsx"

    if not file_path.exists():
        return Response("Archivo no encontrado o expirado", status=404)

    with open(file_path, "rb") as fh:
        data = fh.read()

    return Response(
        data,
        status=200,
        headers={
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": f'attachment; filename="export_{token[:8]}.xlsx"',
            "Content-Length": str(len(data)),
        },
    )


def _user_has_chat_access() -> bool:
    """Si CHAT_WIDGET_REQUIRED_ROLE está configurado, solo los usuarios con
    ese rol ven el widget. Sin configurar, el widget aparece para todos los
    usuarios autenticados (comportamiento anterior, sin restricción)."""
    required_role: str = current_app.config.get("CHAT_WIDGET_REQUIRED_ROLE", "")
    if not required_role:
        return True
    user_roles = {r.name for r in getattr(current_user, "roles", [])}
    return required_role in user_roles


def inject_chat_widget(response: Response) -> Response:
    """After-request hook: inyecta el widget de chat en respuestas HTML autenticadas.

    Usa un inline script con el nonce CSP de Talisman (flask.request.csp_nonce).
    Con 'strict-dynamic', el inline aprobado puede cargar el script externo del widget.
    """
    if not (
        response.content_type.startswith("text/html")
        and current_user.is_authenticated
        and not getattr(current_user, "is_anonymous", True)
        and _user_has_chat_access()
    ):
        return response

    # El navegador del usuario final solo puede llegar a este servidor, no al
    # servidor del widget (CHAT_WIDGET_URL/CHAT_WIDGET_API_URL) — por eso el
    # script y sus llamadas a la API se sirven vía proxy (ver chat_widget_js
    # y chat_widget_api_proxy más arriba), nunca con la URL directa.
    widget_js_url: str = current_app.config.get("CHAT_WIDGET_URL", "")
    mcp_url: str = current_app.config.get("MCP_WIDGET_URL", "")
    secret: str = current_app.config.get("MCP_JWT_SECRET", "")

    if not widget_js_url or not secret:
        return response

    proxy_js_src = "/api/chat-widget/widget.js"
    proxy_api_url = "/api/chat-widget"

    try:
        first_name = getattr(current_user, "first_name", "")
        last_name = getattr(current_user, "last_name", "")
        token = _generate_mcp_token(current_user.username, first_name, last_name)
        username = current_user.username
    except Exception:
        logger.exception("Error generando token MCP para el widget de chat")
        return response

    # El nonce de Talisman permite al inline script ejecutarse bajo 'strict-dynamic'.
    # El inline crea dinámicamente el <script> del widget, heredando la confianza CSP.
    nonce = getattr(flask.request, "csp_nonce", "")
    nonce_attr = f' nonce="{nonce}"' if nonce else ""

    inline = (
        f"\n<script{nonce_attr}>\n"
        "(function(){\n"
        "  var THEME_KEY='superset-theme-mode';\n"
        "  function broadcastTheme(value){\n"
        "    window.dispatchEvent(new CustomEvent('superset-agent:theme-change', {\n"
        "      detail: { theme: value }\n"
        "    }));\n"
        "  }\n"
        "  function loadChatWidget(){\n"
        "    var s=document.createElement('script');\n"
        f"    s.src={proxy_js_src!r};\n"
        "    s.defer=true;\n"
        f"    s.dataset.apiUrl={proxy_api_url!r};\n"
        f"    s.dataset.mcpUrl={mcp_url!r};\n"
        f"    s.dataset.authToken={token!r};\n"
        f"    s.dataset.user={username!r};\n"
        f"    s.dataset.firstName={first_name!r};\n"
        f"    s.dataset.lastName={last_name!r};\n"
        "    s.dataset.authRefreshUrl='/api/mcp-token';\n"
        "    s.dataset.debug='false';\n"
        "    s.dataset.theme = localStorage.getItem(THEME_KEY) || '';\n"
        "    document.body.appendChild(s);\n"
        "\n"
        "    // Mantener el tema del widget sincronizado con el toggle de Superset\n"
        "    // sin recargar la página. localStorage.setItem no dispara 'storage' en\n"
        "    // la misma pestaña que hizo el cambio, así que se envuelve para\n"
        "    // detectar el toggle en vivo; 'storage' cubre el caso multi-pestaña.\n"
        "    try {\n"
        "      var originalSetItem = localStorage.setItem.bind(localStorage);\n"
        "      localStorage.setItem = function(key, value){\n"
        "        originalSetItem(key, value);\n"
        "        if (key === THEME_KEY) {\n"
        "          s.dataset.theme = value || '';\n"
        "          broadcastTheme(value || '');\n"
        "        }\n"
        "      };\n"
        "    } catch (e) {}\n"
        "    window.addEventListener('storage', function(ev){\n"
        "      if (ev.key === THEME_KEY) {\n"
        "        s.dataset.theme = ev.newValue || '';\n"
        "        broadcastTheme(ev.newValue || '');\n"
        "      }\n"
        "    });\n"
        "  }\n"
        "  // Esperar a que Superset termine de cargar sus propios recursos "
        "(CSS/JS) antes de inyectar el widget — evita el flash sin estilos "
        "que se ve al cargar/recargar la página.\n"
        "  if (document.readyState === 'complete') {\n"
        "    loadChatWidget();\n"
        "  } else {\n"
        "    window.addEventListener('load', loadChatWidget);\n"
        "  }\n"
        "})();\n"
        "</script>\n</body>"
    )

    html = response.get_data(as_text=True)
    if "</body>" in html:
        response.set_data(html.replace("</body>", inline, 1))

    return response
