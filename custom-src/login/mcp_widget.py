"""Chat widget integration — inyecta el botón de chat en Superset y genera tokens MCP JWT."""

from __future__ import annotations

import hmac
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
        # Esta ruta ya hace un GET en vivo al servidor del widget en cada
        # pedido — nunca sirve una copia vieja de acá. El único caché que
        # puede quedar desactualizado es el del navegador del usuario final;
        # no-cache fuerza a que siempre revalide (If-None-Match/304 si no
        # cambió, refetch completo si sí) en vez de reusar una copia local
        # sin preguntar.
        headers={"Cache-Control": "no-cache"},
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
        upstream.content,
        status=upstream.status_code,
        content_type="text/css",
        headers={"Cache-Control": "no-cache"},  # ver comentario en chat_widget_js
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
    # Para que el backend del chat pueda armar textos tipo "compartido por
    # Juan Pérez" sin tener que resolver el username por su cuenta.
    forward_headers["X-Superset-User-Email"] = current_user.email or ""
    forward_headers["X-Superset-User-Display-Name"] = current_user.get_full_name()
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


@mcp_widget_bp.route(
    "/chat-widget/notifications/conversation-shared", methods=["POST"]
)
def notify_conversation_shared() -> Response:
    """Endpoint INBOUND — a diferencia de chat_widget_api_proxy (que reenvía
    pedidos del navegador HACIA el chat), a este lo llama el backend del
    chat DIRECTO, servidor a servidor (sin sesión de navegador de por
    medio), para pedirle a Superset que valide el usuario destino y mande
    la notificación de 'conversación compartida' usando el SMTP ya
    configurado acá. Autenticado por el mismo secreto compartido que ya se
    usa en la otra dirección — comparación en tiempo constante para evitar
    timing attacks sobre el secreto.

    No expone ningún listado/búsqueda de usuarios: el backend del chat ya
    sabe qué username/email escribió quien comparte, esto solo lo valida y
    dispara el correo."""
    expected_secret = current_app.config.get("CHAT_BACKEND_SECRET", "")
    provided_secret = request.headers.get("X-Service-Secret", "")
    if not expected_secret or not hmac.compare_digest(
        provided_secret, expected_secret
    ):
        return jsonify({"status": "error", "error": "No autorizado"}), 401

    # El X-Superset-User del header (no el 'owner_user' del payload) es la
    # fuente de verdad de quién comparte — evita que alguien arme un POST a
    # mano declarando ser otro usuario mientras el secreto siga siendo
    # válido para llamar a este endpoint en general.
    owner_username = request.headers.get("X-Superset-User", "")
    if not owner_username:
        return jsonify({"status": "error", "error": "Falta X-Superset-User"}), 400

    payload = request.get_json(silent=True) or {}
    target_identifier = str(payload.get("target_user") or "").strip()
    subject = str(payload.get("subject") or "Te compartieron una conversación")
    html_content = payload.get("html") or payload.get("text") or ""

    if not target_identifier:
        return jsonify({"status": "error", "error": "target_user es requerido"}), 400
    if not html_content:
        return jsonify({"status": "error", "error": "html o text es requerido"}), 400

    from superset.extensions import db, security_manager

    owner = security_manager.find_user(username=owner_username)
    if owner is None:
        return jsonify(
            {"status": "error", "error": "El usuario que comparte no existe"}
        ), 404

    user_model = security_manager.user_model
    target = (
        db.session.query(user_model)
        .filter(
            (user_model.username == target_identifier)
            | (user_model.email == target_identifier)
        )
        .filter(user_model.active.is_(True))
        .first()
    )
    if target is None:
        return jsonify(
            {
                "status": "error",
                "error": "Usuario destino no encontrado o inactivo",
            }
        ), 404
    if not target.email:
        return jsonify(
            {
                "status": "error",
                "error": "El usuario destino no tiene email configurado",
            }
        ), 422

    from superset.utils.core import send_email_smtp

    try:
        send_email_smtp(
            to=target.email,
            subject=subject,
            html_content=html_content,
            config=current_app.config,
        )
    except Exception:
        logger.exception(
            "Error enviando notificación de conversación compartida "
            f"(owner={owner_username!r}, target={target.username!r})"
        )
        return jsonify(
            {"status": "error", "error": "No se pudo enviar el correo"}
        ), 502

    return jsonify(
        {
            "status": "success",
            "target_username": target.username,
            "target_display_name": target.get_full_name(),
        }
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

    # CSS del layout acoplable — 'unsafe-inline' ya está permitido en style-src
    # (ver TALISMAN_CONFIG), no hace falta nonce acá (a diferencia del <script>).
    dock_style = (
        "\n<style>\n"
        # height:100vh FIJO (no min-height) + align-items:stretch (default,
        # implícito) — le da a .mcp-dashboard-dock-main una altura DEFINIDA
        # de verdad. Con min-height, el wrapper crecía junto con el contenido
        # y #app terminaba sin ningún ancestro de altura definida — rompe
        # cualquier página que dependa de height:100% en cascada (ej. SQL Lab,
        # cuyo editor colapsa a 0 de alto sin eso — 'no se ve nada'). Los
        # dashboards lo disimulaban porque su contenido igual es scrolleable.
        "  .mcp-dashboard-dock-wrapper{display:flex;height:100vh;}\n"
        # .mcp-dashboard-dock-main (contiene #app) scrollea su propio
        # contenido acá adentro en vez de estirar el wrapper/documento —
        # mismo alto definido (100vh) que #app necesitaba originalmente.
        "  .mcp-dashboard-dock-main{flex:1 1 auto;min-width:0;height:100%;"
        "overflow-y:auto;}\n"
        # El widget (Web Component) ya maneja su propio scroll interno en
        # modo docked (.messages con overflow-y:auto, .composer con
        # flex-shrink:0 fijo abajo) — confirmado leyendo widget.js/widget.css
        # reales. overflow:hidden acá evita que Superset compita por el
        # scroll con el :host del widget. Ya no hace falta position:sticky —
        # el wrapper está fijo a 100vh, no hay scroll de página que seguir.\n"
        "  #mcp-chat-dock{display:none;flex:0 0 auto;width:min(460px,34vw);"
        "min-width:380px;max-width:620px;height:100%;overflow:hidden;}\n"
        # El :host del widget usa height:100% y espera resolverlo contra un
        # padre con alto definido — reforzar el hijo directo no está de más.
        "  #mcp-chat-dock > *{height:100%;box-sizing:border-box;}\n"
        "  body.superset-agent-docked #mcp-chat-dock{display:block;}\n"
        # Handle de resize entre el dashboard/página y el dock — franja
        # angosta, mismo alto que sus hermanos en el wrapper fijo.
        "  .mcp-chat-dock-resizer{display:none;flex:0 0 auto;width:6px;"
        "cursor:col-resize;height:100%;background:transparent;"
        "touch-action:none;}\n"
        "  .mcp-chat-dock-resizer:hover,.mcp-chat-dock-resizer.mcp-resizing"
        "{background:rgba(0,0,0,.12);}\n"
        "  body.superset-agent-docked .mcp-chat-dock-resizer{display:block;}\n"
        "</style>\n"
    )

    inline = (
        f"{dock_style}\n<script{nonce_attr}>\n"
        "(function(){\n"
        "  var THEME_KEY='superset-theme-mode';\n"
        "  // THEME_KEY guarda el ThemeMode crudo de Superset ('default'|'dark'|\n"
        "  // 'system'), no 'light'/'dark' — con 'system' el widget no sabe a qué\n"
        "  // modo mapea eso. resolvedTheme guarda el valor YA resuelto ('dark' o\n"
        "  // 'light') que publica ThemeAgentBridge (React) en el detail.theme del\n"
        "  // evento 'superset-agent:theme-change' — es la única fuente confiable,\n"
        "  // incluso para 'system'. Escuchamos desde ya (antes de que exista el\n"
        "  // <script> del widget) para no perder el primer evento.\n"
        "  var resolvedTheme='';\n"
        "  var widgetScriptEl=null;\n"
        "  window.addEventListener('superset-agent:theme-change', function(ev){\n"
        "    resolvedTheme = (ev.detail && ev.detail.theme) || '';\n"
        "    if (widgetScriptEl) widgetScriptEl.dataset.theme = resolvedTheme;\n"
        "  });\n"
        "  // Envuelve #app (navbar + contenido, lo que sea que la app esté\n"
        "  // mostrando) en una fila flex y agrega el contenedor del dock como\n"
        "  // hermano — mueve #app como UNIDAD, nunca toca nada de lo que React\n"
        "  // gestiona puertas adentro, así que no hay riesgo de romper el\n"
        "  // reconciliado. Genérico: no depende de qué página/dashboard sea.\n"
        "  function setupDock(){\n"
        "    if (document.getElementById('mcp-chat-dock')) return;\n"
        "    var app=document.getElementById('app');\n"
        "    if (!app || !app.parentNode) return;\n"
        "    var wrapper=document.createElement('div');\n"
        "    wrapper.className='mcp-dashboard-dock-wrapper';\n"
        "    var main=document.createElement('div');\n"
        "    main.className='mcp-dashboard-dock-main';\n"
        "    app.parentNode.insertBefore(wrapper, app);\n"
        "    main.appendChild(app);\n"
        "    wrapper.appendChild(main);\n"
        "    var dock=document.createElement('aside');\n"
        "    dock.id='mcp-chat-dock';\n"
        "    var resizer=document.createElement('div');\n"
        "    resizer.className='mcp-chat-dock-resizer';\n"
        "    wrapper.appendChild(resizer);\n"
        "    wrapper.appendChild(dock);\n"
        "    setupDockResize(dock, resizer);\n"
        "  }\n"
        "  // Arrastrar el handle cambia el ancho del dock (clamp 380-620px, "
        "mismo\n"
        "  // rango que el CSS por si el JS no llegara a correr). El ancho "
        "elegido\n"
        "  // se recuerda en localStorage — persiste entre recargas.\n"
        "  function setupDockResize(dock, resizer){\n"
        "    var WIDTH_KEY='mcp-chat-dock-width';\n"
        "    var MIN=380, MAX=620;\n"
        "    var saved=parseInt(localStorage.getItem(WIDTH_KEY), 10);\n"
        "    if (saved && saved >= MIN && saved <= MAX) {\n"
        "      dock.style.width = saved + 'px';\n"
        "    }\n"
        "    var dragging=false, startX=0, startWidth=0;\n"
        "    resizer.addEventListener('mousedown', function(ev){\n"
        "      dragging=true;\n"
        "      startX=ev.clientX;\n"
        "      startWidth=dock.getBoundingClientRect().width;\n"
        "      resizer.classList.add('mcp-resizing');\n"
        "      document.body.style.userSelect='none';\n"
        "      ev.preventDefault();\n"
        "    });\n"
        "    window.addEventListener('mousemove', function(ev){\n"
        "      if (!dragging) return;\n"
        "      // el dock está a la derecha — arrastrar hacia la izquierda "
        "lo agranda\n"
        "      var next=startWidth + (startX - ev.clientX);\n"
        "      if (next < MIN) next = MIN;\n"
        "      if (next > MAX) next = MAX;\n"
        "      dock.style.width = next + 'px';\n"
        "    });\n"
        "    window.addEventListener('mouseup', function(){\n"
        "      if (!dragging) return;\n"
        "      dragging=false;\n"
        "      resizer.classList.remove('mcp-resizing');\n"
        "      document.body.style.userSelect='';\n"
        "      try {\n"
        "        localStorage.setItem(WIDTH_KEY, parseInt(dock.style.width, "
        "10));\n"
        "      } catch (e) {}\n"
        "    });\n"
        "  }\n"
        "  // WORKAROUND — bug conocido del widget: dentro de su shadow root,\n"
        "  // '#messages' (flex:1;overflow-y:auto) no tiene min-height:0, así\n"
        "  // que en modo docked crece con el contenido de los mensajes en vez\n"
        "  // de respetar el alto heredado, empujando el composer/input fuera\n"
        "  // de la vista. '.chat-main' se incluye también como red de "
        "seguridad\n"
        "  // (mismo problema, un nivel más arriba en la cadena de flex). "
        "Reportado\n"
        "  // para fix en origen — esto es idempotente y queda inofensivo el "
        "día\n"
        "  // que lo corrijan allá.\n"
        "  function patchWidgetShadowFix(host){\n"
        "    if (!host || !host.shadowRoot) return;\n"
        "    if (host.shadowRoot.getElementById('mcp-dock-fix-style')) return;\n"
        "    var style=document.createElement('style');\n"
        "    style.id='mcp-dock-fix-style';\n"
        "    style.textContent='.chat-main{min-height:0 !important;}"
        "#messages{min-height:0 !important;}';\n"
        "    host.shadowRoot.appendChild(style);\n"
        "  }\n"
        "  // WORKAROUND #2 — el widget reportó haber arreglado el FOUC en "
        "origen\n"
        "  // pero el flash sigue pasando en la práctica. Ocultamos el host "
        "APENAS\n"
        "  // existe (no esperamos a que el <link> ya esté en el shadow "
        "root —\n"
        "  // el widget arma su DOM interno en etapas, y para cuando "
        "chequeamos\n"
        "  // una sola vez el <link> puede no haber aparecido todavía, "
        "perdiendo\n"
        "  // la ventana para ocultar a tiempo). Si el <link> no está aún, lo "
        "\n"
        "  // esperamos con otro observer sobre el propio shadow root.\n"
        "  function hideUntilStyled(host){\n"
        "    if (!host || !host.shadowRoot) return;\n"
        "    host.style.visibility='hidden';\n"
        "    var revealed=false;\n"
        "    var reveal=function(){\n"
        "      if (revealed) return;\n"
        "      revealed=true;\n"
        "      host.style.visibility='';\n"
        "    };\n"
        "    var attachToLink=function(link){\n"
        "      if (link.sheet) { reveal(); return; }\n"
        "      link.addEventListener('load', reveal);\n"
        "      link.addEventListener('error', reveal);\n"
        "    };\n"
        "    var existing=host.shadowRoot.querySelector("
        "'link[rel=\"stylesheet\"]');\n"
        "    if (existing) {\n"
        "      attachToLink(existing);\n"
        "    } else {\n"
        "      var linkObserver=new MutationObserver(function(){\n"
        "        var link=host.shadowRoot.querySelector("
        "'link[rel=\"stylesheet\"]');\n"
        "        if (link) {\n"
        "          attachToLink(link);\n"
        "          linkObserver.disconnect();\n"
        "        }\n"
        "      });\n"
        "      linkObserver.observe(host.shadowRoot, {childList:true, "
        "subtree:true});\n"
        "    }\n"
        "    setTimeout(reveal, 2000);\n"
        "  }\n"
        "  // El shadow host del widget ('#superset-agent-widget') se crea "
        "recién\n"
        "  // cuando el script externo termina de inicializar — hay que "
        "esperarlo\n"
        "  // en vez de asumir que ya existe al correr este bloque.\n"
        "  var widgetHostObserver=new MutationObserver(function(){\n"
        "    var host=document.getElementById('superset-agent-widget');\n"
        "    if (host && host.shadowRoot) {\n"
        "      patchWidgetShadowFix(host);\n"
        "      hideUntilStyled(host);\n"
        "      widgetHostObserver.disconnect();\n"
        "    }\n"
        "  });\n"
        "  widgetHostObserver.observe(document.body, {childList:true, "
        "subtree:true});\n"
        "  // El widget dispara esto al acoplarse/desacoplarse (por el menú del\n"
        "  // widget o al iniciar con data-layout='auto'). Escuchamos acá en vez\n"
        "  // de depender solo de que el widget toque document.body directo, para\n"
        "  // mantener el control del layout del lado de Superset.\n"
        "  window.addEventListener('superset-agent:layout-change', function(ev){\n"
        "    var docked = !!(ev.detail && ev.detail.docked === true);\n"
        "    document.body.classList.toggle('superset-agent-docked', docked);\n"
        "  });\n"
        "  function loadChatWidget(){\n"
        "    setupDock();\n"
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
        "    s.dataset.layout='auto';\n"
        "    s.dataset.dockTarget='#mcp-chat-dock';\n"
        "    // Si ThemeAgentBridge ya publicó (lo normal: React monta antes de\n"
        "    // que termine de cargar la página) usamos ese valor ya resuelto;\n"
        "    // si no, fallback al ThemeMode crudo (mejor que nada, y nunca peor\n"
        "    // que el comportamiento previo) hasta que llegue el primer evento.\n"
        "    s.dataset.theme = resolvedTheme || localStorage.getItem(THEME_KEY) || '';\n"
        "    widgetScriptEl = s;\n"
        "    document.body.appendChild(s);\n"
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
