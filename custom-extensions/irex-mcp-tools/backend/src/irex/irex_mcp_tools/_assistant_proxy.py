"""Lógica pura del reenvío del asistente de SQL Lab al backend del chat.

Separada de `assistant_api.py` (la vista Flask) para poder testearla sin
levantar Superset. Ver PLAN_ASISTENTE_SQL_LAB.md, Fase 6 (portabilidad).

Diferencias deliberadas con el proxy genérico viejo
(`custom-src/login/mcp_widget.py::chat_widget_api_proxy`):
- Reenvía una lista BLANCA de headers del navegador (`Content-Type`,
  `Accept`). El proxy viejo reenvía todo salvo unos pocos, incluida la
  cookie de sesión de Superset, que el backend del chat no necesita.
- Una sola ruta fija aguas arriba (`/api/sql-lab-assistant`), no un
  `<path:subpath>` arbitrario.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping

UPSTREAM_PATH = "/api/sql-lab-assistant"
FORWARDED_REQUEST_HEADERS = ("content-type", "accept")
EXCLUDED_RESPONSE_HEADERS = {"content-encoding", "transfer-encoding", "connection", "content-length"}


def upstream_url(base_url: str | None) -> str | None:
    """URL del endpoint del backend del chat, o None si no está configurado."""
    base = (base_url or "").strip().rstrip("/")
    return f"{base}{UPSTREAM_PATH}" if base else None


def has_required_role(required_role: str | None, role_names: Iterable[str]) -> bool:
    """Mismo criterio que `_user_has_chat_access` del widget: sin rol
    configurado no hay restricción adicional; con rol, hay que tenerlo."""
    if not required_role:
        return True
    return required_role in set(role_names)


def build_upstream_headers(
    incoming: Mapping[str, str],
    *,
    service_secret: str | None,
    username: str,
    email: str | None,
    display_name: str | None,
) -> dict[str, str]:
    """Headers para el backend del chat. La identidad sale SIEMPRE de la
    sesión del servidor, nunca de lo que mande el navegador: cualquier
    `X-Superset-User*` o `X-Service-Secret` entrante se descarta porque no
    está en la lista blanca."""
    headers = {
        name: value
        for name, value in incoming.items()
        if name.lower() in FORWARDED_REQUEST_HEADERS
    }
    if service_secret:
        headers["X-Service-Secret"] = service_secret
    headers["X-Superset-User"] = username
    headers["X-Superset-User-Email"] = email or ""
    headers["X-Superset-User-Display-Name"] = display_name or ""
    return headers


def filter_response_headers(headers: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    """Quita los headers hop-by-hop o que dejan de ser ciertos al re-streamear
    (`requests` ya decodificó gzip, así que `Content-Length` tampoco vale)."""
    return [(name, value) for name, value in headers if name.lower() not in EXCLUDED_RESPONSE_HEADERS]


def with_environment_mcp_url(body: bytes, mcp_url: str | None) -> bytes:
    """Fija `mcp_url` en el body con el MCP de ESTE entorno (`MCP_WIDGET_URL`),
    igual que hace el widget de dashboards en cada pedido.

    Test y producción comparten el mismo backend del chat. Sin este campo, el
    backend usa su URL por defecto para SQL Lab, que apuntaba al MCP de test:
    un pedido de producción terminaba consultando la metadata de test
    ("Database with ID 11 not found", 2026-09-23). Siempre pisa lo que mande
    el navegador: el MCP de destino no lo decide el cliente. Si el body no es
    un objeto JSON se deja intacto (el backend lo rechazará igual)."""
    if not mcp_url:
        return body
    try:
        payload = json.loads(body)
    except ValueError:
        return body
    if not isinstance(payload, dict):
        return body
    payload["mcp_url"] = mcp_url.rstrip("/")
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")
